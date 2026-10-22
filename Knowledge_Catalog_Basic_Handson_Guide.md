# Gemini Enterprise에 Knowledge Catalog와 BigQuery 연결하기

BigQuery 테이블에 비즈니스 맥락이 없으면 AI 에이전트는 물리 컬럼명(`sale_price`, `status`, `category`)만 보고 쿼리를 작성합니다. 이 실습에서는 서울 리전(`asia-northeast3`)에 이커머스 테이블과 Knowledge Catalog 용어집(`NRR`, `COZY-EDIT`)을 만들고 Gemini Enterprise에 앱 두 개(`thelook-without-kc`, `thelook-with-kc`)를 구성해 SQL 생성 결과를 비교합니다.

---

## 1. BigQuery 테이블 생성 (`asia-northeast3`)

1. Google Cloud 콘솔 메뉴(☰)에서 **BigQuery** > **Studio**를 엽니다.
2. **+ SQL 쿼리(`+ SQL query`)**를 눌러 새 편집 창을 열고 아래 SQL을 실행(**`Run`**)합니다.

```sql
-- 1. 서울 리전(asia-northeast3)에 데이터셋 생성
CREATE SCHEMA IF NOT EXISTS `thelook_ecommerce`
OPTIONS(location = 'asia-northeast3');

-- 2. 상품(products) 테이블 생성 (총 8종)
CREATE OR REPLACE TABLE `thelook_ecommerce.products` AS
SELECT * FROM UNNEST([
  STRUCT(101 AS id, 'Sleep & Lounge' AS category, '코지 실크 파자마 세트' AS name, 'CozyHome' AS brand, 150.00 AS retail_price),
  STRUCT(102, 'Sleep & Lounge', '소프트 라운지 로브', 'CozyHome', 150.00),
  STRUCT(201, 'Intimates', '심리스 컴포트 브라렛', 'SoftTouch', 120.00),
  STRUCT(202, 'Intimates', '코튼 모달 언더웨어 팩', 'SoftTouch', 130.00),
  STRUCT(301, 'Fashion Hoodies & Sweatshirts', '오버핏 플리스 후디', 'UrbanLounge', 200.00),
  STRUCT(302, 'Fashion Hoodies & Sweatshirts', '헤비웨이트 크루넥 스웻셔츠', 'UrbanLounge', 250.00),
  STRUCT(401, 'Active', '프로 러닝 레깅스', 'ActiveFit', 200.00),
  STRUCT(501, 'Outerwear & Coats', '윈터 구스다운 파카', 'NordicPeak', 600.00)
]);

-- 3. 주문 상품(order_items) 테이블 생성 (총 12건)
CREATE OR REPLACE TABLE `thelook_ecommerce.order_items` AS
SELECT * FROM UNNEST([
  -- 코지 에디트 확정 주문 6건 (합계 $1,000.00)
  STRUCT(1 AS id, 1001 AS order_id, 101 AS product_id, 'Complete' AS status, 150.00 AS sale_price),
  STRUCT(2, 1002, 102, 'Shipped', 150.00),
  STRUCT(3, 1003, 201, 'Complete', 120.00),
  STRUCT(4, 1004, 202, 'Processing', 130.00),
  STRUCT(5, 1005, 301, 'Complete', 200.00),
  STRUCT(6, 1006, 302, 'Complete', 250.00),
  -- 코지 에디트 취소·반품 2건 (합계 $350.00)
  STRUCT(7, 1007, 101, 'Cancelled', 150.00),
  STRUCT(8, 1008, 301, 'Returned', 200.00),
  -- 기타 카테고리 확정 주문 3건 (합계 $1,000.00) 및 취소 1건 ($100.00)
  STRUCT(9, 1009, 401, 'Complete', 200.00),
  STRUCT(10, 1010, 401, 'Shipped', 200.00),
  STRUCT(11, 1011, 501, 'Complete', 600.00),
  STRUCT(12, 1012, 401, 'Cancelled', 100.00)
]);
```

