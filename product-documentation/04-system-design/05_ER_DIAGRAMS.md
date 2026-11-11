# 05 — ER DIAGRAMS
## Entity-relationship diagrams by domain, generated from the table definitions

| Field | Value |
|---|---|
| Document ID | SDD-05 |
| Version | 0.1 (draft for founder review) |
| Last updated | 2026-11-12 |
| Owner | Product (CPO role) |
| Depends on | SDD-04 |
| Status | Draft. Not approved |

Diagrams are generated from the same source as `04_DATABASE_DESIGN.md`, so they cannot disagree with it. Each entity box shows up to nine columns; the full list is in the database design. `tenant_id` foreign keys are omitted from the diagrams because every tenant-scoped table has one.

### 1. Tenancy, identity and access

```mermaid
erDiagram
  USER_ACCOUNT ||--o{ TENANT_SETTING_VERSION : "created_by"
  APPROVAL ||--o{ TENANT_SETTING_VERSION : "approval"
  USER_ACCOUNT ||--o{ ROLE_ASSIGNMENT : "user"
  ROLE ||--o{ ROLE_ASSIGNMENT : "role"
  APPROVAL ||--o{ ROLE_ASSIGNMENT : "approval"
  USER_ACCOUNT ||--o{ APPROVAL : "preparer"
  USER_ACCOUNT ||--o{ APPROVAL : "approver"
  USER_ACCOUNT ||--o{ SUPPORT_SESSION : "requester"
  USER_ACCOUNT ||--o{ SUPPORT_SESSION : "decided_by"
  TENANT {
    uuid id PK
    text legal_name
    text slug
    text region
    text isolation_tier
    text db_route
    text state
    uuid dpa_document_id
    timestamptz created_at
  }
  MARKET {
    uuid id PK
    uuid tenant_id FK
    text code
    char currency
    smallint minor_unit
    text time_zone
    text languages
    text market_pack
    text state
  }
  BRAND {
    uuid id PK
    uuid tenant_id FK
    text name
  }
  TENANT_SETTING_VERSION {
    uuid id PK
    uuid tenant_id FK
    int version
    timestamptz effective_from
    jsonb settings
    text reason
    uuid created_by FK
    uuid approval_id FK
  }
  USER_ACCOUNT {
    uuid id PK
    uuid tenant_id FK
    text realm
    text idp_subject
    text email
    text display_name
    boolean mfa_enrolled
    text state
    uuid participant_id FK
  }
  ROLE {
    uuid id PK
    uuid tenant_id FK
    text name
    text permissions
    boolean is_base
    boolean mfa_required
  }
  ROLE_ASSIGNMENT {
    uuid id PK
    uuid tenant_id FK
    uuid user_id FK
    uuid role_id FK
    uuid market_ids
    uuid brand_ids
    timestamptz valid_from
    timestamptz valid_to
    uuid approval_id FK
  }
  APPROVAL {
    uuid id PK
    uuid tenant_id FK
    text object_type
    uuid object_id
    uuid preparer_id FK
    uuid approver_id FK
    text decision
    text reason
    timestamptz factor_verified_at
  }
  SUPPORT_SESSION {
    uuid id PK
    uuid tenant_id FK
    uuid requester_id FK
    text reason
    jsonb scope
    int requested_minutes
    text state
    uuid decided_by FK
    timestamptz starts_at
  }
  API_KEY {
    uuid id PK
    uuid tenant_id FK
    text name
    text key_hash
    text scopes
    text rate_tier
    cidr ip_allow
    timestamptz expires_at
    timestamptz revoked_at
  }
```

### 2. Overlay import and compliance (MVP-A)

