# Gemini Enterprise에서 Knowledge Catalog와 BigQuery 연동하기 (한국 서울 리전 · 두 앱 비교 핸즈온)

> [!NOTE]
> **1차 기본 핸즈온 가이드 (한국 서울 리전 `asia-northeast3` 기준 · 수동 OAuth 발급 불필요 · 두 앱 나란히 비교)**  
> 별도의 초기화 스크립트나 복잡한 OAuth 2.0 클라이언트 발급 없이 **Google Cloud 콘솔 화면만으로** **서울 리전(`asia-northeast3`)**에 이커머스 테이블을 생성하고, **Knowledge Catalog** 핵심 메타데이터(동의어·테이블/컬럼 매핑·Aspect 수식)를 서울 리전에 등록한 뒤, **Gemini Enterprise**에 **Knowledge Catalog 미적용 앱(`thelook-without-kc`)**과 **적용 앱(`thelook-with-kc`)** 두 개를 만들어 생성형 AI의 SQL 정확도 차이를 직접 실험하는 가이드입니다.

---

## 실습 개요

기업의 데이터 웨어하우스(BigQuery)에 생성형 AI 에이전트를 연결할 때 가장 흔히 겪는 실패 원인은 **비즈니스 맥락이 없는 물리 스키마**입니다. 데이터베이스의 물리 테이블·컬럼명(`order_items.sale_price`, `order_items.status`, `products.category`)만 보고서는 사내 고유 지표인 **`NRR`(실현 순매출 — 취소·반품 제외)**이나 전략 큐레이션 상품군인 **`COZY-EDIT`(코지 에디트 — 홈·라운지웨어 3개 카테고리 묶음)**의 의미를 알 수 없어 AI 에이전트가 엉뚱한 SQL을 작성하는 **지표 환각**이 발생합니다.

이 핸즈온에서는 모든 데이터와 카탈로그 메타데이터를 **한국 서울 리전(`asia-northeast3`)**에 통일하여 구성하고, 실제로 AI 에이전트의 SQL 생성에 관여하는 **3가지 핵심 메타데이터 기능**을 두 앱 비교 방식으로 검증합니다.

1. **동의어 매핑 (`동의어 / Synonyms`)**: 사용자가 영문 약어(`NRR`, `COZY-EDIT`) 대신 한글 일상 용어(**`실현 순매출`**, **`코지 에디트`**)로 질문해도 표준 비즈니스 용어를 찾아내는지 실험합니다.
2. **물리 테이블·컬럼 매핑 (`관련 항목 / Related entries`)**: 비즈니스 용어와 실제 BigQuery 물리 테이블·컬럼(**`order_items.sale_price`**, **`order_items.status`**, **`products.category`**)이 정확히 연결되는지 실험합니다.
3. **비즈니스 필터 및 SQL 산출식 주입 (`개요 / Overview` 및 `관점 / Aspects`)**: 단순 합계가 아닌 취소·반품 제외 수식(`status NOT IN ('Cancelled', 'Returned')`)과 3개 카테고리 필터(`category IN (...)`)가 생성되는 SQL에 자동 반영되는지 실험합니다.

---

## 리전 구성 한눈에 보기 (`asia-northeast3` 서울 리전 통일)

| 구성 요소 | 리전 / 위치 (`Location`) | 비고 |
| :--- | :--- | :--- |
| **BigQuery 데이터셋 (`thelook_ecommerce`)** | **`asia-northeast3 (서울 / Seoul)`** | `products`, `order_items` 테이블 생성과 동시에 `@bigquery` 엔트리가 서울 리전에 자동 수집됨 |
| **Knowledge Catalog 관점 유형 (`semantic-sql-rule`)** | **`asia-northeast3 (서울 / Seoul)`** | SQL 산출식 및 조인·필터 조건을 담는 커스텀 Aspect 템플릿 |
| **Knowledge Catalog 비즈니스 용어집 (`thelook-business-glossary`)** | **`asia-northeast3 (서울 / Seoul)`** | `NRR`, `COZY-EDIT` 용어 등록 및 서울 리전 BigQuery 컬럼과 직접 연결 |
| **Gemini Enterprise 앱 (`thelook-without-kc` / `thelook-with-kc`)** | **`global (전역)`** | 앱은 `global`에서 생성하며, 서울 리전(`asia-northeast3`)의 BigQuery 및 Knowledge Catalog 자산을 자동 조회함 |

---

