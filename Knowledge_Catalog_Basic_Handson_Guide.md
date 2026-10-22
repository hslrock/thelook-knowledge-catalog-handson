# Gemini Enterprise에 Knowledge Catalog와 BigQuery 연결하기

> [!NOTE]
> **실습 환경 안내 (서울 리전 `asia-northeast3` 기준)**  
> 별도 스크립트나 수동 OAuth 2.0 클라이언트 발급 없이 Google Cloud 콘솔 화면만 쓰는 실습입니다. 서울 리전(`asia-northeast3`)에 BigQuery 테이블과 Knowledge Catalog 용어집을 만들고 Gemini Enterprise에 앱 두 개(`thelook-without-kc`, `thelook-with-kc`)를 구성해 SQL 생성 결과를 나란히 비교합니다.

---

## 실습 배경과 목표

데이터 웨어하우스(BigQuery)에 생성형 AI 에이전트를 바로 연결하면 스키마의 물리 이름(`order_items.sale_price`, `order_items.status`, `products.category`)만 읽고 쿼리를 짭니다. 사내 지표인 `NRR`(취소·반품을 뺀 실현 순매출)이나 큐레이션 용어인 `COZY-EDIT`(홈·라운지웨어 3개 카테고리 묶음)의 정의를 알 길이 없으니 에이전트가 엉뚱한 SQL을 작성합니다.

이번 실습에서는 데이터와 카탈로그 메타데이터를 모두 서울 리전(`asia-northeast3`)에 맞추고 세 가지 기능이 에이전트 쿼리를 어떻게 바꾸는지 확인합니다.

1. **동의어(`Synonyms`)**: 영문 코드(`NRR`, `COZY-EDIT`) 대신 한글 표현(`실현 순매출`, `코지 에디트`)으로 질문했을 때 표준 용어를 찾아내는지 봅니다.
2. **관련 항목(`Related entries`)**: 비즈니스 용어가 실제 BigQuery 물리 테이블·컬럼(`order_items.sale_price`, `order_items.status`, `products.category`)으로 연결되는지 확인합니다.
3. **개요(`Overview`)와 관점(`Aspects`)**: 취소·반품 제외 조건(`status NOT IN ('Cancelled', 'Returned')`)과 카테고리 필터(`category IN (...)`)가 SQL에 반영되는지 실험합니다.

| 구성 요소 | 리전 (`Location`) | 역할 |
| :--- | :--- | :--- |
| BigQuery 데이터셋 (`thelook_ecommerce`) | `asia-northeast3` (서울) | `products`, `order_items` 테이블 저장 및 `@bigquery` 엔트리 자동 등록 |
| Knowledge Catalog 관점 유형 (`semantic-sql-rule`) | `asia-northeast3` (서울) | SQL 산출식과 조인·필터 조건을 담는 메타데이터 템플릿 |
| Knowledge Catalog 비즈니스 용어집 (`thelook-business-glossary`) | `asia-northeast3` (서울) | `NRR`, `COZY-EDIT` 용어 정의 및 BigQuery 컬럼 연결 |
| Gemini Enterprise 앱 (`thelook-without-kc`, `thelook-with-kc`) | `global` (전역) | 서울 리전의 BigQuery 데이터셋과 Knowledge Catalog를 조회해 자연어 질의 처리 |

---

## 실습 1. BigQuery Studio에서 서울 리전 테이블 만들기

> [!TIP]
> **공개 데이터셋을 직접 조회하지 않는 이유**  
> 구글 공개 데이터셋(`bigquery-public-data.thelook_ecommerce`)은 `US` 멀티 리전에 있습니다. 서울 리전(`asia-northeast3`) 데이터셋에서 `SELECT * FROM bigquery-public-data...`를 실행하면 리전 불일치 오류가 납니다. 아래 쿼리는 `UNNEST`로 서울 리전에 테이블을 바로 만들면서 취소·반품 제외 여부와 카테고리 필터 적용 여부가 금액 차이(`$1,000` 대 `$1,350`, `$2,000` 대 `$2,450`)로 한눈에 드러나도록 구성했습니다.