```mermaid
erDiagram
  IMPORT_MAPPING ||--o{ IMPORT_BATCH : "mapping"
  IMPORT_BATCH ||--o{ IMPORT_ROW_ERROR : "batch"
  IMPORT_BATCH ||--o{ CPL_FACT_PARTICIPANT : "batch"
  IMPORT_BATCH ||--o{ CPL_FACT_ORDER : "batch"
  IMPORT_BATCH ||--o{ CPL_FACT_PAYOUT_LINE : "batch"
  IMPORT_MAPPING ||--o{ COMPLIANCE_REPORT_SNAPSHOT : "mapping"
  COMPLIANCE_REPORT_SNAPSHOT ||--o{ COMPLIANCE_FIGURE : "snapshot"
  GUARDRAIL_RULE ||--o{ GUARDRAIL_DECISION : "rule"
  IMPORT_BATCH {
    uuid id PK
    uuid tenant_id FK
    uuid market_id FK
    text kind
    date period_from
    date period_to
    text state
    uuid mapping_id FK
    jsonb row_counts
  }
  IMPORT_MAPPING {
    uuid id PK
    uuid tenant_id FK
    int version
    jsonb mappings
    text notes
    text state
    uuid approved_by FK
  }
  IMPORT_ROW_ERROR {
    uuid id PK
    uuid tenant_id FK
    uuid batch_id FK
    text file
    int row_no
    text column_name
    text code
    text detail
  }
  CPL_FACT_PARTICIPANT {
    uuid id PK
    uuid tenant_id FK
    text source
    uuid batch_id FK
    text participant_ref
    text type_code
    boolean counts_as_end_customer
    boolean can_earn
    date enrolled_month
  }
  CPL_FACT_ORDER {
    uuid id PK
    uuid tenant_id FK
    text source
    uuid batch_id FK
    text order_ref
    date order_date
    text buyer_ref
    bigint amount_minor
    bigint volume_minor
  }
  CPL_FACT_PAYOUT_LINE {
    uuid id PK
    uuid tenant_id FK
    text source
    uuid batch_id FK
    text line_ref
    date pay_month
    text payee_ref
    text bonus_type
    text source_kind
  }
  COMPLIANCE_REPORT_SNAPSHOT {
    uuid id PK
    uuid tenant_id FK
    uuid market_id FK
    date period_from
    date period_to
    text method_version
    uuid mapping_id FK
    uuid settings_version_id FK
    jsonb input_refs
  }
  COMPLIANCE_FIGURE {
    uuid id PK
    uuid tenant_id FK
    uuid snapshot_id FK
    text report
    date period
    text key
    numeric value_num
    bigint numerator
    bigint denominator
  }
  GUARDRAIL_RULE {
    text id PK
    text market_pack
    text outcome
    jsonb predicate
    boolean overridable
    text basis
    text basis_status
    date reviewed_at
    date effective_from
  }
  GUARDRAIL_DECISION {
    uuid id PK
    uuid tenant_id FK
    text rule_id FK
    text object_type
    uuid object_id
    text outcome
    jsonb detail
    uuid acknowledged_by FK
    text override_justification
  }
```

### 3. Participants, positions and genealogy