## 실습 1. BigQuery Studio에서 한국 서울 리전(`asia-northeast3`)에 실습 테이블 생성하기

> [!TIP]
> **왜 공개 데이터셋(`bigquery-public-data`)을 바로 `SELECT` 하지 않나요?**  
> 구글 공개 데이터셋(`bigquery-public-data.thelook_ecommerce`)은 `US`(미국) 멀티 리전에 있어서, 서울 리전(`asia-northeast3`) 데이터셋에서 바로 `CREATE TABLE ... AS SELECT * FROM bigquery-public-data...`를 실행하면 **리전 불일치 오류(`Not found in location asia-northeast3`)**가 발생합니다.  
> 아래 SQL은 리전 간 복사 오류 없이 **서울 리전(`asia-northeast3`)에 1초 만에 생성**되면서, 취소·반품 제외(`NRR`)와 3개 카테고리 필터(`COZY-EDIT`)의 정답/오답 차이가 딱 떨어지는 금액(`$1,000` vs. `$1,350`, `$2,000` vs. `$2,450`)으로 즉시 검증되도록 설계된 쿼리입니다.

### BigQuery Studio에서 서울 리전 테이블 생성 SQL 실행하기

1. Google Cloud 콘솔 좌측 상단 **탐색 메뉴(☰)**에서 **BigQuery** > **Studio**를 클릭합니다.
2. 편집기 상단 탭 바에서 **+ SQL 쿼리 (`+ SQL query`)** 버튼을 클릭해 새 쿼리 창을 엽니다.
3. 아래 SQL 쿼리를 복사해 붙여넣고 **실행 (`Run`)** 버튼을 클릭합니다.

```sql
-- 1. 한국 서울 리전(asia-northeast3)에 thelook_ecommerce 데이터셋 생성
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
--    * 코지 에디트 확정 주문(Complete/Shipped/Processing) 합계 = 정확히 $1,000.00 (6건)
--    * 코지 에디트 취소·반품(Cancelled/Returned) 합계 = $350.00 (2건) -> NRR에서 제외되어야 함!
--    * 기타 카테고리 확정 주문 합계 = $1,000.00 (3건) / 취소 = $100.00 (1건)
--    * 쇼핑몰 전체 실현 순매출(NRR) 정답 = 정확히 $2,000.00 (확정 9건) / 단순 합산 오답 = $2,450.00 (전체 12건)
CREATE OR REPLACE TABLE `thelook_ecommerce.order_items` AS
SELECT * FROM UNNEST([
  -- [코지 에디트 - 확정 주문 6건: 합계 $1,000.00]
  STRUCT(1 AS id, 1001 AS order_id, 101 AS product_id, 'Complete' AS status, 150.00 AS sale_price),
  STRUCT(2, 1002, 102, 'Shipped', 150.00),
  STRUCT(3, 1003, 201, 'Complete', 120.00),
  STRUCT(4, 1004, 202, 'Processing', 130.00),
  STRUCT(5, 1005, 301, 'Complete', 200.00),
  STRUCT(6, 1006, 302, 'Complete', 250.00),
  -- [코지 에디트 - 취소·반품 주문 2건: 합계 $350.00 (NRR 산출 시 반드시 제외되어야 함)]
  STRUCT(7, 1007, 101, 'Cancelled', 150.00),
  STRUCT(8, 1008, 301, 'Returned', 200.00),
  -- [기타 카테고리(Active, Outerwear) - 확정 주문 3건: 합계 $1,000.00 / 취소 1건: $100.00]
  STRUCT(9, 1009, 401, 'Complete', 200.00),
  STRUCT(10, 1010, 401, 'Shipped', 200.00),
  STRUCT(11, 1011, 501, 'Complete', 600.00),
  STRUCT(12, 1012, 401, 'Cancelled', 100.00)
]);
```

4. 약 2~3초 후 쿼리가 완료되면 좌측 **탐색기 (`Explorer`)** 패널에 서울 리전(`asia-northeast3`)의 `thelook_ecommerce` 데이터셋과 2개의 핵심 테이블(`products`, `order_items`)이 생성된 것을 확인합니다.

![BigQuery Studio 서울 리전 데이터셋 생성 화면](images/step1_bigquery_copy.png)

---

## 실습 2. Knowledge Catalog에 서울 리전(`asia-northeast3`)으로 용어집 및 메타데이터 등록하기

