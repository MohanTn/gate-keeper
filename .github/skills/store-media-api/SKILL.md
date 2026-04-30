---
name: store-media-api
description: Comprehensive domain knowledge for Store Media API system including database schema, campaign lifecycle, data integrity rules, and investigation frameworks for retail media campaign database analysis and troubleshooting.
---

# Store Media API Domain Knowledge

## Overview

This skill provides deep domain expertise for the Store Media API system—a multi-tenant platform managing retail media campaign activation, store targeting, media placement reservations, and product measurement tracking. Use this skill when working with campaign data, investigating database issues, or implementing features related to campaign lifecycle management.

---

## Database Context

### Database Configuration
- **Database**: `store-media-api-db-local`
- **Architecture**: Two-level multi-tenant schema architecture
  - **Level 1 - Application Schema**: `store-media-api` (routing/orchestration layer)
  - **Level 2 - Tenant Schemas**: `apollo`, `tesco_uk`, `foodstuffs` (data storage)
- **System Scope**: Campaign activation + store targeting + media placement reservation + product measurement

### Two-Level Schema Architecture

#### Level 1: Application Schema (`store-media-api`)
- **Purpose**: Application-level routing and orchestration layer
- **Function**: Routes requests based on `ad_account_id` to appropriate tenant schema
- **Tables**: Routing configuration, ad account to schema mappings
- **Usage Pattern**: API calls use `ad_account_id` parameter to determine target tenant

**Routing Logic**:
```typescript
// Application determines tenant schema based on ad_account_id
const schema = getSchemaForAdAccount(adAccountId);
// Possible values: 'apollo', 'tesco_uk', 'foodstuffs'
```

#### Level 2: Tenant Data Schemas
Each tenant has an isolated schema with identical table structure:

| Schema | Description | Retailer ID (UUID) | Market |
|--------|-------------|-------------------|--------|
| `apollo` | Default tenant (primary) | `30f45a54-df1a-4dbf-a9f6-b06a50673bdc` | - |
| `dunnhumby` | Dunnhumby tenant | `6afe8a99-fcbf-66f2-4f8f-707564a84962` | UK |
| `foodstuffs` | Foodstuffs retail tenant | `03c29acd-7b49-4bfa-ae66-b646e9912b90` | NZ |
| `tesco_uk` | Tesco UK retail tenant | `0e293d7c-60ca-4045-b054-e99ef1f32327` | UK |

**Key Characteristics**:
- Each schema contains identical table structures
- Complete data isolation between tenants
- No cross-schema foreign key relationships
- Independent scaling and performance tuning per tenant

### Connection
Use the `postgres-mcp-server` tool with schema parameter to query the appropriate tenant schema.

**Query Pattern**:
```sql
-- Always specify which tenant schema to query
SET search_path TO apollo; -- or tesco_uk, or foodstuffs
SELECT * FROM activation WHERE deleted_at IS NULL;
```

---

## Application-Level Routing

### Retailer to Schema Mapping

The Store Media API uses the `store-media-api.retailer` table to map retailer IDs to tenant schemas. Each activation record contains an `ad_account_id` that determines which schema to use.

**Request Flow**:
```
1. API Request → Contains ad_account_id parameter
   Example: GET /api/activation/123?ad_account_id=30f45a54-df1a-4dbf-a9f6-b06a50673bdc

2. Application Layer (store-media-api schema) → Looks up tenant mapping
   Query: SELECT schema_name FROM "store-media-api".retailer 
          WHERE id = '30f45a54-df1a-4dbf-a9f6-b06a50673bdc'
   Result: 'apollo'

3. Database Query → Executed against determined schema
   SET search_path TO apollo;
   SELECT * FROM activation WHERE activation_id = '123' AND is_deleted = false;
```

### Tenant Determination Logic

**Frontend Pattern (React)**:
```typescript
// User context provides ad_account_id
const { adAccountId } = useUserContext();

// All API calls include adAccountId for proper routing
useQuery(
  ['activation', activationId, adAccountId],
  () => getActivation(activationId),
  options
);

// API layer uses adAccountId to determine schema
// This happens server-side, invisible to React app
```

