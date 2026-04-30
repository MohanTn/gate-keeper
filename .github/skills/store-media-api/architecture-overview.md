# Store Media API - Database Architecture Overview

## Two-Level Multi-Tenant Schema Architecture

The Store Media API database uses a sophisticated two-level architecture to support multiple tenants while maintaining complete data isolation.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      API Request Layer                          │
│  GET /api/activation/123?ad_account_id=42                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Level 1: Application Schema                        │
│                   (store-media-api)                            │
│                                                                 │
│  ┌───────────────────────────────────────────────────┐        │
│  │   ad_account_schema_mapping table                 │        │
│  │                                                    │        │
│  │  ad_account_id │ schema_name │ is_active │       │        │
│  │  ─────────────────────────────────────────        │        │
│  │       1-1000   │   apollo    │   true    │       │        │
│  │    1001-2000   │ tesco_uk    │   true    │       │        │
│  │    2001-3000   │ foodstuffs  │   true    │       │        │
│  └───────────────────────────────────────────────────┘        │
│                                                                 │
│  Function: Maps ad_account_id → tenant schema                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
              ┌────────────┴────────────┐
              │   Schema Routing Logic   │
              │  (Application Server)    │
              └────────────┬────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   apollo    │   │  tesco_uk   │   │ foodstuffs  │
│   schema    │   │   schema    │   │   schema    │
└─────────────┘   └─────────────┘   └─────────────┘

┌─────────────────────────────────────────────────────────────────┐
│          Level 2: Tenant Data Schemas (Identical Structure)     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Common Tables (in each tenant schema):              │      │
│  │  • activation                                         │      │
│  │  • store_activation                                   │      │
│  │  • product_activation                                 │      │
│  │  • activation_measured_product                        │      │
│  │  • activation_attribute                               │      │
│  │  • store_list_audit_entity                            │      │
│  │  • selected_media_element                             │      │
│  │  • selected_store_element                             │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                  │
│  Isolation: No cross-schema foreign keys or queries allowed     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Request Flow Examples

### Example 1: API Request (Normal Application Flow)

```
Step 1: Frontend sends request
─────────────────────────────
const { adAccountId } = useUserContext(); // adAccountId = 42
fetch(`/api/activation/123?ad_account_id=${adAccountId}`)

Step 2: API receives request
─────────────────────────────
GET /api/activation/123?ad_account_id=42

Step 3: Application routing (Level 1)
─────────────────────────────
Query application schema:
  SET search_path TO store-media-api;
  SELECT schema_name FROM ad_account_schema_mapping 
  WHERE ad_account_id = 42;
  
Result: 'apollo'

Step 4: Data query (Level 2)
─────────────────────────────
SET search_path TO apollo;
SELECT * FROM activation WHERE id = 123 AND deleted_at IS NULL;

Step 5: Response
─────────────────────────────
{ activationId: 123, name: "Campaign A", ... }
```

### Example 2: Database Investigation (Direct Query)

```
Step 1: Investigator chooses tenant
─────────────────────────────
Purpose: Find campaigns stuck in DRAFT
Target: apollo schema (based on issue report)

Step 2: Query tenant schema directly
─────────────────────────────
Using postgres-mcp-server:
  database: store-media-api-db-local
  schema: apollo
  query: |
    SELECT a.id, a.name, a.status, a.created_at
    FROM activation a
    LEFT JOIN store_activation sa ON a.id = sa.activation_id
    WHERE a.status = 'DRAFT' 
      AND sa.id IS NULL 
      AND a.deleted_at IS NULL
      AND a.created_at < NOW() - INTERVAL '7 days';

Note: Application routing is BYPASSED
      No ad_account_id lookup needed
      Direct access to tenant data

Step 3: Repeat for other tenants (if needed)
─────────────────────────────
SET search_path TO tesco_uk;
[Run same query]

SET search_path TO foodstuffs;
[Run same query]

Step 4: Aggregate results manually
─────────────────────────────
Apollo:     47 stuck campaigns
Tesco UK:   12 stuck campaigns
Foodstuffs:  5 stuck campaigns
Total:      64 stuck campaigns across all tenants
```

---

## Schema Characteristics

### Level 1: Application Schema (`store-media-api`)

| Characteristic | Details |
|----------------|---------|
| **Purpose** | Route requests to appropriate tenant |
| **Primary Table** | `ad_account_schema_mapping` |
| **Query Frequency** | Every API request |
| **Investigation Use** | Rarely queried directly |
| **Data Volume** | Small (mapping table only) |
| **Update Frequency** | Low (only when tenants added/modified) |

**Key Operations**:
- Lookup: `ad_account_id` → `schema_name`
- Validation: Ensure ad_account is active
- Auditing: Track which accounts use which schema

### Level 2: Tenant Schemas (`apollo`, `tesco_uk`, `foodstuffs`)

| Characteristic | Details |
|----------------|---------|
| **Purpose** | Store campaign data for specific tenant |
| **Table Count** | 8 core tables (identical across schemas) |
| **Query Frequency** | Every data request |
| **Investigation Use** | Primary focus—all data analysis |
| **Data Volume** | Large (full campaign history) |
| **Update Frequency** | High (campaign CRUD operations) |

**Key Operations**:
- Campaign lifecycle management
- Store assignments
- Product tracking
- Media placements
- Audit history

---

## Data Isolation Rules

### ✅ Allowed