이제 서울 리전(`asia-northeast3`)에 생성된 물리 테이블 위에 비즈니스 맥락을 입힙니다. 먼저 Knowledge Catalog 용어 상세 화면의 **5가지 영역**을 확인한 뒤, 실험할 **2개의 핵심 용어(`NRR`, `COZY-EDIT`)**를 등록합니다.

### Knowledge Catalog 용어 상세 화면의 5가지 영역 이해하기

**Dataplex > 비즈니스 용어집 (`Business glossaries`)**에서 개별 용어를 클릭하면 화면이 아래 **5가지 영역(①~⑤)**과 우측 **동의어 (`Synonyms`)** 패널로 나뉩니다.

![Knowledge Catalog 용어 상세 화면 5대 영역](images/step2_real_kc_term_sections.png)

| 화면 영역 (한국어 / 영문 UI) | 핵심 역할 | Gemini Enterprise 에이전트가 활용하는 방식 | 이번 핸즈온 실습 범위 |
| :--- | :--- | :--- | :--- |
| **① 설명 (`Description`)** (`✏️ 수정 / Edit`) | **1~2문장 핵심 요약 정의** (검색 결과 카드 및 컬럼 툴팁에 노출) | 컬럼에 용어가 연결되어 있으면 에이전트가 테이블 맥락(`lookup_context`)을 조회할 때 컬럼 스키마 옆에 **1차로 자동 주입**됩니다. | **필수 입력** (간결한 1~2문장 비즈니스 정의) |
| **② 개요 (`Overview`)** (`+ 추가 / + Add`) | **상세 비즈니스 배경 및 포함/제외 규칙** (리치 텍스트 문서) | 시스템 Aspect(`overview`)에 저장되며, `lookup_context` 및 `lookup_entry` 호출 시 **어떤 상태값이나 카테고리를 포함·제외해야 하는지** 상세 지침을 전달합니다. | **필수 입력** (취소·반품 제외 기준, 3대 카테고리 포함 기준) |
| **③ 관점 (`Aspects`)** (`+ 추가 / + Add`) | **구조화된 커스텀 메타데이터 (Key-Value)** | 사용자가 정의한 관점 유형 템플릿(`semantic-sql-rule`)에 따라 **SQL 산출 수식(`sql_expression`), 대상 테이블(`target_tables`), 필터 조건**을 정형 필드로 저장하며, 에이전트가 `lookup_entry` 호출 시 읽어갑니다. | **필수 입력** (`semantic-sql-rule` 수식 연결) |
| **④ 데이터 품질 규칙 (`Data quality rules`)** | **용어 기반 데이터 품질 검증 규칙** (`Range check`, `Set check` 등) | 이 용어가 연결된 BigQuery 컬럼에 대해 Dataplex 자동 데이터 품질 스캔(Auto DQ)을 실행할 때 검증 규칙을 일괄 상속합니다. | **생략** *(AI SQL 생성 실험이 목적이므로 본 실습에서는 건너뜁니다)* |
| **⑤ 관련 항목 (`Related entries`)** (`+ 추가 / + Add`) | **물리 테이블 및 컬럼 매핑** (시맨틱 연결고리) | 비즈니스 용어(`@dataplex`)와 실제 BigQuery 물리 테이블·컬럼(`@bigquery`의 `order_items.sale_price`, `products.category`)을 양방향으로 연결합니다. | **필수 입력** (테이블 및 컬럼 연결 실험) |
| **우측 패널: 동의어 (`Synonyms`)** (`+ 추가 / + Add`) | **동의어 및 현업 은어 별칭** | 사용자가 영문 코드(`NRR`) 대신 한글 동의어(**`순매출`**, **`코지 에디트`**)로 질문했을 때 `search` 도구가 해당 용어를 찾아내도록 연결합니다. | **필수 입력** (한글 동의어 검색 실험) |

---

### Step 2-1. 서울 리전(`asia-northeast3`)에 `semantic-sql-rule` 관점 유형(`Aspect type`) 만들기

용어의 **③ 관점 (`Aspects`)** 영역에 SQL 산출 수식과 필터 조건을 구조화해 넣으려면 먼저 관점 유형(Aspect Type, 메타데이터 템플릿)을 하나 생성합니다.