**Backend Pattern (API)**:
```typescript
// Middleware extracts ad_account_id from request
const adAccountId = req.query.ad_account_id || req.headers['x-ad-account-id'];

// Lookup tenant schema
const schema = await getTenantSchema(adAccountId);
// Returns: 'apollo' | 'tesco_uk' | 'foodstuffs'

// Execute query with schema context
await db.query(`SET search_path TO ${schema}`);
const result = await db.query('SELECT * FROM activation WHERE id = $1', [id]);
```

### Important Notes for Investigations

1. **Direct Database Access**: When using `postgres-mcp-server`, you bypass the application routing layer
2. **Manual Schema Selection**: You must explicitly specify which tenant schema to query
3. **No Automatic Routing**: Unlike API calls, database investigations require manual tenant selection
4. **Cross-Tenant Analysis**: Query each schema separately and aggregate results manually

**Investigation Query Pattern**:
```sql
-- Query apollo schema
SET search_path TO apollo;
SELECT 'apollo' as tenant, COUNT(*) as activation_count 
FROM activation WHERE deleted_at IS NULL;

-- Query tesco_uk schema
SET search_path TO tesco_uk;
SELECT 'tesco_uk' as tenant, COUNT(*) as activation_count 
FROM activation WHERE deleted_at IS NULL;

-- Query foodstuffs schema
SET search_path TO foodstuffs;
SELECT 'foodstuffs' as tenant, COUNT(*) as activation_count 
FROM activation WHERE deleted_at IS NULL;
```

---

## Core Database Schema

### Primary Tables

| Table | Purpose | Key Columns | Foreign Keys |
|-------|---------|-------------|--------------|
| `activation` | Campaign master records | `id`, `name`, `start_date`, `end_date`, `status`, `created_at`, `updated_at`, `deleted_at` | - |
| `store_activation` | Store assignment with cohort designation | `id`, `activation_id`, `store_id`, `evaluation_type`, `created_at` | `activation_id` → `activation(id)` |
| `activation_measured_product` | Measurement product linkage | `id`, `activation_id`, `product_id`, `is_halo` | `activation_id` → `activation(id)` |
| `product_activation` | Feature product mapping | `id`, `activation_id`, `product_id`, `created_at` | `activation_id` → `activation(id)` |
| `activation_attribute` | Campaign extended attributes (key-value) | `id`, `activation_id`, `attribute_key`, `attribute_value` | `activation_id` → `activation(id)` |
| `store_list_audit_entity` | Change log for store list modifications | `id`, `activation_id`, `action`, `user_id`, `timestamp`, `details` | `activation_id` → `activation(id)` |
| `selected_media_element` | Media placement selection | `id`, `activation_id`, `media_element_id`, `store_id` | `activation_id` → `activation(id)` |
| `selected_store_element` | Aisle/location spot reservation | `id`, `activation_id`, `store_id`, `aisle_id`, `location_id` | `activation_id` → `activation(id)` |

### Enum Values and Special Fields

#### `store_activation.evaluation_type`
- `0` = Target store (receives campaign)
- `1` = Control store (baseline for measurement)
- `NULL` = Unassigned (incomplete setup)

#### `store_list_audit_entity.action_type`
- `0` = Locked (finalized store list)
- `1` = Unlocked (re-opened for editing)
- `2` = Amended (modified after lock)

#### Date/Timestamp Consistency Rules
- `created_at` < `updated_at` < `deleted_date`
- `duration_from` < `duration_to` (for active campaigns)
- Soft deletes: `is_deleted = false` for active records (boolean flag)
- Note: `deleted_date` timestamp also exists for audit purposes

---

## Business Logic Rules

### Campaign Lifecycle States

```
1. DRAFT → Store assignment → Lock
2. LOCKED → Media selection → Publish
3. PUBLISHED → (optionally) Amendment → Re-publish
4. (any state) → Soft delete
```

### Data Integrity Constraints

#### Activation-Level Rules
1. **Every activation MUST have**:
   - At least 1 feature product (`product_activation`)
   - Valid `duration_from` and `duration_to` (`duration_from < duration_to`)
   - Non-null `status`, `created_at`, `ad_account_id`

2. **Store assignment rules**:
   - At least 1 target store (`evaluation_type = 0`)
   - Control stores are optional but recommended
   - No duplicate store assignments per activation
   - `evaluation_type` should never be NULL for locked campaigns