3. 왼쪽 **탐색기(`Explorer`)**에서 `thelook_ecommerce` 아래에 `products`, `order_items` 테이블이 생성되었는지 확인합니다.

![BigQuery Studio 서울 리전 데이터셋 생성 화면](images/step1_bigquery_copy.png)

---

## 2. Knowledge Catalog 용어집 및 메타데이터 등록 (`asia-northeast3`)

Knowledge Catalog 용어 상세 화면은 다섯 영역과 우측 동의어 패널로 구성됩니다. 이번 실습에서는 SQL 생성에 쓰이는 항목만 입력합니다.

![Knowledge Catalog 용어 상세 화면 구조](images/step2_real_kc_term_sections.png)

| 영역 | 역할 | 실습 입력 내용 |
| :--- | :--- | :--- |
| ① 설명 (`Description`) | 용어 한 줄 정의 | 비즈니스 요약 정의 |
| ② 개요 (`Overview`) | 상세 기준 문서 | 포함·제외 조건 설명 |
| ③ 관점 (`Aspects`) | 구조화된 Key-Value 메타데이터 | SQL 수식(`sql_expression`), 대상 테이블, 필터·조인 조건 |
| ④ 데이터 품질 규칙 (`Data quality rules`) | 데이터 품질 스캔용 규칙 | 생략 |
| ⑤ 관련 항목 (`Related entries`) | 물리 데이터 자산 연결 | BigQuery 테이블 및 컬럼(`sale_price`, `status`, `category`) |
| 우측 패널 동의어 (`Synonyms`) | 대체 검색어 | 한글 동의어(`실현 순매출`, `코지 에디트`) |

### 2-1. 관점 유형(`Aspect type`) 만들기

1. **Dataplex** > **관점 유형(`Aspect types`)**에서 **관점 유형 만들기(`Create aspect type`)**를 누릅니다.
2. 기본 정보를 입력합니다.
   - **표시 이름(`Display name`)**: `Semantic Metric & SQL Calculation Rule`
   - **관점 유형 ID(`Aspect type ID`)**: `semantic-sql-rule`
   - **위치(`Location`)**: `asia-northeast3 (Seoul)`
3. 텍스트(`String / Text`) 필드 3개를 추가하고 **만들기(`Create`)**를 누릅니다.
   - `sql_expression`
   - `target_tables`
   - `filter_or_join_rule`

### 2-2. 비즈니스 용어집 만들기

1. **Dataplex** > **비즈니스 용어집(`Business glossaries`)**에서 **비즈니스 용어집 만들기(`Create business glossary`)**를 누릅니다.
2. 아래 값으로 생성합니다.
   - **표시 이름**: `TheLook 전사 공통 용어집`
   - **용어집 ID**: `thelook-business-glossary`
   - **위치**: `asia-northeast3 (Seoul)`

![Knowledge Catalog 비즈니스 용어집 생성 화면](images/step2a_kc_glossary_create.png)

### 2-3. 용어 2개(`NRR`, `COZY-EDIT`) 등록

생성한 용어집 안에서 **+ 용어 추가(`+ Add term`)**를 눌러 두 용어를 등록합니다.

> [!TIP]
> **`⑤ 관련 항목`에서 특정 컬럼을 연결하는 방법**  
> * **방법 1 (테이블 `스키마` 탭 활용)**: **Dataplex > 검색(`Search`)**에서 테이블(`order_items` 또는 `products`)을 열고 **`스키마(`Schema`)`** 탭에서 컬럼 체크박스를 선택한 뒤 **`비즈니스 용어 추가(`Add business term`)`**를 누릅니다.  
> * **방법 2 (`⑤ 관련 항목 > + 추가` 필터 활용)**: `+ 추가` 창 상단 **필터(`Filter`)**에서 **`열 이름(`Column Name`)`**을 선택해 컬럼명(예: `Column Name : sale_price`)을 입력하면 숨겨져 있던 `Column Name` 열이 나타납니다. 표시된 컬럼 행을 체크하고 **추가**를 누릅니다.

#### 용어 1. `NRR`
- **표시 이름**: `NRR` / **용어 ID**: `nrr`