1. Google Cloud 콘솔 좌측 메뉴에서 **Dataplex** > **관점 유형 (`Aspect types`)** *(또는 **관리 / Manage** > **관점 유형 및 항목 그룹 / Aspect types & entry groups**)*으로 이동한 뒤 **관점 유형 만들기 (`Create aspect type`)**를 클릭합니다.
2. 기본 정보를 다음과 같이 입력합니다.
   - **표시 이름 (`Display name`)**: `Semantic Metric & SQL Calculation Rule`
   - **관점 유형 ID (`Aspect type ID`)**: `semantic-sql-rule`
   - **위치 (`Location`)**: **`asia-northeast3 (Seoul)`** *(서울 리전 선택)*
3. 아래 **3개의 핵심 텍스트 (`String / Text`) 필드**를 추가하고 **만들기 (`Create`)**를 클릭합니다.
   - `sql_expression` *(표준 GoogleSQL 집계 수식 또는 조건식)*
   - `target_tables` *(조회할 대상 BigQuery 테이블명)*
   - `filter_or_join_rule` *(필수 WHERE 조건 또는 JOIN 키)*

---

### Step 2-2. 서울 리전(`asia-northeast3`)에 비즈니스 용어집 만들기

1. 좌측 메뉴에서 **Dataplex** > **비즈니스 용어집 (`Business glossaries`)**으로 이동한 뒤 **비즈니스 용어집 만들기 (`Create business glossary`)**를 클릭합니다.
2. 아래 표와 같이 입력하고 **만들기 (`Create`)**를 클릭합니다.

| 설정 항목 (한국어 / 영문 UI) | 입력값 |
| :--- | :--- |
| **표시 이름 (`Display name`)** | **TheLook 전사 공통 용어집** |
| **용어집 ID (`Glossary ID`)** | **thelook-business-glossary** |
| **위치 (`Location`)** | **asia-northeast3 (Seoul)** |
| **설명 (`Description`)** | **전사 공통 매출 지표(NRR) 및 전략 큐레이션 상품군(COZY-EDIT) 표준 용어집입니다.** |

![Knowledge Catalog 비즈니스 용어집 생성 화면](images/step2a_kc_glossary_create.png)

---

### Step 2-3. 핵심 용어 2개(`NRR`, `COZY-EDIT`) 추가 및 메타데이터 연결하기

생성된 **TheLook 전사 공통 용어집**(`thelook-business-glossary`) 안으로 들어가 **+ 용어 추가 (`+ Add term`)**를 클릭하여 아래 **2개의 용어**만 등록합니다.

> [!IMPORTANT]
> **💡 `⑤ 관련 항목 (Related entries)`에서 테이블이 아닌 '특정 컬럼(열)'을 연결하는 방법 (콘솔 UI 주의사항)**
> 용어 상세 화면의 **`⑤ 관련 항목 (Related entries)` > `+ 추가 (+ Add)`** 창은 기본 상태에서 테이블 목록만 보여주고 **`열 이름 (Column Name)`** 칸을 숨겨둡니다. 따라서 아무 필터 없이 테이블 체크박스를 선택하면 `Column Name: -` (테이블 단위 연결)로만 등록됩니다. **특정 컬럼(`sale_price`, `category` 등)까지 정확히 연결하려면 아래 두 가지 방법 중 하나를 사용하세요.**
>
> 1. **방법 A (가장 직관적 — 테이블 `스키마 / Schema` 탭에서 연결하기, 권장):**
>    - 좌측 메뉴 **Dataplex > 검색 (`Search`)**에서 테이블 이름(`order_items` 또는 `products`)을 검색해 클릭합니다.
>    - 테이블 상세 화면의 **`스키마 (`Schema`)`** 탭으로 이동한 뒤, 연결할 컬럼(**`sale_price`**, **`status`** 등) 좌측 체크박스를 선택하고 상단의 **`비즈니스 용어 추가 (`Add business term`)`** 버튼을 눌러 용어(`NRR`)를 선택합니다.
> 2. **방법 B (`⑤ 관련 항목 / Related entries > + 추가 / + Add` 창 안에서 필터 칩으로 연결하기):**
>    - `+ 추가 (+ Add)` 창 상단의 **필터 (`Filter`)** 입력란을 클릭하고 드롭다운에서 반드시 **`열 이름 (`Column Name`)`**을 선택한 뒤 컬럼명(예: **`Column Name : sale_price`**)을 입력합니다.
>    - 필터 칩이 생성되는 즉시 숨겨져 있던 **`Column Name`** 열이 화면에 나타나며, 이때 표시되는 컬럼 행을 체크하고 **추가 (`Add`)**를 클릭합니다. *(주의: 필터 칩을 넣기 전에 미리 체크해 둔 테이블 행이 있으면 체크를 해제하세요.)*