1. **Query within single schema**
   ```sql
   SET search_path TO apollo;
   SELECT a.*, sa.store_id 
   FROM activation a
   JOIN store_activation sa ON a.id = sa.activation_id;
   ```

2. **Query same table across schemas (separately)**
   ```sql
   -- Query 1
   SET search_path TO apollo;
   SELECT COUNT(*) FROM activation;
   
   -- Query 2
   SET search_path TO tesco_uk;
   SELECT COUNT(*) FROM activation;
   ```

3. **Aggregate results programmatically**
   ```typescript
   const apolloCount = await querySchema('apollo', 'SELECT COUNT(*) FROM activation');
   const tescoCount = await querySchema('tesco_uk', 'SELECT COUNT(*) FROM activation');
   const total = apolloCount + tescoCount;
   ```

### ❌ Prohibited

1. **Cross-schema JOIN**
   ```sql
   -- INVALID: Cannot JOIN across schemas
   SELECT a1.id, a2.id
   FROM apollo.activation a1
   JOIN tesco_uk.activation a2 ON a1.name = a2.name;
   ```

2. **Cross-schema foreign keys**
   ```sql
   -- INVALID: No FK relationships across schemas
   ALTER TABLE apollo.activation
   ADD CONSTRAINT fk_tesco
   FOREIGN KEY (tesco_ref_id) REFERENCES tesco_uk.activation(id);
   ```

3. **Global unique constraints**
   ```sql
   -- INVALID: Uniqueness only within schema, not across
   -- Cannot enforce unique activation names globally
   -- Each schema can have activation named "Campaign A"
   ```

---

## Multi-Tenant Query Patterns

### Pattern 1: Per-Tenant Analysis

**Use Case**: Analyze data quality in each tenant independently

```sql
-- Run for apollo
SET search_path TO apollo;
SELECT 
  COUNT(*) as total_campaigns,
  COUNT(*) FILTER (WHERE status = 'DRAFT') as draft,
  COUNT(*) FILTER (WHERE status = 'PUBLISHED') as published
FROM activation WHERE deleted_at IS NULL;

-- Run for tesco_uk
SET search_path TO tesco_uk;
[Same query]

-- Run for foodstuffs
SET search_path TO foodstuffs;
[Same query]
```

### Pattern 2: Cross-Tenant Aggregation

**Use Case**: Total count across all tenants

```sql
-- Method: Union results from each schema
SET search_path TO apollo;
SELECT 'apollo' as tenant, COUNT(*) as count FROM activation WHERE deleted_at IS NULL
UNION ALL
(SET search_path TO tesco_uk; 
 SELECT 'tesco_uk', COUNT(*) FROM activation WHERE deleted_at IS NULL)
UNION ALL
(SET search_path TO foodstuffs;
 SELECT 'foodstuffs', COUNT(*) FROM activation WHERE deleted_at IS NULL);
```

**Recommended Approach**: Query separately and aggregate programmatically

### Pattern 3: Tenant-Specific Investigation

**Use Case**: Issue reported by specific ad account

```sql
-- Step 1: Determine tenant from ad_account_id
SET search_path TO store-media-api;
SELECT schema_name FROM ad_account_schema_mapping 
WHERE ad_account_id = 42;
-- Result: 'apollo'

-- Step 2: Query appropriate tenant schema
SET search_path TO apollo;
SELECT * FROM activation WHERE id = 123 AND deleted_at IS NULL;
```

---

## Investigation Workflow Adjustments

### When Investigating Issues

1. **Identify affected tenant(s)**:
   - If issue is ad_account-specific: Query application schema to find tenant
   - If issue is system-wide: Query all tenant schemas

2. **Set schema context**:
   ```sql
   SET search_path TO <tenant_schema>;
   ```

3. **Run investigation queries**:
   - All joins and queries within single schema
   - No cross-schema references

4. **Repeat for other tenants** (if needed)

5. **Aggregate findings**:
   - Manually combine results across tenants
   - Report per-tenant and total metrics

### Common Pitfalls to Avoid

| Pitfall | Why It Happens | How to Avoid |
|---------|----------------|--------------|
| Forgetting to set schema | Default `search_path` may be wrong | Always `SET search_path` explicitly |
| Mixing results from different schemas | Aggregating without schema labels | Always include schema identifier in results |
| Assuming cross-tenant consistency | Schema structures are identical but data isn't | Verify patterns in each schema independently |
| Querying application schema for data | Confusion about which level to query | Level 1 = routing, Level 2 = data |

---

## Key Takeaways

1. **Two distinct levels**: Application routing (Level 1) vs. Data storage (Level 2)
2. **Direct access bypasses routing**: Investigations query tenant schemas directly
3. **Complete isolation**: No cross-schema queries or foreign keys allowed
4. **Identical structure**: All tenant schemas have same table definitions
5. **Manual aggregation**: Cross-tenant analysis requires querying each schema separately
6. **Schema context critical**: Always specify which tenant schema you're querying
7. **Application schema rarely used**: Mainly for understanding ad_account mappings

---

## Reference Links

- **Full Skill Documentation**: [SKILL.md](./SKILL.md)
- **Query Reference**: [query-reference.md](./query-reference.md)
- **Investigation Template**: [templates/investigation-template.md](./templates/investigation-template.md)

---

**Last Updated**: 2026-02-13  
**Maintained By**: Store Media API Team