1. Google Cloud 콘솔 왼쪽 위 탐색 메뉴(☰)에서 **BigQuery** > **Studio**를 엽니다.
2. 편집기 탭 바에서 **+ SQL 쿼리(`+ SQL query`)**를 눌러 새 편집 창을 띄웁니다.
3. 아래 쿼리를 붙여넣고 **실행(`Run`)**을 누릅니다.

```sql
-- 1. 서울 리전(asia-northeast3)에 thelook_ecommerce 데이터셋 생성
CREATE SCHEMA IF NOT EXISTS `thelook_ecommerce`
OPTIONS(location = 'asia-northeast3');

-- 2. 상품(products) 테이블 생성 (코지 에디트 3개 카테고리 상품 6종 + 제외 카테고리 2종 = 총 8종)
CREATE OR REPLACE TABLE `thelook_ecommerce.products` AS
SELECT * FROM UNNEST([
  STRUCT(101 AS id, 'Sleep & Lounge' AS category, '코지 실크 파자마 세트' AS name, 'CozyHome' AS brand, 150.00 AS retail_price),
  STRUCT(102, 'Sleep & Lounge', '소프트 라운지 로브', 'CozyHome', 150.00),
  STRUCT(201, 'Intimates', '심리스 컴포트 브라렛', 'SoftTouch', 120.00),
  STRUCT(202, 'Intimates', '코튼 모달 언더웨어 팩', 'SoftTouch', 130.00),
  STRUCT(301, 'Fashion Hoodies & Sweatshirts', '오버핏 플리스 후디', 'UrbanLounge', 200.00),
  STRUCT(302, 'Fashion Hoodies & Sweatshirts', '헤비웨이트 크루넥 스웻셔츠', 'UrbanLounge', 250.00),
  STRUCT(401, 'Active', '프로 러닝 레깅스 (코지 에디트 제외 대상)', 'ActiveFit', 200.00),
  STRUCT(501, 'Outerwear & Coats', '윈터 구스다운 파카 (코지 에디트 제외 대상)', 'NordicPeak', 600.00)
]);

-- 3. 주문 상품(order_items) 테이블 생성
--    * 코지 에디트 확정 주문(Complete/Shipped/Processing) 합계 = $1,000.00 (6건)
--    * 코지 에디트 취소·반품(Cancelled/Returned) 합계 = $350.00 (2건) -> NRR 계산에서 제외
--    * 기타 카테고리 확정 주문 합계 = $1,000.00 (3건) / 취소 = $100.00 (1건)
--    * 전체 실현 순매출(NRR) 정답 = $2,000.00 (확정 9건) / 단순 합산 오답 = $2,450.00 (전체 12건)
CREATE OR REPLACE TABLE `thelook_ecommerce.order_items` AS
SELECT * FROM UNNEST([
  -- [코지 에디트 확정 주문 6건: 합계 $1,000.00]
  STRUCT(1 AS id, 1001 AS order_id, 101 AS product_id, 'Complete' AS status, 150.00 AS sale_price),
  STRUCT(2, 1002, 102, 'Shipped', 150.00),
  STRUCT(3, 1003, 201, 'Complete', 120.00),
  STRUCT(4, 1004, 202, 'Processing', 130.00),
  STRUCT(5, 1005, 301, 'Complete', 200.00),
  STRUCT(6, 1006, 302, 'Complete', 250.00),
  -- [코지 에디트 취소·반품 주문 2건: 합계 $350.00]
  STRUCT(7, 1007, 101, 'Cancelled', 150.00),
  STRUCT(8, 1008, 301, 'Returned', 200.00),
  -- [기타 카테고리(Active, Outerwear) 확정 주문 3건: 합계 $1,000.00 / 취소 1건: $100.00]
  STRUCT(9, 1009, 401, 'Complete', 200.00),
  STRUCT(10, 1010, 401, 'Shipped', 200.00),
  STRUCT(11, 1011, 501, 'Complete', 600.00),
  STRUCT(12, 1012, 401, 'Cancelled', 100.00)
]);
```