---

#### 📌 용어 1: `NRR` (동의어 + 취소·반품 제외 Aspect 수식 + `order_items` 컬럼 매핑 실험용)

- **표시 이름 (`Display name`)**: `NRR`
- **용어 ID (`Term ID`)**: `nrr`

| 용어 상세 화면 영역 | 조작 방법 | 입력할 내용 |
| :--- | :--- | :--- |
| **① 설명 (`Description`)** | `✏️ 수정 (Edit)` 클릭 | `전체 주문 금액 중 주문 취소(Cancelled) 및 반품(Returned) 건을 제외하고 기업에 실제로 귀속된 최종 실현 순매출액(Net Realized Revenue)입니다.` |
| **② 개요 (`Overview`)** | `+ 추가 (+ Add)` 클릭 | **• 산출 목적**: 단순 판매가 합계(총거래액 GMV) 착시를 방지하고 취소·반품을 차감한 실질 귀속 매출 산출<br>**• 포함/제외 기준**: `Complete`, `Shipped`, `Processing` 상태는 포함하며, **`Cancelled`(주문 취소) 및 `Returned`(반품 완료) 상태는 반드시 제외**<br>**• 기준 컬럼**: `thelook_ecommerce.order_items` 테이블의 `sale_price`(판매 단가) 및 `status`(주문 상태) |
| **③ 관점 (`Aspects`)** | `+ 추가 (+ Add)` 클릭 후 **`Semantic Metric & SQL Calculation Rule`** 선택 | • **sql_expression**: `SUM(CASE WHEN order_items.status NOT IN ('Cancelled', 'Returned') THEN order_items.sale_price ELSE 0 END)`<br>• **target_tables**: `thelook_ecommerce.order_items`<br>• **filter_or_join_rule**: `order_items.status NOT IN ('Cancelled', 'Returned')` |
| **⑤ 관련 항목 (`Related entries`)** | 테이블 `Schema` 탭 또는 `+ Add` (`Column Name` 필터) | **`order_items`** 테이블의 **`sale_price`**, **`status`** 컬럼 연결 |
| **우측 패널: 동의어 (`Synonyms`)** | `+ 추가 (+ Add)` 클릭 | `순매출`, `실현 순매출`, `실현매출`, `Net Realized Revenue` |

---

#### 📌 용어 2: `COZY-EDIT` (동의어 + 3개 카테고리 필터 Aspect/Overview + `products` 컬럼 매핑 실험용)

- **표시 이름 (`Display name`)**: `COZY-EDIT`
- **용어 ID (`Term ID`)**: `cozy-edit`

| 용어 상세 화면 영역 | 조작 방법 | 입력할 내용 |
| :--- | :--- | :--- |
| **① 설명 (`Description`)** | `✏️ 수정 (Edit)` 클릭 | `사내 MD와 마케터가 홈웨어, 잠옷, 이너웨어 및 후드/스웻셔츠 등 실내외 이지웨어 주력 상품군 3종을 하나로 묶어 부르는 사내 전략 큐레이션 용어입니다.` |
| **② 개요 (`Overview`)** | `+ 추가 (+ Add)` 클릭 | **• 포함 물리 카테고리 (3종)**: `products.category` 컬럼 값이 **`'Sleep & Lounge'`**, **`'Intimates'`**, **`'Fashion Hoodies & Sweatshirts'`**인 상품만 포함<br>**• 제외 주의사항**: `'Active'`(스포츠웨어)나 `'Outerwear & Coats'`는 코지 에디트에서 제외함 (물리 DB에는 `'COZY-EDIT'`이라는 카테고리 문자열이 존재하지 않음) |
| **③ 관점 (`Aspects`)** | `+ 추가 (+ Add)` 클릭 후 **`Semantic Metric & SQL Calculation Rule`** 선택 | • **sql_expression**: `products.category IN ('Sleep & Lounge', 'Intimates', 'Fashion Hoodies & Sweatshirts')`<br>• **target_tables**: `thelook_ecommerce.products`<br>• **filter_or_join_rule**: `order_items.product_id = products.id` |
| **⑤ 관련 항목 (`Related entries`)** | 테이블 `Schema` 탭 또는 `+ Add` (`Column Name` 필터) | **`products`** 테이블의 **`category`** 컬럼 연결 |
| **우측 패널: 동의어 (`Synonyms`)** | `+ 추가 (+ Add)` 클릭 | `코지 에디트`, `코지에디트`, `홈웨어 큐레이션` |