3. **Product rules**:
   - Feature products != Halo products (distinct sets)
   - Deactivated products should not link to live campaigns
   - At least 1 measurement product (`activation_measured_product`)

4. **Media assignment rules**:
   - All target stores should have media elements assigned
   - Media placements should not exceed available inventory

#### Temporal Integrity
- No amendments logged after campaign `end_date` (unusual)
- Audit timestamps should align with `updated_at` timestamps
- Lock events should precede unlock events chronologically

---

## Database Investigation Framework

Use this framework when investigating data anomalies, integrity issues, or generating root cause analysis (RCA).

### Investigation Workflow

#### Phase 0: Setup
- Create artifact directory: `.claude/artifacts/<investigation-slug>/`
- Create `investigate-db.md` with task list tracking each phase
- **Important**: This is analysis-only—no database modifications

#### Phase 1: Data Structure Discovery
**Objective**: Understand table health and relationships

**Activities**:
- Catalog row counts per table per schema
- Verify column types, constraints, indexes, FK relationships
- Check for:
  - Nullable columns that should be non-null
  - Unexpected enum values
  - Date/timestamp consistency violations
  - Orphaned records (missing FK targets)
  - Circular references
  - Duplicate primary keys

**Output**: Data structure findings in `investigate-db.md`

#### Phase 2: Activation Lifecycle Analysis
**Objective**: Trace campaign progression and identify stuck states

**Activities**:
- Extract campaign state timelines: creation → store assignment → lock → media selection → publication
- Find anomalies:
  - Activations with no stores assigned
  - Never-locked drafts (stale campaigns)
  - Slow progression (>N days between states)
  - High churn (repeated lock/unlock cycles)
- Validate store assignment:
  - Target/control ratios per activation
  - Missing cohorts (all target, no control)
  - NULL `evaluation_type` assignments
- Analyze audit trail:
  - Lock/unlock patterns
  - Amendment frequency and timing
  - Out-of-hours changes

**Queries**:
```sql
-- Activations without stores
SELECT a.id, a.name, a.status 
FROM activation a
LEFT JOIN store_activation sa ON a.id = sa.activation_id
WHERE sa.id IS NULL AND a.deleted_at IS NULL;

-- Audit timeline analysis
SELECT activation_id, action, COUNT(*), MIN(timestamp), MAX(timestamp)
FROM store_list_audit_entity
GROUP BY activation_id, action
ORDER BY activation_id, action;
```

**Output**: Lifecycle analysis findings in `investigate-db.md`

#### Phase 3: Product & Media Integrity
**Objective**: Ensure product and media data completeness

**Activities**:
- Verify every activation has >= 1 feature product
- Check for deactivated products linked to live campaigns
- Validate halo products distinct from feature products
- Verify media elements assigned to all target stores
- Find media over-allocation or conflicts

**Queries**:
```sql
-- Activations missing feature products
SELECT a.id, a.name 
FROM activation a
LEFT JOIN product_activation pa ON a.id = pa.activation_id
WHERE pa.id IS NULL AND a.deleted_at IS NULL;

-- Target stores without media assignments
SELECT sa.activation_id, sa.store_id
FROM store_activation sa
LEFT JOIN selected_media_element sme ON sa.activation_id = sme.activation_id AND sa.store_id = sme.store_id
WHERE sa.evaluation_type = 0 AND sme.id IS NULL;
```

**Output**: Product and media integrity findings in `investigate-db.md`

#### Phase 4: Anomaly Detection
**Objective**: Identify data quality violations

**Categories**:
1. **Temporal anomalies**:
   - `end_date < start_date`
   - Out-of-sequence timestamps
   - Post-campaign amendments

2. **Referential anomalies**:
   - Orphaned records
   - Missing external references (stores, products, media)

3. **Business logic violations**:
   - Target/control imbalance (>90% target or <5% control)
   - Budget/store misalignment
   - Invalid status transitions

4. **Duplication**:
   - Duplicate activation names (same tenant, overlapping dates)
   - Duplicate store entries per activation
   - Duplicate media assignments

**Output**: Detected anomalies in `investigate-db.md`

#### Phase 5: Data Quality Metrics
**Objective**: Quantify data health