4. 쿼리가 끝나면 왼쪽 **탐색기(`Explorer`)** 패널에서 `thelook_ecommerce` 데이터셋 아래에 `products`, `order_items` 테이블이 생겼는지 확인합니다. BigQuery 테이블이 만들어지면 별도 비용(`$0 [약 0원]`)이나 대기 시간 없이 Knowledge Catalog의 `@bigquery` 엔트리 그룹에 기술 메타데이터가 자동 등록됩니다.

![BigQuery Studio 서울 리전 데이터셋 생성 화면](images/step1_bigquery_copy.png)

---

## 실습 2. Knowledge Catalog에 용어집과 메타데이터 등록하기

물리 테이블 위에 비즈니스 정의와 SQL 규칙을 연결합니다. 먼저 용어 상세 화면의 다섯 영역이 각각 어떤 역할을 맡는지 살펴보고 실험에 쓸 핵심 용어 두 개(`NRR`, `COZY-EDIT`)를 등록합니다.

### 용어 상세 화면의 5개 영역

**Dataplex > 비즈니스 용어집(`Business glossaries`)**에서 개별 용어를 열면 본문이 다섯 영역(①~⑤)으로 나뉘고 오른쪽에 동의어 패널이 표시됩니다.

![Knowledge Catalog 용어 상세 화면 5개 영역](images/step2_real_kc_term_sections.png)

| 화면 영역 | 역할 | 에이전트가 참조하는 방식 | 실습 입력 여부 |
| :--- | :--- | :--- | :--- |
| ① 설명 (`Description`) | 1~2문장 요약 정의 | 컬럼에 용어가 연결되어 있으면 에이전트가 테이블 맥락(`lookup_context`)을 읽을 때 컬럼 스키마 옆에 바로 붙습니다. | 입력 |
| ② 개요 (`Overview`) | 배경 설명 및 포함·제외 기준 | 시스템 Aspect(`overview`)에 저장되며 어떤 상태값이나 카테고리를 넣고 빼야 하는지 상세 지침을 전달합니다. | 입력 |
| ③ 관점 (`Aspects`) | 구조화된 Key-Value 메타데이터 | 관점 유형 템플릿(`semantic-sql-rule`)에 맞춰 SQL 수식(`sql_expression`), 대상 테이블(`target_tables`), 필터 조건을 정형 필드로 저장하며 `lookup_entry` 호출 시 반환됩니다. | 입력 |
| ④ 데이터 품질 규칙 (`Data quality rules`) | 데이터 품질 검증 규칙 | 연결된 BigQuery 컬럼에서 Dataplex 자동 데이터 품질 스캔(Auto DQ)을 돌릴 때 규칙을 상속합니다. | 생략 (SQL 생성 실험과 무관) |
| ⑤ 관련 항목 (`Related entries`) | 물리 테이블·컬럼 매핑 | 비즈니스 용어(`@dataplex`)와 실제 BigQuery 물리 컬럼(`order_items.sale_price`, `products.category`)을 연결합니다. | 입력 |
| 우측 패널 동의어 (`Synonyms`) | 대체 용어·현업 별칭 | 사용자가 `NRR` 대신 `순매출`, `실현 순매출`로 검색해도 해당 용어 엔트리를 찾아줍니다. | 입력 |

---

### 2-1. 서울 리전에 `semantic-sql-rule` 관점 유형 만들기

용어의 **③ 관점** 영역에 SQL 수식과 필터 조건을 넣으려면 먼저 관점 유형(메타데이터 템플릿)을 만듭니다.

1. 콘솔 왼쪽 메뉴에서 **Dataplex** > **관점 유형(`Aspect types`)**으로 이동해 **관점 유형 만들기(`Create aspect type`)**를 누릅니다.
2. 기본 정보를 입력합니다.
   - **표시 이름(`Display name`)**: `Semantic Metric & SQL Calculation Rule`
   - **관점 유형 ID(`Aspect type ID`)**: `semantic-sql-rule`
   - **위치(`Location`)**: `asia-northeast3 (Seoul)`
3. 텍스트(`String / Text`) 필드 3개를 추가하고 **만들기(`Create`)**를 누릅니다.
   - `sql_expression` (표준 GoogleSQL 집계 수식 또는 조건식)
   - `target_tables` (조회할 대상 BigQuery 테이블명)
   - `filter_or_join_rule` (필수 WHERE 조건 또는 JOIN 키)