```mermaid
erDiagram
  PARTICIPANT ||--o{ PARTICIPANT_TYPE_ASSIGNMENT : "participant"
  PARTICIPANT_TYPE ||--o{ PARTICIPANT_TYPE_ASSIGNMENT : "type"
  POSITION ||--o{ POSITION_OWNERSHIP : "position"
  PARTICIPANT ||--o{ POSITION_OWNERSHIP : "participant"
  POSITION ||--o{ RELATIONSHIP : "parent_position"
  POSITION ||--o{ RELATIONSHIP : "child_position"
  POSITION ||--o{ PATH_NODE : "position"
  PARTICIPANT ||--o{ CUSTOMER_SERVICING : "customer"
  POSITION ||--o{ CUSTOMER_SERVICING : "servicing_position"
  PARTICIPANT ||--o{ AGREEMENT_ACCEPTANCE : "participant"
  PARTICIPANT {
    uuid id PK
    uuid tenant_id FK
    text external_ref
    text account_type
    uuid market_id FK
    text display_name
    jsonb contact
    uuid identity_doc_id FK
    text status
  }
  PARTICIPANT_TYPE {
    uuid id PK
    uuid tenant_id FK
    text code
    boolean can_earn
    boolean counts_as_end_customer
    boolean can_sponsor
    boolean can_hold_positions
  }
  PARTICIPANT_TYPE_ASSIGNMENT {
    uuid id PK
    uuid tenant_id FK
    uuid participant_id FK
    uuid type_id FK
    timestamptz valid_from
    timestamptz valid_to
  }
  POSITION {
    uuid id PK
    uuid tenant_id FK
    text position_ref
    uuid market_id FK
    uuid brand_id FK
    uuid plan_id FK
    text status
    timestamptz status_from
    timestamptz created_at
  }
  POSITION_OWNERSHIP {
    uuid id PK
    uuid tenant_id FK
    uuid position_id FK
    uuid participant_id FK
    timestamptz valid_from
    timestamptz valid_to
    uuid case_id FK
  }
  RELATIONSHIP {
    uuid id PK
    uuid tenant_id FK
    text kind
    uuid parent_position_id FK
    uuid child_position_id FK
    text leg
    timestamptz valid_from
    timestamptz valid_to
    timestamptz recorded_at
  }
  PATH_NODE {
    uuid tenant_id FK
    text kind
    uuid position_id FK
    ltree path
    int depth
    bigint model_version
    int subtree_count
  }
  CUSTOMER_SERVICING {
    uuid id PK
    uuid tenant_id FK
    uuid customer_id FK
    uuid servicing_position_id FK
    text source
    timestamptz valid_from
    timestamptz valid_to
    uuid case_id FK
  }
  AGREEMENT_ACCEPTANCE {
    uuid id PK
    uuid tenant_id FK
    uuid participant_id FK
    uuid document_id FK
    timestamptz accepted_at
    jsonb evidence
  }
```

### 4. Orders, returns and attribution

```mermaid
erDiagram
  PARTICIPANT ||--o{ ORDER : "buyer"
  POSITION ||--o{ ORDER : "attributed_position"
  PERIOD ||--o{ ORDER : "period"
  ORDER ||--o{ ORDER_LINE : "order"
  ORDER ||--o{ ORDER_EVENT : "order"
  PERIOD ||--o{ ORDER_EVENT : "period"
  PERIOD ||--o{ LATE_TRANSACTION : "original_period"
  ORDER {
    uuid id PK
    uuid tenant_id FK
    text source_system
    text source_order_id
    uuid market_id FK
    uuid brand_id FK
    uuid buyer_id FK
    uuid buyer_type_id FK
    text purpose
  }
  ORDER_LINE {
    uuid id PK
    uuid tenant_id FK
    uuid order_id FK
    int line_no
    text sku
    text item_class
    int quantity
    bigint amount_minor
    jsonb volumes
  }
  ORDER_EVENT {
    uuid id PK
    uuid tenant_id FK
    uuid order_id FK
    text source_event_id
    text type
    timestamptz occurred_at
    jsonb lines
    bigint refund_minor
    bigint fee_minor
  }
  LATE_TRANSACTION {
    uuid id PK
    uuid tenant_id FK
    text origin_type
    uuid origin_id
    uuid original_period_id FK
    jsonb effect_estimate
    text handling
    text state
    uuid consumed_by_run_id FK
  }
  PRODUCT_VOLUME_MAP {
    uuid id PK
    uuid tenant_id FK
    uuid market_id FK
    text sku
    text item_class
    jsonb volumes
    timestamptz valid_from
    timestamptz valid_to
  }
  PERIOD {
    uuid id PK
    uuid tenant_id FK
    uuid calendar_id FK
    timestamptz starts_at
    timestamptz ends_at
    text state
    uuid committed_run_id FK
  }
  PARTICIPANT {
    uuid id PK
    uuid tenant_id FK
    text external_ref
    text account_type
    uuid market_id FK
    text display_name
    jsonb contact
    uuid identity_doc_id FK
    text status
  }
  POSITION {
    uuid id PK
    uuid tenant_id FK
    text position_ref
    uuid market_id FK
    uuid brand_id FK
    uuid plan_id FK
    text status
    timestamptz status_from
    timestamptz created_at
  }
```