![Knowledge Catalog 컬럼 매핑 확인 화면](images/step2b_kc_column_link.png)

---

## 실습 3. Gemini Enterprise에서 BigQuery 연결 및 두 가지 비교 앱 만들기

이제 **Gemini Enterprise**에서 BigQuery 데이터 스토어를 연결하고, **Knowledge Catalog 연동 여부만 다른 두 개의 앱(`thelook-without-kc` vs. `thelook-with-kc`)**을 만들어 실제 동작 차이를 비교할 준비를 합니다.

> [!TIP]
> **별도의 OAuth 2.0 Client ID 발급이 필요 없는 이유:**  
> Gemini Enterprise의 기본 제공(자사 데이터 소스 / First-party) **BigQuery (`제휴 쿼리 / Federated query`)** 커넥터와 **Knowledge Catalog 사용 설정 (`Enable Knowledge Catalog`)** 기능은 구글 내부 **1P Offline OAuth** 인증을 자동으로 처리하며, 서울 리전(`asia-northeast3`)에 있는 BigQuery 데이터셋과 Knowledge Catalog 엔트리를 자동으로 검색·조회합니다.

### Step 3-1. BigQuery (`제휴 쿼리 / Federated query`) 데이터 스토어 생성 및 작업 활성화

1. Google Cloud 콘솔에서 **Gemini Enterprise** > **데이터 스토어 (`Data stores`)**로 이동한 뒤 **+ 데이터 스토어 만들기 (`+ Create data store`)**를 클릭합니다.
2. **자사 데이터 소스 (`First-party data sources - Google Cloud`)** 목록에서 **BigQuery**를 선택합니다.
3. 연결 방식으로 **제휴 쿼리 (`Federated query - recommended`)**를 선택합니다.
4. 커넥터 설정을 다음과 같이 입력하고 **만들기 (`Create`)**를 클릭합니다.
   - **데이터 커넥터 이름 (`Data connector name`)**: `thelook-bigquery-federated`
   - **결제 프로젝트 ID (`Billing Project ID`)**: 현재 실습 중인 본인의 Google Cloud 프로젝트 ID 입력 *(예: `kc-handson-lab-01`)*
5. 생성된 **`thelook-bigquery-federated`** 데이터 스토어를 클릭해 상세 화면으로 들어간 뒤, **작업 (`Actions`)** 탭을 열어 아래 분석 도구 액션들이 활성화되어 있는지 확인(또는 체크 후 활성화)합니다.
   - **`Execute SQL (Read-Only)`** (`execute_sql_readonly`)
   - **`Get Table Info`** (`get_table_info`) 및 **`Get Dataset Info`** (`get_dataset_info`)
   - **`List Dataset IDs`** (`list_dataset_ids`) 및 **`List Table IDs`** (`list_table_ids`)
   - **`Get Query Results`** (`get_query_results`) 및 **`Get Job`** (`get_job`)

---

### Step 3-2. 비교 앱 ① 생성: Knowledge Catalog 미적용 앱 (`thelook-without-kc`)

먼저 물리 BigQuery 스키마만 바라보고 Knowledge Catalog는 참조하지 않는 대조군 앱을 만듭니다.

1. **Gemini Enterprise** 좌측 메뉴에서 **앱 (`Apps`)**을 클릭하고 **+ 앱 만들기 (`+ Create app`)**를 클릭합니다.
2. 아래와 같이 설정하고 **만들기 (`Create`)**를 클릭합니다.
   - **앱 이름 (`App name`)**: **`thelook-without-kc`**
   - **위치 (`Location`)**: **`global (Global)`**
   - **데이터 스토어 연결**: 방금 만든 **`thelook-bigquery-federated`** 선택 및 연결
3. 생성된 **`thelook-without-kc`** 앱의 좌측 메뉴에서 **구성 (`Configurations`)** > **어시스턴트 (`Assistant`)** 탭을 확인합니다.
   - **Knowledge Catalog 사용 설정 (`Enable Knowledge Catalog`)** 토글이 **꺼진 상태 (`Off`, 기본값)**인지 확인합니다. *(이 앱은 오직 BigQuery 물리 테이블·컬럼 스키마만 볼 수 있습니다.)*