---

### 2-2. 서울 리전에 비즈니스 용어집 만들기

1. 왼쪽 메뉴에서 **Dataplex** > **비즈니스 용어집**으로 이동해 **비즈니스 용어집 만들기(`Create business glossary`)**를 누릅니다.
2. 아래 값을 입력하고 **만들기**를 누릅니다.

| 항목 | 입력값 |
| :--- | :--- |
| 표시 이름 (`Display name`) | `TheLook 전사 공통 용어집` |
| 용어집 ID (`Glossary ID`) | `thelook-business-glossary` |
| 위치 (`Location`) | `asia-northeast3 (Seoul)` |
| 설명 (`Description`) | `전사 공통 매출 지표(NRR)와 전략 큐레이션 상품군(COZY-EDIT) 표준 용어집입니다.` |

![Knowledge Catalog 비즈니스 용어집 생성 화면](images/step2a_kc_glossary_create.png)

---

### 2-3. 핵심 용어 2개(`NRR`, `COZY-EDIT`) 등록 및 컬럼 연결

**TheLook 전사 공통 용어집** 안에서 **+ 용어 추가(`+ Add term`)**를 눌러 용어 두 개를 등록합니다.

> [!IMPORTANT]
> **`⑤ 관련 항목`에서 테이블이 아니라 개별 컬럼을 연결하는 방법**  
> 용어 화면의 **`⑤ 관련 항목` > `+ 추가(+ Add)`** 창은 기본 상태에서 테이블 목록만 띄우고 `열 이름(Column Name)` 칸을 숨깁니다. 필터 없이 테이블 행을 그대로 체크하면 `Column Name: -`(테이블 단위 연결)로 등록됩니다. 컬럼 단위(`sale_price`, `category` 등)로 연결하려면 아래 두 방법 중 하나를 쓰세요.
>
> 1. **테이블 `스키마(Schema)` 탭에서 연결하기 (권장)**
>    - **Dataplex > 검색(`Search`)**에서 테이블 이름(`order_items` 또는 `products`)을 찾아 엽니다.
>    - **`스키마`** 탭으로 이동해 연결할 컬럼(`sale_price`, `status` 등) 왼쪽 체크박스를 고르고 상단의 **`비즈니스 용어 추가(`Add business term`)`**를 눌러 용어(`NRR`)를 지정합니다.
> 2. **`⑤ 관련 항목 > + 추가` 창에서 필터 칩 쓰기**
>    - `+ 추가` 창 상단 **필터(`Filter`)** 입력란을 누르고 드롭다운에서 **`열 이름(`Column Name`)`**을 고른 뒤 컬럼명(예: `Column Name : sale_price`)을 입력합니다.
>    - 필터 칩이 생기면 숨겨져 있던 `Column Name` 열이 나타납니다. 이때 표시되는 컬럼 행을 체크하고 **추가**를 누릅니다. 필터 칩을 넣기 전에 먼저 체크해 둔 테이블 행이 있다면 체크를 해제하세요.

#### 용어 1. `NRR` (동의어 + 취소·반품 제외 수식 + `order_items` 컬럼 연결)

- **표시 이름**: `NRR`
- **용어 ID**: `nrr`

| 영역 | 조작 | 입력 내용 |
| :--- | :--- | :--- |
| ① 설명 | `✏️ 수정` | `전체 주문 금액에서 주문 취소(Cancelled)와 반품(Returned) 건을 빼고 기업에 실제 귀속된 실현 순매출액(Net Realized Revenue)입니다.` |
| ② 개요 | `+ 추가` | • 산출 목적: 단순 판매가 합계(총거래액 GMV) 착시를 막고 취소·반품을 차감한 실질 귀속 매출 산출<br>• 포함·제외 기준: `Complete`, `Shipped`, `Processing` 상태는 포함하며 `Cancelled`(주문 취소)와 `Returned`(반품 완료) 상태는 제외<br>• 기준 컬럼: `thelook_ecommerce.order_items` 테이블의 `sale_price`(판매 단가), `status`(주문 상태) |
| ③ 관점 | `+ 추가` > `Semantic Metric & SQL Calculation Rule` | • `sql_expression`: `SUM(CASE WHEN order_items.status NOT IN ('Cancelled', 'Returned') THEN order_items.sale_price ELSE 0 END)`<br>• `target_tables`: `thelook_ecommerce.order_items`<br>• `filter_or_join_rule`: `order_items.status NOT IN ('Cancelled', 'Returned')` |
| ⑤ 관련 항목 | 테이블 `Schema` 탭 또는 `Column Name` 필터 | `order_items` 테이블의 `sale_price`, `status` 컬럼 연결 |
| 우측 패널 동의어 | `+ 추가` | `순매출`, `실현 순매출`, `실현매출`, `Net Realized Revenue` |