### 5. Plans, periods and calculation

```mermaid
erDiagram
  PLAN ||--o{ PLAN_VERSION : "plan"
  PLAN_VERSION ||--o{ PLAN_RULE : "plan_version"
  PLAN_VERSION ||--o{ PLAN_TRANSITION : "to_version"
  PLAN_VERSION ||--o{ GOLDEN_DATASET : "plan_version"
  PLAN_VERSION ||--o{ SIMULATION : "plan_version"
  PERIOD ||--o{ SIMULATION : "period"
  RUN ||--o{ SIMULATION : "baseline_run"
  CALENDAR ||--o{ PERIOD : "calendar"
  RUN ||--o{ PERIOD : "committed_run"
  PERIOD ||--o{ RUN : "period"
  PLAN_VERSION ||--o{ RUN : "plan_version"
  RUN_SNAPSHOT ||--o{ RUN : "snapshot"
  PERIOD ||--o{ RUN_SNAPSHOT : "period"
  RUN ||--o{ RUN_SNAPSHOT : "prior_state_run"
  RUN ||--o{ RESULT_LINE : "run"
  RUN ||--o{ QUALIFICATION_STATE : "run"
  PERIOD ||--o{ RESTATEMENT : "period"
  SIMULATION ||--o{ RESTATEMENT : "simulation"
  RUN ||--o{ RESTATEMENT : "applied_in_run"
  PLAN {
    uuid id PK
    uuid tenant_id FK
    text name
    uuid brand_id FK
    uuid market_ids
  }
  PLAN_VERSION {
    uuid id PK
    uuid tenant_id FK
    uuid plan_id FK
    int version
    text state
    timestamptz effective_from
    text justification
    text engine_version
    jsonb filing_status
  }
  PLAN_RULE {
    uuid id PK
    uuid tenant_id FK
    uuid plan_version_id FK
    text rule_key
    text kind
    text pass
    jsonb params
    text depends_on
    text reversal_policy
  }
  PLAN_TRANSITION {
    uuid id PK
    uuid tenant_id FK
    uuid to_version_id FK
    text state_item
    text rule
    jsonb params
  }
  GOLDEN_DATASET {
    uuid id PK
    uuid tenant_id FK
    uuid plan_version_id FK
    text name
    uuid input_doc_id FK
    uuid expected_doc_id FK
    text last_result
  }
  SIMULATION {
    uuid id PK
    uuid tenant_id FK
    uuid plan_version_id FK
    uuid period_id FK
    uuid baseline_run_id FK
    text kind
    text state
    jsonb totals
    uuid requested_by FK
  }
  CALENDAR {
    uuid id PK
    uuid tenant_id FK
    uuid market_id FK
    text name
    text cadence
    text cutoff_time_zone
  }
  PERIOD {
    uuid id PK
    uuid tenant_id FK
    uuid calendar_id FK
    timestamptz starts_at
    timestamptz ends_at
    text state
    uuid committed_run_id FK
  }
  RUN {
    uuid id PK
    uuid tenant_id FK
    uuid period_id FK
    text run_request_id
    uuid plan_version_id FK
    uuid settings_version_id FK
    uuid snapshot_id FK
    text engine_version
    text state
  }
  RUN_SNAPSHOT {
    uuid id PK
    uuid tenant_id FK
    uuid period_id FK
    timestamptz known_at
    bigint order_watermark
    uuid prior_state_run_id FK
    uuid manifest_doc_id FK
    bytea inputs_hash
  }
  RESULT_LINE {
    uuid id PK
    uuid tenant_id FK
    uuid run_id FK
    uuid payee_position_id FK
    uuid payee_participant_id FK
    text rule_key
    text bonus_type
    text source_kind
    text pass
  }
  QUALIFICATION_STATE {
    uuid tenant_id FK
    uuid run_id FK
    uuid position_id FK
    jsonb paid_as_rank
    jsonb highest_titles
    jsonb counters
    jsonb carry
    text one_time_flags
    jsonb banked
  }
  RESTATEMENT {
    uuid id PK
    uuid tenant_id FK
    uuid period_id FK
    uuid case_id FK
    uuid simulation_id FK
    uuid diff_doc_id FK
    text state
    uuid applied_in_run_id FK
  }
```