**Metrics**:
- **Completeness**: % of activations with all required fields populated
- **Consistency**: % of records passing business logic checks
- **Accuracy**: Sample validation pass rate
- **Timeliness**: Staleness indicators (old drafts, delayed updates)

**Calculation Examples**:
```sql
-- Completeness score
SELECT 
  COUNT(*) FILTER (WHERE has_stores AND has_products AND has_media) * 100.0 / COUNT(*) as completeness_pct
FROM (
  SELECT 
    a.id,
    EXISTS(SELECT 1 FROM store_activation WHERE activation_id = a.id) as has_stores,
    EXISTS(SELECT 1 FROM product_activation WHERE activation_id = a.id) as has_products,
    EXISTS(SELECT 1 FROM selected_media_element WHERE activation_id = a.id) as has_media
  FROM activation a WHERE a.deleted_at IS NULL
) sub;
```

**Output**: Data quality scorecard in `investigate-db.md`

#### Phase 6: Root Cause Analysis
**Objective**: Diagnose issues and recommend fixes

**For each identified issue, provide**:
1. **Pattern description**: Name, affected count, severity (Critical/High/Medium/Low)
2. **Timeline**: When did this pattern emerge? Frequency?
3. **Hypotheses**: 2-3 potential root causes with probability estimates
4. **Evidence**: Supporting data, correlations, edge cases
5. **Most likely RCA**: Primary root cause with confidence level (%)
6. **Remediation**: Immediate fix steps
7. **Prevention**: Long-term measures (validation rules, constraints, monitoring)

**Output**: Complete RCA report in `investigate-db.md`

---

## Query Strategy Best Practices

1. **Understand the routing layer**: Application schema routes by `ad_account_id`, but investigations query tenant schemas directly
2. **Start with counts**: Establish baseline row counts per table per schema
3. **Use JOINs for relationships**: Find orphaned records and referential issues (within same schema)
4. **Cross-validate across schemas**: Ensure findings apply to all tenants (apollo, tesco_uk, foodstuffs)
5. **Never cross-schema JOIN**: Each tenant is isolated—no FK relationships across schemas
6. **Paginate large result sets**: Use `LIMIT` and `OFFSET` for readability
7. **Filter soft deletes**: Always include `WHERE deleted_at IS NULL` for active records
8. **Schema context**: Always use `SET search_path` or schema-qualified table names

---

## Common Investigation Patterns

### Pattern: Store Assignment Gaps
**Symptom**: Campaigns in published state with no store assignments

**Query**:
```sql
SELECT a.id, a.name, a.status 
FROM activation a
LEFT JOIN store_activation sa ON a.id = sa.activation_id
WHERE a.status = 'PUBLISHED' 
  AND sa.id IS NULL 
  AND a.deleted_at IS NULL;
```

**Root Causes**:
- Race condition in store list finalization
- Rollback without cascade delete
- Manual data manipulation

---

### Pattern: Audit Trail Inconsistencies
**Symptom**: Lock events without corresponding unlock, or vice versa

**Query**:
```sql
SELECT activation_id, 
  SUM(CASE WHEN action = 0 THEN 1 ELSE 0 END) as locks,
  SUM(CASE WHEN action = 1 THEN 1 ELSE 0 END) as unlocks
FROM store_list_audit_entity
GROUP BY activation_id
HAVING locks != unlocks;
```

**Root Causes**:
- Missing audit trigger
- Transaction rollback without audit cleanup
- Audit logging disabled during maintenance

---

### Pattern: Orphaned Media Selections
**Symptom**: Media elements assigned to non-existent stores

**Query**:
```sql
SELECT sme.id, sme.activation_id, sme.store_id
FROM selected_media_element sme
LEFT JOIN store_activation sa 
  ON sme.activation_id = sa.activation_id 
  AND sme.store_id = sa.store_id
WHERE sa.id IS NULL;
```

**Root Causes**:
- Store removed from activation without cascade
- Media selection before store assignment finalized
- Missing FK constraint

---

## Reporting Template

Use this structure for investigation reports:

```markdown
# Database Investigation Report: [Issue Description]

**Date**: YYYY-MM-DD
**Investigator**: [Name/Agent]
**Database**: store-media-api-db-local
**Schemas Analyzed**: apollo, tesco_uk, foodstuffs

---

## Executive Summary
[2-3 sentence high-level findings and impact]

## Detailed Findings

### 1. Data Structure Issues
- [Finding 1]: [Description] - Severity: [Critical/High/Medium/Low]
  - Affected: [N records across X tables]
  - Evidence: [Query results summary]

### 2. Lifecycle Anomalies
- [Finding 2]: ...

### 3. Product & Media Integrity
- [Finding 3]: ...

### 4. Detected Anomalies
- [Finding 4]: ...

## Data Quality Scorecard
| Metric | Score | Threshold | Status |
|--------|-------|-----------|--------|
| Completeness | X% | >95% | ✅/❌ |
| Consistency | Y% | >98% | ✅/❌ |
| Accuracy | Z% | >99% | ✅/❌ |

## Root Cause Analysis

### Issue: [Pattern Name]
**Count**: N records
**Severity**: [Level]
**Timeline**: First observed [date], recurring [frequency]

**Hypotheses**:
1. [Hypothesis 1] - Probability: X%
   - Evidence: [Supporting data]
2. [Hypothesis 2] - Probability: Y%
   - Evidence: [Supporting data]

**Most Likely RCA**: [Root cause] - Confidence: Z%

**Remediation**:
- Immediate: [Action steps]
- Long-term: [Prevention measures]

---

## Prioritized Recommendations
1. [P0]: [Critical fix] - Timeline: Immediate
2. [P1]: [Important improvement] - Timeline: 1-2 weeks
3. [P2]: [Nice-to-have] - Timeline: Backlog
```

---

## Integration with Other Skills

- **sonarqube-issue-fix-workflow**: Use for code quality issues discovered during schema analysis
- **scrum-master**: Generate task breakdown for database remediation work
- **ralph**: Break down large-scale data cleanup into autonomous tasks
- **workflow-qa-validation**: Validate data integrity rules as test scenarios

---

## Usage Examples

### Example 1: Investigate Campaign Activation Delays
```
User: "Campaigns are stuck in DRAFT status for >7 days. Investigate why."

Agent: 
1. Use postgres-mcp-server to query activation table filtered by status='DRAFT' and created_at < NOW() - INTERVAL '7 days'
2. Apply Phase 2 (Lifecycle Analysis) to trace progression
3. Check store_activation join to identify missing assignments
4. Review store_list_audit_entity for lock patterns
5. Generate RCA report with findings
```

### Example 2: Validate Data After Migration
```
User: "We just migrated data from legacy system. Validate integrity."

Agent:
1. Run Phase 1 (Data Structure Discovery) across all schemas
2. Execute Phase 3 (Product & Media Integrity) checks
3. Run Phase 4 (Anomaly Detection) with focus on referential integrity
4. Calculate Phase 5 (Data Quality Metrics)
5. Generate scorecard with pass/fail per metric
```

---

## Key Takeaways

1. **Two-level architecture**: Understand application schema (`store-media-api`) routes to tenant schemas (`apollo`, `tesco_uk`, `foodstuffs`)
2. **Ad account routing**: All API requests use `ad_account_id` to determine target tenant schema
2. **Retailer mapping**: `store-media-api.retailer` table maps IDs to schemas (apollo, dunnhumby, foodstuffs, tesco_uk)
3. **Multi-tenant aware**: Always specify schema when querying—queries do NOT automatically route
4. **Schema isolation**: No cross-schema queries—each tenant is completely isolated
5. **Soft deletes**: Filter by `is_deleted = false` for active records (boolean, not timestamp)
6. **Lifecycle matters**: Understand campaign state transitions
7. **Referential integrity**: FK relationships are critical—check for orphans (within same schema only)
8. **Audit trail**: `store_list_audit_entity` is primary source of truth for changes
9. **Analysis-only**: Investigation workflows never modify data
10. **Structured reporting**: Follow template for consistency and actionability

---

## Maintenance Notes

**Last Updated**: 2026-02-13
**Schema Version**: 1.0
**Owned By**: Store Media API Team

**Update Triggers**:
- Schema changes (new tables, columns, constraints)
- New business logic rules
- Discovery of new anomaly patterns
- Investigation framework improvements