#### 용어 2. `COZY-EDIT` (동의어 + 3개 카테고리 필터 + `products` 컬럼 연결)

- **표시 이름**: `COZY-EDIT`
- **용어 ID**: `cozy-edit`

| 영역 | 조작 | 입력 내용 |
| :--- | :--- | :--- |
| ① 설명 | `✏️ 수정` | `홈웨어, 잠옷, 이너웨어, 후드·스웻셔츠 등 실내외 이지웨어 주력 상품군 3종을 묶어 부르는 사내 큐레이션 용어입니다.` |
| ② 개요 | `+ 추가` | • 포함 물리 카테고리(3종): `products.category` 값이 `'Sleep & Lounge'`, `'Intimates'`, `'Fashion Hoodies & Sweatshirts'`인 상품<br>• 제외 대상: `'Active'`(스포츠웨어)와 `'Outerwear & Coats'`는 제외 (물리 DB에는 `'COZY-EDIT'`이라는 카테고리 문자열이 없음) |
| ③ 관점 | `+ 추가` > `Semantic Metric & SQL Calculation Rule` | • `sql_expression`: `products.category IN ('Sleep & Lounge', 'Intimates', 'Fashion Hoodies & Sweatshirts')`<br>• `target_tables`: `thelook_ecommerce.products`<br>• `filter_or_join_rule`: `order_items.product_id = products.id` |
| ⑤ 관련 항목 | 테이블 `Schema` 탭 또는 `Column Name` 필터 | `products` 테이블의 `category` 컬럼 연결 |
| 우측 패널 동의어 | `+ 추가` | `코지 에디트`, `코지에디트`, `홈웨어 큐레이션` |

![Knowledge Catalog 컬럼 매핑 확인 화면](images/step2b_kc_column_link.png)

---

## 실습 3. Gemini Enterprise에서 BigQuery 데이터 스토어와 비교용 두 앱 만들기

Gemini Enterprise에 BigQuery 데이터 스토어를 연결하고 Knowledge Catalog 설정만 다른 앱 두 개(`thelook-without-kc`, `thelook-with-kc`)를 만듭니다.

> [!TIP]
> **OAuth 2.0 클라이언트 ID를 따로 발급하지 않는 이유**  
> Gemini Enterprise가 기본 제공하는 자사(`First-party`) **BigQuery(`제휴 쿼리 / Federated query`)** 커넥터와 **Knowledge Catalog 사용 설정(`Enable Knowledge Catalog`)** 토글은 구글 내부 1P 인증을 자동으로 처리합니다. `APIs & Services > Credentials`에서 OAuth 클라이언트를 만들거나 Argolis 조직 정책을 건드릴 필요가 없습니다.

### 3-1. BigQuery 제휴 쿼리 데이터 스토어 생성 및 작업 활성화

1. 콘솔에서 **Gemini Enterprise** > **데이터 스토어(`Data stores`)**로 이동해 **+ 데이터 스토어 만들기(`+ Create data store`)**를 누릅니다.
2. **자사 데이터 소스(`First-party data sources - Google Cloud`)** 목록에서 **BigQuery**를 고릅니다.
3. 연결 방식으로 **제휴 쿼리(`Federated query - recommended`)**를 선택합니다.
4. 커넥터 정보를 입력하고 **만들기**를 누릅니다.
   - **데이터 커넥터 이름(`Data connector name`)**: `thelook-bigquery-federated`
   - **결제 프로젝트 ID(`Billing Project ID`)**: 실습 중인 Google Cloud 프로젝트 ID 입력