### 6. Ledger, payouts and tax

```mermaid
erDiagram
  PARTICIPANT ||--o{ LEDGER_ACCOUNT : "payee_participant"
  JOURNAL_ENTRY ||--o{ POSTING : "entry"
  LEDGER_ACCOUNT ||--o{ POSTING : "account"
  PROVIDER_CONFIG ||--o{ PAYOUT_BATCH : "provider_config"
  PAYOUT_BATCH ||--o{ PAYOUT_INSTRUCTION : "batch"
  PARTICIPANT ||--o{ PAYOUT_INSTRUCTION : "payee_participant"
  BANK_DETAIL_VERSION ||--o{ PAYOUT_INSTRUCTION : "bank_detail_version"
  PARTICIPANT ||--o{ BANK_DETAIL_VERSION : "participant"
  PARTICIPANT ||--o{ TAX_PROFILE : "participant"
  RUN ||--o{ TAX_LINE : "run"
  PARTICIPANT ||--o{ TAX_LINE : "payee_participant"
  TAX_RULE ||--o{ TAX_LINE : "rule"
  PARTICIPANT ||--o{ TAX_FORM : "participant"
  LEDGER_ACCOUNT {
    uuid id PK
    uuid tenant_id FK
    uuid market_id FK
    text type
    uuid payee_participant_id FK
    uuid credit_type_id
    char currency
    text gl_code
  }
  JOURNAL_ENTRY {
    uuid id PK
    uuid tenant_id FK
    text event_type
    text origin_type
    uuid origin_id
    text idempotency_key
    uuid approval_id FK
    timestamptz posted_at
  }
  POSTING {
    uuid id PK
    uuid tenant_id FK
    uuid entry_id FK
    uuid account_id FK
    bigint debit_minor
    bigint credit_minor
    char currency
  }
  PAYOUT_BATCH {
    uuid id PK
    uuid tenant_id FK
    uuid market_id FK
    uuid provider_config_id FK
    text state
    bigint total_minor
    char currency
    jsonb exclusions
    uuid prepared_by FK
  }
  PAYOUT_INSTRUCTION {
    uuid id PK
    uuid tenant_id FK
    uuid batch_id FK
    uuid payee_participant_id FK
    uuid bank_detail_version_id FK
    bigint amount_minor
    text idempotency_key
    bytea signature
    text state
  }
  PROVIDER_CONFIG {
    uuid id PK
    uuid tenant_id FK
    uuid market_id FK
    text kind
    text provider
    text credentials_secret_ref
    text approved_description
    uuid approval_document_id FK
    date approved_at
  }
  BANK_DETAIL_VERSION {
    uuid id PK
    uuid tenant_id FK
    uuid participant_id FK
    bytea details_ciphertext
    bytea fingerprint
    text masked
    text created_via
    timestamptz cooling_off_until
    timestamptz verified_at
  }
  TAX_PROFILE {
    uuid id PK
    uuid tenant_id FK
    uuid participant_id FK
    text residency
    text entity_type
    uuid tax_id_document_id FK
    text tax_id_masked
    jsonb prior_year_totals
    timestamptz valid_from
  }
  TAX_RULE {
    text id PK
    text market_pack
    text kind
    jsonb conditions
    numeric rate
    bigint threshold_minor
    text threshold_basis
    numeric missing_id_rate
    text rounding
  }
  TAX_LINE {
    uuid id PK
    uuid tenant_id FK
    uuid run_id FK
    uuid payee_participant_id FK
    text rule_id FK
    bigint taxable_minor
    bigint withheld_minor
  }
  TAX_FORM {
    uuid id PK
    uuid tenant_id FK
    uuid market_id FK
    int tax_year
    text form_type
    uuid participant_id FK
    jsonb totals
    uuid document_id FK
    int version
  }
  RUN {
    uuid id PK
    uuid tenant_id FK
    uuid period_id FK
    text run_request_id
    uuid plan_version_id FK
    uuid settings_version_id FK
    uuid snapshot_id FK
    text engine_version
    text state
  }
  PARTICIPANT {
    uuid id PK
    uuid tenant_id FK
    text external_ref
    text account_type
    uuid market_id FK
    text display_name
    jsonb contact
    uuid identity_doc_id FK
    text status
  }
```