| 영역 | 입력값 |
| :--- | :--- |
| ① 설명 | `전체 주문 금액에서 주문 취소(Cancelled)와 반품(Returned) 건을 뺀 실현 순매출액입니다.` |
| ② 개요 | • 포함 상태: `Complete`, `Shipped`, `Processing`<br>• 제외 상태: `Cancelled`, `Returned`<br>• 기준 컬럼: `thelook_ecommerce.order_items`의 `sale_price`, `status` |
| ③ 관점 (`semantic-sql-rule`) | • `sql_expression`: `SUM(CASE WHEN order_items.status NOT IN ('Cancelled', 'Returned') THEN order_items.sale_price ELSE 0 END)`<br>• `target_tables`: `thelook_ecommerce.order_items`<br>• `filter_or_join_rule`: `order_items.status NOT IN ('Cancelled', 'Returned')` |
| ⑤ 관련 항목 | `order_items` 테이블의 `sale_price`, `status` 컬럼 |
| 동의어 | `순매출`, `실현 순매출`, `실현매출`, `Net Realized Revenue` |

#### 용어 2. `COZY-EDIT`
- **표시 이름**: `COZY-EDIT` / **용어 ID**: `cozy-edit`

| 영역 | 입력값 |
| :--- | :--- |
| ① 설명 | `홈웨어, 이너웨어, 후드·스웻셔츠 등 주력 이지웨어 3개 카테고리를 묶어 부르는 사내 큐레이션 용어입니다.` |
| ② 개요 | • 포함 카테고리(3종): `products.category` 값이 `'Sleep & Lounge'`, `'Intimates'`, `'Fashion Hoodies & Sweatshirts'`인 상품<br>• 제외 카테고리: `'Active'`, `'Outerwear & Coats'` |
| ③ 관점 (`semantic-sql-rule`) | • `sql_expression`: `products.category IN ('Sleep & Lounge', 'Intimates', 'Fashion Hoodies & Sweatshirts')`<br>• `target_tables`: `thelook_ecommerce.products`<br>• `filter_or_join_rule`: `order_items.product_id = products.id` |
| ⑤ 관련 항목 | `products` 테이블의 `category` 컬럼 |
| 동의어 | `코지 에디트`, `코지에디트`, `홈웨어 큐레이션` |

![Knowledge Catalog 컬럼 매핑 화면](images/step2b_kc_column_link.png)

---

## 3. Gemini Enterprise 데이터 스토어 및 비교 앱 2개 구성

### 3-1. BigQuery 데이터 스토어 연결

1. **Gemini Enterprise** > **데이터 스토어(`Data stores`)**에서 **+ 데이터 스토어 만들기(`+ Create data store`)**를 누릅니다.
2. **자사 데이터 소스(`First-party data sources - Google Cloud`)**에서 **BigQuery** > **제휴 쿼리(`Federated query - recommended`)**를 선택합니다.
3. 아래 정보를 입력하고 **만들기**를 누릅니다.
   - **데이터 커넥터 이름**: `thelook-bigquery-federated`
   - **결제 프로젝트 ID(`Billing Project ID`)**: 실습 중인 Google Cloud 프로젝트 ID
4. 생성된 `thelook-bigquery-federated` 데이터 스토어의 **작업(`Actions`)** 탭에서 분석 액션(`Execute SQL (Read-Only)`, `Get Table Info`, `Get Dataset Info`, `List Dataset IDs`, `List Table IDs`, `Get Query Results`, `Get Job`)을 모두 활성화합니다.

### 3-2. 앱 ① 만들기 (`thelook-without-kc` — Knowledge Catalog 꺼짐)

1. **Gemini Enterprise** > **앱(`Apps`)** > **+ 앱 만들기(`+ Create app`)**를 누릅니다.
2. **앱 이름**에 `thelook-without-kc`, **위치**에 `global`을 지정하고 `thelook-bigquery-federated` 데이터 스토어를 연결해 생성합니다.
3. **구성(`Configurations`)** > **어시스턴트(`Assistant`)** 탭에서 **Knowledge Catalog 사용 설정(`Enable Knowledge Catalog`)** 토글을 **꺼짐(`Off`)** 상태로 둡니다.