5. 생성된 `thelook-bigquery-federated` 데이터 스토어를 열고 **작업(`Actions`)** 탭에서 아래 분석 액션들이 켜져 있는지 확인합니다.
   - `Execute SQL (Read-Only)` (`execute_sql_readonly`)
   - `Get Table Info` (`get_table_info`), `Get Dataset Info` (`get_dataset_info`)
   - `List Dataset IDs` (`list_dataset_ids`), `List Table IDs` (`list_table_ids`)
   - `Get Query Results` (`get_query_results`), `Get Job` (`get_job`)

### 3-2. 비교 앱 ① 만들기 (`thelook-without-kc` — Knowledge Catalog 꺼짐)

물리 BigQuery 스키마만 읽고 Knowledge Catalog는 보지 않는 대조군 앱입니다.

1. **Gemini Enterprise** 왼쪽 메뉴에서 **앱(`Apps`)** > **+ 앱 만들기(`+ Create app`)**를 누릅니다.
2. 아래 값으로 앱을 생성합니다.
   - **앱 이름(`App name`)**: `thelook-without-kc`
   - **위치**: `global (Global)`
   - **데이터 스토어**: `thelook-bigquery-federated` 선택 및 연결
3. 생성된 `thelook-without-kc` 앱 왼쪽 메뉴에서 **구성(`Configurations`)** > **어시스턴트(`Assistant`)** 탭을 열어 **Knowledge Catalog 사용 설정(`Enable Knowledge Catalog`)** 토글이 **꺼짐(`Off`)** 상태인지 확인합니다.

### 3-3. 비교 앱 ② 만들기 (`thelook-with-kc` — Knowledge Catalog 켜짐)

같은 BigQuery 데이터 스토어를 연결하되 Knowledge Catalog 연동만 켠 실험군 앱입니다.

1. 다시 **Gemini Enterprise** > **앱** > **+ 앱 만들기**를 누릅니다.
2. 아래 값으로 두 번째 앱을 생성합니다.
   - **앱 이름**: `thelook-with-kc`
   - **위치**: `global (Global)`
   - **데이터 스토어**: `thelook-bigquery-federated` 선택 및 연결
3. `thelook-with-kc` 앱의 **구성** > **어시스턴트** 탭으로 이동합니다.
4. 아래쪽 **Knowledge Catalog 사용 설정** 토글을 **켬(`On`)**으로 바꾸고 **저장(`Save`)**을 누릅니다. 에이전트가 내장 카탈로그 도구(`knowledge_catalog_search`, `knowledge_catalog_lookup_context`, `knowledge_catalog_lookup_entry`)로 서울 리전의 용어집과 Aspect 수식을 조회합니다.

![Gemini Enterprise 두 앱 구성 비교 화면](images/step4b_ge_app_assistant_kc.png)

---

## 실습 4. 두 앱에 같은 질문을 던져 결과 비교하기

두 앱의 **통합(`Integration`)** 또는 **개요(`Overview`)** 탭에서 **웹앱 URL(`Web App URL`)**을 각각 열어 브라우저 탭 두 개에 `thelook-without-kc`와 `thelook-with-kc`를 나란히 띄웁니다. 첫 질문을 실행할 때 BigQuery 권한 승인 안내가 뜨면 **승인(`Authorize`)**을 눌러 로그인 계정을 연결합니다.

실습 2에서 등록한 동의어, 테이블·컬럼 매핑, 관점(Aspect) 수식이 쿼리를 어떻게 바꾸는지 세 가지 질문으로 확인합니다.

### 실험 1. 한글 동의어(`실현 순매출`) 질문 시 취소·반품 제외 수식이 들어가는가

영문 약어(`NRR`)나 취소·반품 제외 조건을 프롬프트에 적지 않고 한글 동의어인 `실현 순매출`로만 물어봅니다.

```text
우리 쇼핑몰의 전체 실현 순매출 합계와 해당 주문 상품 건수를 알려줘. 실행한 SQL 쿼리 조건도 함께 설명해 줘.
```

