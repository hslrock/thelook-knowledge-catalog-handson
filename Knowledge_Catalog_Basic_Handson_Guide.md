# Configuring Knowledge Catalog and BigQuery in Gemini Enterprise

> [!NOTE]
> **1차 기본 핸즈온 가이드 (Zero Asset Initialization · 100% Console-First · Zero Custom OAuth Setup)**  
> 별도의 GitHub 클론, 초기화 스크립트, Antigravity VM 사전 준비나 복잡한 OAuth 2.0 Client ID 발급 없이 **Google Cloud Console 화면만으로** 공개 리테일 데이터셋을 즉시 복제하고, **Knowledge Catalog** 비즈니스 용어집 등록부터 **Gemini Enterprise 1P BigQuery Federated 커넥터 & Knowledge Catalog 연동**, 자연어 질의(Aha! Moment)까지 20~30분 만에 완주하는 실습 가이드입니다.

---

## Overview

기업의 데이터 웨어하우스에 생성형 AI 에이전트를 연결할 때 가장 흔히 겪는 실패 원인은 **맥락이 없는 물리 스키마(Context-less Raw Schema)**입니다. 데이터베이스 컬럼명(`sale_price`, `status`, `category`)만으로는 사내 고유 지표인 **`NRR`(실현 순매출 — 취소·반품 제외)**이나 전략 큐레이션 상품군인 **`COZY-EDIT`(코지 에디트 — 홈·라운지웨어 3개 카테고리 묶음)**의 정의를 알 수 없어 AI 에이전트가 엉터리 SQL을 작성하는 **지표 환각(Metric Hallucination)**이 발생합니다.

이 핸즈온 실습에서는 **Google Cloud Knowledge Catalog**와 **Gemini Enterprise**의 내장 **BigQuery Federated Query(MCP 기반) 커넥터** 및 **Knowledge Catalog 통합 토글**을 사용해, 별도의 에이전트 코딩이나 OAuth 클라이언트 설정 없이 비즈니스 메타데이터만으로 AI 에이전트의 SQL 정확도를 100%로 끌어올리는 과정을 직접 구현합니다.

---

## What you'll learn

In this lab, you learn how to perform the following tasks:

* Copy the canonical retail dataset into your project in **BigQuery Studio** using a single SQL query.
* Create a **Business Glossary** in **Knowledge Catalog**, structure business terms (`NRR`, `COZY-EDIT`, `OTIF-72`) across the 5 native term sections (`Description`, `Overview`, `Aspects`, `Data quality rules`, `Related entries`), and link them to physical BigQuery columns.
* Connect **BigQuery** (`Federated query`) in **Gemini Enterprise**, enable analytical tool actions, and turn on the **Enable Knowledge Catalog** assistant toggle (using Google's built-in 1P OAuth with zero manual OAuth Client ID setup).
* Verify the **Before vs. After (Aha! Moment)** in the **Gemini Enterprise** web app.

---

## Task 1. Copy the retail dataset in BigQuery Studio

In this task, you copy the five core e-commerce tables from the `bigquery-public-data.thelook_ecommerce` public dataset directly into your Google Cloud project without running any external initialization scripts.

### Run the dataset replication query in BigQuery Studio

1. In the Google Cloud console, in the **Navigation menu** (☰), click **BigQuery** > **Studio**.
2. In the SQL editor tab bar, click **+** (**SQL query**) to open a new query tab.
3. Paste the following SQL statements into the query editor:

```sql
-- 1. Create thelook_ecommerce dataset in the US multi-region
CREATE SCHEMA IF NOT EXISTS `thelook_ecommerce`
OPTIONS(location = 'US');

-- 2. Replicate 5 core retail tables directly from bigquery-public-data
CREATE OR REPLACE TABLE `thelook_ecommerce.orders` AS
SELECT * FROM `bigquery-public-data.thelook_ecommerce.orders`;

CREATE OR REPLACE TABLE `thelook_ecommerce.order_items` AS
SELECT * FROM `bigquery-public-data.thelook_ecommerce.order_items`;

CREATE OR REPLACE TABLE `thelook_ecommerce.products` AS
SELECT * FROM `bigquery-public-data.thelook_ecommerce.products`;

CREATE OR REPLACE TABLE `thelook_ecommerce.users` AS
SELECT * FROM `bigquery-public-data.thelook_ecommerce.users`;

CREATE OR REPLACE TABLE `thelook_ecommerce.distribution_centers` AS
SELECT * FROM `bigquery-public-data.thelook_ecommerce.distribution_centers`;
```

4. Click **Run**.
   The query completes in approximately 5 seconds and creates the `thelook_ecommerce` dataset and 5 tables (`orders`, `order_items`, `products`, `users`, `distribution_centers`) in the `US` multi-region.

![BigQuery Studio dataset replication screen](images/step1_bigquery_copy.png)

> [!TIP]
> **Auto-Ingestion into Knowledge Catalog:** As soon as the BigQuery tables are created, **Knowledge Catalog** automatically harvests and indexes their technical metadata under the `@bigquery` entry group with zero wait time (`$0 [약 0원]` for automatically ingested technical metadata).

---

## Task 2. Create a Business Glossary and structure Term metadata in Knowledge Catalog

In this task, you create a Business Glossary in **Knowledge Catalog** and populate its core retail business terms (`NRR`, `COZY-EDIT`, `OTIF-72`). Instead of cramming SQL code and business context into a single `Description` text box, you will structure each term across the **5 native sections** of the Knowledge Catalog Term Details screen (`Description`, `Overview`, `Aspects`, `Data quality rules`, and `Related entries`).

### Understand the 5 sections of a Knowledge Catalog Glossary Term

When you open a term inside **Dataplex > Business glossaries**, the term detail page is divided into 5 functional sections (plus **Synonyms & Related terms** on the right-hand panel):

![Real Knowledge Catalog Glossary Term 5 Sections](images/step2_real_kc_term_sections.png)

| UI Section | Architectural Role | Internal Storage & How AI Agents / Dataplex Consume It at Runtime | What to Put Here |
| :--- | :--- | :--- | :--- |
| **① Description** (`✏️ Edit`) | **1–2 sentence plain business definition** shown in search result cards and column tooltips. | Stored in `GlossaryTerm.description`. When a term is linked to a BigQuery column via `Related entries`, calling **`lookup_context`** on the table **automatically injects `Description` inline** alongside the column schema. | Concise business definition without long narrative walls (plus optional 1-line SQL summary if not using `lookup_entry`). |
| **② Overview** (`+ Add`) | **Rich-text documentation** (Wiki-style background, inclusion/exclusion rules, departmental notes). | Stored in system aspect `dataplex-types.global.overview` (`655216118709.global.overview`). Returned in the `overview` field of `lookup_context` and `lookup_entry` so humans and agents understand **business edge cases** (e.g., why shipping fees or gift cards are excluded). | Bullet points explaining business purpose, included/excluded order statuses, and departmental reporting caveats. |
| **③ Aspects** (`+ Add`) | **Schema-validated structured metadata** (Key-Value fields such as SQL formulas, target tables, join keys, or event dates). | Stored as custom Aspect Types (e.g., `semantic-sql-rule`, `event-range`) on the `@dataplex` term entry. Retrieved when an agent calls **`lookup_entry(view=ALL)`** (or filtered in Catalog Search by Aspect fields). | Structured SQL calculation fields: `rule_type`, `sql_expression`, `target_tables`, `join_or_filter_condition`, `unit_or_return_type`. |
| **④ Data quality rules** (`+ Add`) | **Reusable Term-Level Data Quality Rules** that define data validity constraints for this business concept. | Stored in system aspect `dataplex-types.global.data-rules`. When this term is linked to any BigQuery column (`order_items.sale_price`), **Dataplex Auto Data Quality Scans can inherit and execute these rules automatically** across all linked columns without re-authoring rules per table. | Predefined template rules (`Range check`: `sale_price >= 0`, `Set check`: valid `status` values) or custom SQL validation rules (`VALIDITY`, `COMPLETENESS`). |
| **⑤ Related entries** (`+ Add`) | **Physical Data Asset & Column Mapping** (Semantic Grounding link between business term and physical schema). | Creates an `entryLinkTypes/definition` link between `@bigquery` (`path: Schema.<col>`) and the `@dataplex` term entry. Enables bidirectional navigation and automatic context injection in `lookup_context`. | Physical BigQuery tables and exact columns (`order_items.sale_price`, `order_items.status`, `products.category`, `orders.created_at`). |
| **우측 패널: Synonyms & Related terms** | **Search alias & semantic graph traversal** across alternative user phrasings. | Stored as term relationships. When a user asks *"순매출 알려줘"* instead of *"NRR"*, `search_entries` matches the synonym and resolves to `NRR`. | Synonyms (`순매출`, `실현매출`, `Net Realized Revenue`) and related KPIs (`MDR`, `HV-VIP`). |

> [!IMPORTANT]
> **Engineering Tip (`lookup_context` vs. `lookup_entry`):**
> By default, Dataplex's `lookup_context` API injects a linked term's **`displayName`**, **`Description`**, and **`Overview`**, whereas custom **`Aspects`** (`semantic-sql-rule`) are returned only when the agent calls **`lookup_entry(view=ALL)`** on the term entry. Separating business prose into `Description`/`Overview` and SQL formulas into `Aspects` (`semantic-sql-rule`) is the enterprise best practice—just make sure **`lookup_entry`** is enabled in your Gemini Enterprise MCP Actions (Task 4)!

---

### Step 2-1. (Optional Recommended) Create the `semantic-sql-rule` Aspect Type for ③ Aspects

To attach structured SQL rules in the **③ Aspects** section of each term, first create a reusable Aspect Type template:

1. In the Google Cloud console, go to **Dataplex** > **Catalog** (or **Manage** > **Aspect types**), and click **Create aspect type**.
2. Specify the following details:
   - **Display name**: `Semantic Metric & SQL Calculation Rule`
   - **Aspect type ID**: `semantic-sql-rule`
   - **Location**: `us (multi-region)`
3. Add the following **5 metadata fields** (all of type **String / Text**), and click **Create**:
   - `rule_type` *(e.g., AGGREGATION_METRIC, DIMENSION_FILTER, SLA_CONDITION)*
   - `sql_expression` *(Standard GoogleSQL formula or filter predicate)*
   - `target_tables` *(Target BigQuery table names)*
   - `join_or_filter_condition` *(Required WHERE or JOIN clause)*
   - `unit_or_return_type` *(e.g., FLOAT64 (USD $), STRING, INT64)*

---

### Step 2-2. Create the Business Glossary

1. In the Google Cloud console, go to **Dataplex** > **Business glossaries**, and click **Create business glossary**.
2. Specify the following settings, and click **Create**:

| Property | Value (type or select) |
| :--- | :--- |
| **Display name** | **TheLook 전사 공통 용어집** |
| **Glossary ID** | **thelook-business-glossary** |
| **Location** | **us (multi-region)** |
| **Description** | **모든 팀이 동일한 정의로 사용하는 전사 공통 큐레이션 용어(COZY-EDIT), 핵심 매출 지표(NRR), 물류 배송 SLA(OTIF-72) 표준 용어집입니다.** |

![Knowledge Catalog Business Glossary creation screen](images/step2a_kc_glossary_create.png)

---

### Step 2-3. Add the 3 core terms (`NRR`, `COZY-EDIT`, `OTIF-72`) and populate Sections ① ~ ⑤

Inside **TheLook 전사 공통 용어집** (`thelook-business-glossary`), click **+ Add term** to create each of the 3 terms below, and then fill in its **① Description**, **② Overview**, **③ Aspects**, **④ Data quality rules**, and **⑤ Related entries** right on the Term Details page.

> [!TIP]
> **💡 Why can't I see columns in `⑤ Related entries > + Add` by default? (How to link specific columns in the Console UI)**
> When you click **`+ Add`** under **`⑤ Related entries`** (*Add Related Entries* drawer), the table hides the **`Column Name`** column by default (`[hidden]="!hasColumnNameFilter"`) and only shows **table-level** rows (`Resource Name`, `Resource Type`). You can link a specific column in **two ways**:
> 1. **Method A — Inside `⑤ Related entries > + Add` (Use the `Column Name` Filter Chip):**
>    - Click the **Filter** bar (`Filter to find resources by name, type or column.`) at the top of the *Add Related Entries* drawer.
>    - From the filter property dropdown, select **`Column Name`** (do **not** just type the table name), and enter the column name—for example: **`Column Name : sale_price`** (plus optionally **`Resource Name : order_items`**).
>    - As soon as a **`Column Name`** filter chip is active, the hidden **`Column Name`** column appears in the table and lists each matching column (`order_items` $\rightarrow$ `sale_price`) as a selectable row!
> 2. **Method B — From the Table's `Schema` Tab (Recommended for multi-column selection):**
>    - Go to **Dataplex > Search** (or click the `order_items` table entry), open the **`order_items`** table page, and select the **`Schema`** tab.
>    - Check the boxes next to **`sale_price`** and **`status`**, click **`Add business term`** at the top of the schema table, and select **`NRR`**.

#### 📌 Term 1: `NRR` (실현 순매출)
- **Display name**: `NRR (Net Realized Revenue / 실현 순매출)`
- **Term ID**: `nrr`

| Section on Term Page | Action | Value to Enter |
| :--- | :--- | :--- |
| **① Description** | Click `✏️ Edit` | `전체 주문 금액 중 주문 취소(Cancelled) 및 반품(Returned) 건을 제외하고 기업에 실제로 귀속된 최종 실현 순매출액(KPI)입니다.` |
| **② Overview** | Click `+ Add` | **• 산출 목적**: 총거래액(GMV) 착시를 방지하고 취소·반품을 차감한 실질 귀속 매출 측정<br>**• 포함/제외 기준**: `Complete`, `Shipped`, `Processing` 상태는 포함하며, `Cancelled`(주문 취소) 및 `Returned`(반품 완료) 상태는 100% 제외<br>**• 산출 기준 컬럼**: 할인 적용 후 실제 판매 단가(`order_items.sale_price`) 합계 기준 |
| **③ Aspects** | Click `+ Add` > Select **`Semantic Metric & SQL Calculation Rule`** (`semantic-sql-rule`) | • **rule_type**: `AGGREGATION_METRIC (전사 표준 매출 지표)`<br>• **sql_expression**: `SUM(CASE WHEN order_items.status NOT IN ('Cancelled', 'Returned') THEN order_items.sale_price ELSE 0 END)`<br>• **target_tables**: `thelook_ecommerce.order_items`<br>• **join_or_filter_condition**: `order_items.status NOT IN ('Cancelled', 'Returned')`<br>• **unit_or_return_type**: `FLOAT64 (USD $)` |
| **④ Data quality rules** | Click `+ Add` *(Optional)* | • **Display name**: `non_negative_sale_price` (`Range check` / Dimension: `VALIDITY` / Parameter: `min_value = 0`)<br>• **Display name**: `valid_order_item_status` (`Set check` / Dimension: `VALIDITY` / Allowed values: `Complete, Shipped, Processing, Cancelled, Returned`) |
| **⑤ Related entries** | Click `+ Add` | In the **Filter** bar, select **`Column Name`** $\rightarrow$ enter **`sale_price`** (and **`status`**) with **`Resource Name : order_items`** $\rightarrow$ check the column rows and click **Add** *(or select columns in `order_items` > **Schema** tab > **Add business term**)* |
| **우측 패널: Synonyms** | Click `+ Add` | `순매출`, `실현 순매출`, `실현매출`, `Net Realized Revenue` |

---

#### 📌 Term 2: `COZY-EDIT` (코지 에디트 상품군)
- **Display name**: `코지 에디트 (COZY-EDIT / 홈·라운지웨어 전략 큐레이션군)`
- **Term ID**: `cozy-edit`

| Section on Term Page | Action | Value to Enter |
| :--- | :--- | :--- |
| **① Description** | Click `✏️ Edit` | `사내 MD·마케터·CS가 홈웨어, 잠옷, 이너웨어 및 스웻셔츠 등 실내외 이지웨어 주력 상품군을 하나로 묶어 부르는 사내 큐레이션 브랜드 용어입니다.` |
| **② Overview** | Click `+ Add` | **• 큐레이션 배경**: 시즌 캠페인 및 홈·원마일웨어 기획전 분석 시 개별 카테고리를 묶어 단일 전략 상품군으로 집계하기 위한 사내 표준 분류<br>**• 포함 물리 카테고리(3종)**: `Sleep & Lounge`, `Intimates`, `Fashion Hoodies & Sweatshirts`<br>**• 주의사항**: `Active`(애슬레저/스포츠웨어)나 `Socks & Hosiery`는 코지 에디트 집계에서 제외함 |
| **③ Aspects** | Click `+ Add` > Select **`Semantic Metric & SQL Calculation Rule`** (`semantic-sql-rule`) | • **rule_type**: `DIMENSION_FILTER (카테고리 큐레이션 필터)`<br>• **sql_expression**: `products.category IN ('Sleep & Lounge', 'Intimates', 'Fashion Hoodies & Sweatshirts')`<br>• **target_tables**: `thelook_ecommerce.products`<br>• **join_or_filter_condition**: `order_items.product_id = products.id`<br>• **unit_or_return_type**: `STRING (Product Category Filter)` |
| **④ Data quality rules** | Click `+ Add` *(Optional)* | • **Display name**: `category_not_null` (`Null check` / Dimension: `COMPLETENESS` on `products.category`) |
| **⑤ Related entries** | Click `+ Add` | In the **Filter** bar, select **`Column Name : category`** and **`Resource Name : products`** $\rightarrow$ check the column row and click **Add** *(or attach from `products` > **Schema** tab > **Add business term**)* |
| **우측 패널: Synonyms** | Click `+ Add` | `코지에디트`, `홈웨어 큐레이션`, `라운지웨어 기획전` |

---

#### 📌 Term 3: `OTIF-72` (72시간 정시 배송 SLA)
- **Display name**: `OTIF-72 (72시간 정시 배송 SLA 기준)`
- **Term ID**: `otif-72`

| Section on Term Page | Action | Value to Enter |
| :--- | :--- | :--- |
| **① Description** | Click `✏️ Edit` | `고객의 주문 접수 시점부터 최종 배송 완료 시점까지 72시간 이내에 정시 도착해야 함을 규정하는 CS 및 물류 부문의 핵심 배송 서비스 수준 협약(SLA) 기준입니다.` |
| **② Overview** | Click `+ Add` | **• SLA 측정 기준**: `orders.created_at`(주문 생성 시각)부터 `orders.delivered_at`(배송 완료 시각)까지의 경과 시간(시간 단위)을 측정<br>**• 위반(Breach) 판정**: 배송 완료(`status = 'Complete'`) 건 중 경과 시간이 **72시간을 초과(`> 72`)**한 주문을 SLA 위반으로 분류<br>**• 보상 연계**: 최우수 고객(`HV-VIP`)의 주문이 `OTIF-72`를 위반한 경우 CS 전결 보상 코드(`VIP-OVERRIDE-99`) 발급 대상이 됨 |
| **③ Aspects** | Click `+ Add` > Select **`Semantic Metric & SQL Calculation Rule`** (`semantic-sql-rule`) | • **rule_type**: `SLA_CONDITION (배송 지연 SLA 판정식)`<br>• **sql_expression**: `TIMESTAMP_DIFF(orders.delivered_at, orders.created_at, HOUR) > 72`<br>• **target_tables**: `thelook_ecommerce.orders`<br>• **join_or_filter_condition**: `orders.status = 'Complete' AND orders.delivered_at IS NOT NULL`<br>• **unit_or_return_type**: `INT64 (Elapsed Hours > 72h = SLA Breach)` |
| **④ Data quality rules** | Click `+ Add` *(Optional)* | • **Display name**: `delivered_after_created` (`Custom SQL check`: `delivered_at >= created_at` / Dimension: `CONSISTENCY`) |
| **⑤ Related entries** | Click `+ Add` | In the **Filter** bar, select **`Column Name : created_at`** (and **`delivered_at`**) with **`Resource Name : orders`** $\rightarrow$ check the column rows and click **Add** *(or attach from `orders` > **Schema** tab > **Add business term**)* |
| **우측 패널: Synonyms** | Click `+ Add` | `72시간 배송 SLA`, `정시 배송 기준`, `배송 지연 SLA` |

![Knowledge Catalog Column Definition Link screen](images/step2b_kc_column_link.png)

---

## Task 3. Connect the BigQuery Federated Query connector and enable Knowledge Catalog in Gemini Enterprise

In this task, you connect **BigQuery** to **Gemini Enterprise** using the first-party **BigQuery Federated Query** connector (`bigquery_mcp`), enable its analytical actions, create your assistant app, and turn on the **Enable Knowledge Catalog** toggle.

> [!TIP]
> **Why no OAuth 2.0 Client ID setup is needed:**
> Gemini Enterprise's first-party **BigQuery (`Federated query`)** connector and built-in **Knowledge Catalog** integration use **Google 1P Offline OAuth (`AGENT_AUTH_PROVIDER_TYPE_GOOGLE_FIRST_PARTY`)** and automatic End-User Credential (EUC) forwarding under the hood. You do **not** need to create an OAuth 2.0 Client ID/Secret in `APIs & Services > Credentials` or override any Argolis organization policy (`disableCustomMcpServerConnector`).

### Step 3-1. Create the BigQuery Federated Query data store and enable actions

1. In the Google Cloud console, go to **Gemini Enterprise** > **Data stores**, and click **+ Create data store**.
2. Under **First-party data sources (Google Cloud)**, select **BigQuery**.
3. Select **Federated query (recommended)** as the connection mode.
4. Configure the connector settings:
   - **Data connector name**: `thelook-bigquery-federated`
   - **Billing Project ID**: Enter your current Google Cloud Project ID *(e.g., `kc-handson-lab-01`)* so BigQuery query jobs are billed to your project.
5. Click **Create**.
6. Once the data store is created, click its name (`thelook-bigquery-federated`), open the **Actions** tab, and verify or enable the analytical actions:
   - **`Execute SQL (Read-Only)`** (`execute_sql_readonly`)
   - **`Get Table Info`** (`get_table_info`)
   - **`Get Dataset Info`** (`get_dataset_info`)
   - **`List Dataset IDs`** (`list_dataset_ids`)
   - **`List Table IDs`** (`list_table_ids`)
   - **`Get Query Results`** (`get_query_results`) and **`Get Job`** (`get_job`)

### Step 3-2. Create the Gemini Enterprise app and turn on Enable Knowledge Catalog

1. In the **Gemini Enterprise** navigation menu, click **Apps**, and then click **+ Create app**.
2. For **App name**, enter **`thelook-kc-assistant`**, select the **`global (Global)`** multi-region, attach your **`thelook-bigquery-federated`** data store, and click **Create**.
3. Inside the **`thelook-kc-assistant`** app, click **Configurations** in the left navigation pane, and select the **Assistant** tab.
4. Scroll to the **Enable Knowledge Catalog** section, turn the toggle **On**, and click **Save** (or **Save and publish**).
   *(Turning on this toggle equips the assistant with built-in 1P Knowledge Catalog tools—`knowledge_catalog_search`, `knowledge_catalog_lookup_context`, and `knowledge_catalog_lookup_entry`—that automatically retrieve your Business Glossary terms, column links, and custom Aspects at query time.)*

![Gemini Enterprise App Assistant Knowledge Catalog toggle screen](images/step4b_ge_app_assistant_kc.png)

---

## Task 4. Test Before vs. After in the Gemini Enterprise web app

In this final task, you launch the **Gemini Enterprise** web app and compare the response quality with and without **Knowledge Catalog** grounding.

### Compare Before (Without Knowledge Catalog) vs. After (With Knowledge Catalog)

1. In the **Gemini Enterprise** console, go to **Apps** > **thelook-kc-assistant** > **Integration** (or **Overview**), and click the published **Web App URL** link to open the chat interface.
2. Enter the following natural-language business question in the prompt bar:

   **우리 회사의 '코지 에디트(COZY-EDIT)' 상품군의 실현 순매출(NRR)과 확정 주문 건수는 얼마야? 카테고리별 내역도 함께 보여줘**

3. When prompted by the BigQuery connector authorization banner on your first query, click **Authorize** and approve the built-in Google 1P consent prompt using your logged-in account.
4. Observe the **Aha! Moment** in the agent's reasoning trace and final answer:
   - **Without Knowledge Catalog (Before):** The agent inspects raw BigQuery table schemas (`products`, `order_items`), fails to find any column or category value literally named `'COZY-EDIT'` or `'NRR'`, and either returns `0 rows` or erroneously sums `sale_price` across cancelled and returned orders.
   - **With Knowledge Catalog + BigQuery Federated MCP (After):**
     1. The agent calls Knowledge Catalog (`knowledge_catalog_search`, `knowledge_catalog_lookup_context`, `knowledge_catalog_lookup_entry`) to retrieve the exact business definitions, custom `semantic-sql-rule` Aspects, and linked columns for **`COZY-EDIT`** (`products.category IN ('Sleep & Lounge', 'Intimates', 'Fashion Hoodies & Sweatshirts')`) and **`NRR`** (`SUM(sale_price)` where `order_items.status NOT IN ('Cancelled', 'Returned')`).
     2. The agent passes this grounded context to the BigQuery connector (`execute_sql_readonly`) and runs a verified read-only SQL query to return the exact category breakdown and total NRR (**`$1,177,507.40 [약 16억 2,496만 원]`** across **26,381** realized orders).

![Gemini Enterprise Web App Before vs After Aha Moment comparison](images/step5_ge_chat_aha_moment.png)

### Try an additional SLA breach prompt (`OTIF-72`)

To verify that your third glossary term (**`OTIF-72`**) also grounds SQL generation automatically, enter the following follow-up prompt:

**우리 물류 기준인 OTIF-72를 위반한 지연 주문은 총 몇 건이고, 지연된 주문의 실현 순매출(NRR) 합계는 얼마야?**

The agent automatically looks up **`OTIF-72`** (`TIMESTAMP_DIFF(orders.delivered_at, orders.created_at, HOUR) > 72` and `orders.status = 'Complete'`) in **Knowledge Catalog** and joins `orders` with `order_items` in **BigQuery** to calculate the exact SLA breach metrics without any manual SQL hinting.