### 7. Cases, privacy, notifications and integration

```mermaid
erDiagram
  APPROVAL ||--o{ CASE : "approval"
  CASE ||--o{ CASE_EVENT : "case"
  CASE ||--o{ PRIVACY_REQUEST : "case"
  DOCUMENT ||--o{ STATEMENT : "document"
  WEBHOOK_ENDPOINT ||--o{ WEBHOOK_DELIVERY : "endpoint"
  OUTBOX_EVENT ||--o{ WEBHOOK_DELIVERY : "outbox_event"
  DOCUMENT ||--o{ EXPORT_JOB : "document"
  CASE {
    uuid id PK
    uuid tenant_id FK
    text type
    text subject_type
    uuid subject_id
    text reason_code
    text state
    jsonb payload
    jsonb effect_preview
  }
  CASE_EVENT {
    uuid id PK
    uuid tenant_id FK
    uuid case_id FK
    timestamptz occurred_at
    uuid actor_id FK
    text kind
    jsonb data
  }
  APPROVAL {
    uuid id PK
    uuid tenant_id FK
    text object_type
    uuid object_id
    uuid preparer_id FK
    uuid approver_id FK
    text decision
    text reason
    timestamptz factor_verified_at
  }
  PRIVACY_REQUEST {
    uuid id PK
    uuid tenant_id FK
    uuid case_id FK
    text type
    uuid subject_participant_id FK
    timestamptz verified_at
    timestamptz due_at
    text outcome
    text retention_basis
  }
  STATEMENT {
    uuid id PK
    uuid tenant_id FK
    uuid run_id FK
    uuid participant_id FK
    bigint gross_minor
    bigint withheld_minor
    bigint clawback_minor
    bigint adjustment_minor
    bigint net_minor
  }
  NOTIFICATION {
    uuid id PK
    uuid tenant_id FK
    uuid recipient_participant_id FK
    uuid recipient_user_id FK
    text template
    text locale
    text channel
    boolean mandatory
    text state
  }
  DOCUMENT {
    uuid id PK
    uuid tenant_id FK
    text class
    text storage_key
    bytea sha256
    text mime
    bigint size_bytes
    uuid uploaded_by FK
    int version
  }
  OUTBOX_EVENT {
    uuid id PK
    uuid tenant_id FK
    bigserial seq
    text topic
    text key
    jsonb payload
    timestamptz available_at
    int attempts
    timestamptz dispatched_at
  }
  WEBHOOK_ENDPOINT {
    uuid id PK
    uuid tenant_id FK
    text url
    text secret_ref
    text topics
    text state
  }
  WEBHOOK_DELIVERY {
    uuid id PK
    uuid tenant_id FK
    uuid endpoint_id FK
    uuid outbox_event_id FK
    int status
    int attempt
    timestamptz next_attempt_at
  }
  EXPORT_JOB {
    uuid id PK
    uuid tenant_id FK
    text kind
    jsonb filters
    bigint row_count
    uuid document_id FK
    text destination
    uuid requested_by FK
    text state
  }
```