---

### Step 3-3. 비교 앱 ② 생성: Knowledge Catalog 적용 앱 (`thelook-with-kc`)

이번에는 동일한 BigQuery 데이터 스토어를 바라보면서 **Knowledge Catalog 연동만 켠** 실험군 앱을 만듭니다.

1. 다시 **Gemini Enterprise** > **앱 (`Apps`)**으로 이동해 **+ 앱 만들기 (`+ Create app`)**를 클릭합니다.
2. 아래와 같이 설정하고 **만들기 (`Create`)**를 클릭합니다.
   - **앱 이름 (`App name`)**: **`thelook-with-kc`**
   - **위치 (`Location`)**: **`global (Global)`**
   - **데이터 스토어 연결**: 동일한 **`thelook-bigquery-federated`** 데이터 스토어 선택 및 연결
3. 생성된 **`thelook-with-kc`** 앱의 좌측 메뉴에서 **구성 (`Configurations`)** > **어시스턴트 (`Assistant`)** 탭으로 이동합니다.
4. 화면 아래쪽의 **Knowledge Catalog 사용 설정 (`Enable Knowledge Catalog`)** 토글을 **켬 (`On`)**으로 변경하고 **저장 (`Save` 또는 `Save and publish`)**을 클릭합니다.
   - *(이 토글을 켜면 에이전트가 내장 카탈로그 도구를 통해 서울 리전(`asia-northeast3`)에 등록된 용어집, 컬럼 매핑, Aspect 수식을 자동으로 읽어옵니다.)*

![Gemini Enterprise 두 앱(thelook-without-kc vs thelook-with-kc) 구성 비교 화면](images/step4b_ge_app_assistant_kc.png)

---

## 실습 4. 두 앱(`thelook-without-kc` vs. `thelook-with-kc`) 나란히 비교 실험하기

각 앱의 **통합 (`Integration`)** 또는 **개요 (`Overview`)** 탭에 있는 **웹앱 URL (`Web App URL`)** 링크를 클릭하여 브라우저 탭 두 개에 **`thelook-without-kc`** 웹앱과 **`thelook-with-kc`** 웹앱을 나란히 띄웁니다.  
*(첫 질문 실행 시 BigQuery 권한 승인 안내 배너가 나타나면 **승인 (`Authorize`)**을 눌러 본인 계정으로 승인합니다.)*

우리가 실습 2에서 구성한 **① 동의어 (`Synonyms`)**, **② 관련 항목 (`Related entries` 테이블·컬럼 매핑)**, **③ 관점·개요 (`Aspects / Overview` SQL 수식 및 필터)** 3가지가 실제로 작동하는지 아래 **3가지 테스트 케이스**로 직접 확인해 보세요.

---

### 🧪 테스트 케이스 1: [동의어 + Aspect 수식 실험] 한글 동의어(`실현 순매출`) 질문 시 취소·반품 제외 수식이 적용되는가?

영문 용어명(`NRR`)이나 취소·반품 제외 조건을 프롬프트에 전혀 적지 않고, 우리가 등록한 한글 **동의어(`실현 순매출`)**만으로 질문해 봅니다.

> **💬 입력 프롬프트 (두 앱에 동일하게 입력):**
> ```text
> 우리 쇼핑몰의 전체 '실현 순매출' 합계와 해당 주문 상품 건수를 알려줘. 실행한 SQL 쿼리 조건도 함께 설명해 줘.
> ```

| 비교 항목 | ❌ `thelook-without-kc` (Knowledge Catalog 꺼짐) | ✅ `thelook-with-kc` (Knowledge Catalog 켜짐) |
| :--- | :--- | :--- |
| **동의어(`실현 순매출`) 해석** | 카탈로그 검색 불가 — 일반 상식에 의존해 `order_items.sale_price` 단순 합계로 추측 | **`동의어 (Synonyms)`(`실현 순매출`)** 검색을 통해 서울 리전의 표준 용어 **`NRR`** 엔트리를 정확히 식별 |
| **생성된 SQL 로직 차이** | `status` 필터를 누락하고 취소(`Cancelled`)·반품(`Returned`) 건까지 모두 합산 | **`③ 관점 (Aspects)`(`semantic-sql-rule`)** 및 **`② 개요 (Overview)`**에 정의된 **`order_items.status NOT IN ('Cancelled', 'Returned')`** 조건을 정확히 반영 |
| **실제 쿼리 결과값 비교** | **`$2,450.00 [약 338만 원]` (전체 12건)** — 취소·반품 `$450.00`(3건)이 섞인 **오답** | **`$2,000.00 [약 276만 원]` (확정 9건)** — 취소·반품 3건을 정확히 제외한 **정답** |