| 비교 항목 | `thelook-without-kc` (Knowledge Catalog 꺼짐) | `thelook-with-kc` (Knowledge Catalog 켜짐) |
| :--- | :--- | :--- |
| 동의어 해석 | 카탈로그를 검색하지 못해 `order_items.sale_price` 단순 합계로 추측 | 동의어(`실현 순매출`)로 서울 리전의 `NRR` 용어 엔트리를 찾음 |
| 생성된 SQL 조건 | `status` 필터 없이 취소(`Cancelled`)·반품(`Returned`) 건까지 합산 | 관점(`semantic-sql-rule`)과 개요에 적힌 `order_items.status NOT IN ('Cancelled', 'Returned')` 조건 반영 |
| 쿼리 결과 | **`$2,450.00 [약 338만 원]` (12건)** — 취소·반품 `$450.00`(3건)이 섞인 오답 | **`$2,000.00 [약 276만 원]` (9건)** — 취소·반품 3건을 뺀 정답 |

### 실험 2. 사내 용어(`코지 에디트`)가 `products.category`의 3개 카테고리로 변환되는가

물리 테이블(`products.category`)에는 `COZY-EDIT`이나 `코지 에디트`라는 문자열이 없습니다. 한글 동의어로 질문했을 때 3개 카테고리로 풀어서 조회하는지 봅니다.

```text
코지 에디트 상품군에는 어떤 카테고리가 포함되는지, 각 카테고리별 등록 상품 수(products 테이블 기준)를 조회해 줘.
```

| 비교 항목 | `thelook-without-kc` (Knowledge Catalog 꺼짐) | `thelook-with-kc` (Knowledge Catalog 켜짐) |
| :--- | :--- | :--- |
| 용어 및 컬럼 탐색 | `products` 테이블에서 `WHERE category LIKE '%Cozy%'` 또는 `= '코지 에디트'`로 쿼리 | 동의어(`코지 에디트`)로 `COZY-EDIT` 용어를 찾고 관련 항목에 연결된 `products.category` 컬럼 확인 |
| 쿼리 결과 | 일치하는 행이 없어 **`0건`** 반환 | `Sleep & Lounge`(2개), `Intimates`(2개), `Fashion Hoodies & Sweatshirts`(2개) **총 6개 상품** 집계 (`Active`, `Outerwear & Coats` 제외) |

### 실험 3. 두 용어(`코지 에디트` + `실현 순매출`) 결합 및 테이블 조인

두 비즈니스 용어를 한 문장에 넣어 질문했을 때 에이전트가 두 용어의 메타데이터를 함께 읽고 `products`와 `order_items` 테이블을 조인(`order_items.product_id = products.id`)하는지 확인합니다.

```text
우리 회사의 코지 에디트 상품군의 실현 순매출과 확정 주문 건수는 얼마야? 카테고리별 내역도 함께 보여줘.
```

* **`thelook-without-kc` (Knowledge Catalog 꺼짐)**: `코지 에디트` 카테고리를 찾지 못해 **`0건`**이 나오거나 취소·반품(`$350.00`)이 섞인 **`$1,350.00`**을 반환합니다.
* **`thelook-with-kc` (Knowledge Catalog 켜짐)**:
  1. Knowledge Catalog에서 `COZY-EDIT`(`products.category IN ('Sleep & Lounge', 'Intimates', 'Fashion Hoodies & Sweatshirts')`)과 `NRR`(`order_items.status NOT IN ('Cancelled', 'Returned')`, `SUM(order_items.sale_price)`)의 정의, 연결 컬럼, Aspect SQL 규칙을 함께 가져옵니다.
  2. `thelook_ecommerce.order_items`와 `thelook_ecommerce.products`를 조인해 카테고리별 실현 순매출(`Fashion Hoodies & Sweatshirts` **`$450.00 [약 62만 원]`**, `Sleep & Lounge` **`$300.00 [약 41만 원]`**, `Intimates` **`$250.00 [약 35만 원]`**)과 합계(**`$1,000.00 [약 138만 원]`**, 확정 주문 **6건**)를 계산합니다.

![Gemini Enterprise 웹앱 두 앱 비교 실험 결과 화면](images/step5_ge_chat_aha_moment.png)