### 3-3. 앱 ② 만들기 (`thelook-with-kc` — Knowledge Catalog 켜짐)

1. 다시 **앱** > **+ 앱 만들기**를 누릅니다.
2. **앱 이름**에 `thelook-with-kc`, **위치**에 `global`을 지정하고 동일한 `thelook-bigquery-federated` 데이터 스토어를 연결해 생성합니다.
3. **구성** > **어시스턴트** 탭에서 **Knowledge Catalog 사용 설정** 토글을 **켬(`On`)**으로 바꾸고 **저장(`Save`)**을 누릅니다.

![Gemini Enterprise 두 앱 구성 화면](images/step4b_ge_app_assistant_kc.png)

---

## 4. 두 앱 비교 테스트

각 앱의 **통합(`Integration`)** 또는 **개요(`Overview`)** 탭에서 **웹앱 URL(`Web App URL`)**을 열어 두 앱을 나란히 띄웁니다. 첫 질문 시 권한 승인 창이 뜨면 **승인(`Authorize`)**을 누릅니다.

### 테스트 1. 동의어(`실현 순매출`) + Aspect 수식(취소·반품 제외) 확인

```text
우리 쇼핑몰의 전체 실현 순매출 합계와 해당 주문 상품 건수를 알려줘. 실행한 SQL 쿼리 조건도 함께 설명해 줘.
```

| 구분 | `thelook-without-kc` (Knowledge Catalog 꺼짐) | `thelook-with-kc` (Knowledge Catalog 켜짐) |
| :--- | :--- | :--- |
| SQL 조건 | `status` 필터 없이 취소·반품까지 단순 합산 | `NRR` 용어의 Aspect 수식(`status NOT IN ('Cancelled', 'Returned')`) 적용 |
| 결과 | **`$2,450.00 [약 338만 원]` (12건)** — 취소·반품 `$450.00` 포함 오답 | **`$2,000.00 [약 276만 원]` (9건)** — 취소·반품 3건 제외 정답 |

### 테스트 2. 동의어(`코지 에디트`) + 컬럼 매핑(`products.category`) 확인

```text
코지 에디트 상품군에는 어떤 카테고리가 포함되는지, 각 카테고리별 등록 상품 수(products 테이블 기준)를 조회해 줘.
```

| 구분 | `thelook-without-kc` (Knowledge Catalog 꺼짐) | `thelook-with-kc` (Knowledge Catalog 켜짐) |
| :--- | :--- | :--- |
| SQL 조건 | `WHERE category = '코지 에디트'` 또는 `LIKE '%Cozy%'` 조회 | `COZY-EDIT` 용어에 정의된 3개 카테고리 `IN (...)` 조건 적용 |
| 결과 | **`0건`** | `Sleep & Lounge`(2개), `Intimates`(2개), `Fashion Hoodies & Sweatshirts`(2개) **총 6개** (`Active`, `Outerwear & Coats` 제외) |

### 테스트 3. 두 용어 결합 및 테이블 조인(`products` ⋈ `order_items`) 확인

```text
우리 회사의 코지 에디트 상품군의 실현 순매출과 확정 주문 건수는 얼마야? 카테고리별 내역도 함께 보여줘.
```

| 구분 | `thelook-without-kc` (Knowledge Catalog 꺼짐) | `thelook-with-kc` (Knowledge Catalog 켜짐) |
| :--- | :--- | :--- |
| 결과 | **`0건`** 또는 취소·반품 포함 오답(**`$1,350.00`**) | `Fashion Hoodies & Sweatshirts` `$450.00` (2건)<br>`Sleep & Lounge` `$300.00` (2건)<br>`Intimates` `$250.00` (2건)<br>**합계 `$1,000.00 [약 138만 원]` (확정 주문 6건)** |

![Gemini Enterprise 웹앱 두 앱 비교 결과](images/step5_ge_chat_aha_moment.png)