---

### 🧪 테스트 케이스 2: [테이블·컬럼 매핑 + Overview/Aspect 필터 실험] 사내 용어(`코지 에디트`)가 물리 테이블(`products.category`)의 3개 카테고리로 변환되는가?

물리 DB(`products.category`)에는 `'COZY-EDIT'`이나 `'코지 에디트'`라는 문자열이 전혀 없습니다. 한글 동의어인 **`코지 에디트`**로 질문했을 때 물리 테이블 `products`의 `category` 컬럼 3종으로 변환되는지 확인합니다.

> **💬 입력 프롬프트 (두 앱에 동일하게 입력):**
> ```text
> '코지 에디트' 상품군에는 어떤 카테고리가 포함되는지, 각 카테고리별 등록 상품 수(products 테이블 기준)를 조회해 줘.
> ```

| 비교 항목 | ❌ `thelook-without-kc` (Knowledge Catalog 꺼짐) | ✅ `thelook-with-kc` (Knowledge Catalog 켜짐) |
| :--- | :--- | :--- |
| **용어 검색 및 테이블 탐색** | `products` 테이블에서 `WHERE category LIKE '%Cozy%'` 또는 `= '코지 에디트'`를 실행 | **`동의어 (Synonyms)`(`코지 에디트`)**로 **`COZY-EDIT`** 용어를 찾고 **`⑤ 관련 항목 (Related entries)`**에 연결된 **`products.category`** 컬럼 확인 |
| **실제 쿼리 결과값 비교** | 매칭되는 행이 없어 **`0건 (해당 상품 없음)`** 반환 | **`Sleep & Lounge`(2개), `Intimates`(2개), `Fashion Hoodies & Sweatshirts`(2개) — 총 6개 상품** 정확히 집계 (`Active`, `Outerwear & Coats`는 정확히 제외!) |

---

### 🧪 테스트 케이스 3: [통합 시나리오] 두 용어(`코지 에디트` + `실현 순매출`) 결합 및 테이블 자동 조인(`products` ⋈ `order_items`) 실험

마지막으로 두 비즈니스 용어를 한 문장에 섞어 질문했을 때, 에이전트가 두 용어의 메타데이터를 모두 조회해 `products`와 `order_items` 테이블을 정확히 조인(`order_items.product_id = products.id`)하는지 확인합니다.

> **💬 입력 프롬프트 (두 앱에 동일하게 입력):**
> ```text
> 우리 회사의 '코지 에디트' 상품군의 '실현 순매출'과 확정 주문 건수는 얼마야? 카테고리별 내역도 함께 보여줘.
> ```

* **`thelook-without-kc` (Knowledge Catalog 꺼짐)**: `'코지 에디트'` 카테고리를 찾지 못해 조회 결과가 **`0건`**으로 나오거나, 취소·반품(`$350.00`)이 포함된 잘못된 매출액(**`$1,350.00`**)을 출력합니다.
* **`thelook-with-kc` (Knowledge Catalog 켜짐 — 정답!)**:
  1. Knowledge Catalog에서 **`COZY-EDIT`**(`products.category IN ('Sleep & Lounge', 'Intimates', 'Fashion Hoodies & Sweatshirts')`)과 **`NRR`**(`order_items.status NOT IN ('Cancelled', 'Returned')`, `SUM(order_items.sale_price)`) 두 용어의 정의, 연결된 컬럼, Aspect SQL 규칙을 동시에 가져옵니다.
  2. 두 테이블(`thelook_ecommerce.order_items`와 `thelook_ecommerce.products`)을 조인하여 코지 에디트 3개 카테고리별 실현 순매출(`Fashion Hoodies & Sweatshirts` **`$450.00 [약 62만 원]`**, `Sleep & Lounge` **`$300.00 [약 41만 원]`**, `Intimates` **`$250.00 [약 35만 원]`**)과 총 실현 순매출(**정확히 `$1,000.00 [약 138만 원]`**, 확정 주문 **6건**)을 완벽히 반환합니다!

![Gemini Enterprise 웹앱 두 앱 비교 실험 결과 화면](images/step5_ge_chat_aha_moment.png)
