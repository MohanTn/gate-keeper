# Database Verification Report - Store Media API Skill

**Date**: 2026-02-13  
**Database**: store-media-api-db-local  
**Verification Method**: Direct postgres-mcp-server queries

---

## Verified Schema Architecture

### Application Level: `store-media-api` Schema

**Tables Verified**:
- ✅ `retailer` - Maps retailer IDs to tenant schemas
- ✅ `uiconfiguration` - UI configuration
- ✅ `cloud_setting` - Cloud settings  
- ✅ `__MyMigrationsHistory` - Migration tracking

**Retailer Mapping Table** (`store-media-api.retailer`):

| Retailer ID (UUID) | schema_name | short_name | long_name | market |
|-------------------|-------------|------------|-----------|--------|
| 30f45a54-df1a-4dbf-a9f6-b06a50673bdc | apollo | null | null | null |
| 6afe8a99-fcbf-66f2-4f8f-707564a84962 | dunnhumby | dunnhumby | Dunnhumby | UK |
| 03c29acd-7b49-4bfa-ae66-b646e9912b90 | foodstuffs | foodstuffs | FoodStuffs | NZ |
| 0e293d7c-60ca-4045-b054-e99ef1f32327 | tesco_uk | tesco_uk | Tesco UK | UK |

---

### Tenant Level: Data Schemas

**Schemas Found**:
- ✅ `apollo` (primary tenant) - **5,358 active activations**
- ✅ `apollo-1` (variant/backup)
- ✅ `dunnhumby` (UK market)
- ✅ `foodstuffs` (NZ market)
- ✅ `tesco_uk` (UK market) - **0 active activations**

**Note**: Documentation originally mentioned only 3 tenant schemas (apollo, tesco_uk, foodstuffs), but 5 actually exist.

---

## Core Table Verification

### `activation` Table (Apollo Schema)

**Verified Columns** (35 total):
- ✅ `activation_id` (PK, varchar) - **NOT** `id`
- ✅ `name` (varchar)
- ✅ `duration_from` (timestamp with time zone) - **NOT** `start_date`
- ✅ `duration_to` (timestamp with time zone) - **NOT** `end_date`
- ✅ `status` (integer) - status code, not string
- ✅ `ad_account_id` (uuid) - Link to retailer/schema
- ✅ `created_at` (timestamp with time zone)
- ✅ `updated_at` (timestamp with time zone)
- ✅ `is_deleted` (boolean) - **NOT** `deleted_at` timestamp
- ✅ `deleted_date` (timestamp with time zone, nullable)
- Budget, category, brands, booking info, user tracking, etc.

**Key Findings**:
- Primary key is `activation_id` (varchar), not `id` (integer)
- Soft delete uses `is_deleted` boolean, not `deleted_at IS NULL`
- Date range uses `duration_from`/`duration_to`, not `start_date`/`end_date`
- Each activation has `ad_account_id` linking to retailer/schema

---

### `store_activation` Table (Apollo Schema)

**Verified Columns** (4 total):
- ✅ `id` (PK, integer auto-increment)
- ✅ `activation_id` (varchar) - FK to activation
- ✅ `store_code` (text) - **NOT** `store_id`
- ✅ `evaluation_type` (integer, nullable)
  - 0 = Target store
  - 1 = Control store
  - NULL = Unassigned

**Key Findings**:
- Stores identified by `store_code`, not `store_id`
- Only 4 columns (minimal design)
- `evaluation_type` can be NULL

---

### `store_list_audit_entity` Table (Apollo Schema)

**Verified Columns** (13 total):
- ✅ `store_list_audit_id` (PK, integer) - **NOT** `id`
- ✅ `activation_id` (varchar)
- ✅ `action_type` (integer) - **NOT** `action`
  - 0 = Locked
  - 1 = Unlocked
  - 2 = Amended
- ✅ `target_stores` (integer) - Count of target stores
- ✅ `control_stores` (integer) - Count of control stores
- ✅ `total_selected_stores` (integer)
- ✅ `created_at` (timestamp with time zone) - **NOT** `timestamp`
- ✅ `created_by` (text) - **NOT** `user_id`
- ✅ `user_email` (text)
- Creator/updater tracking fields

**Key Findings**:
- Stores aggregated counts (target_stores, control_stores)
- Column name is `action_type`, not `action`
- Includes email tracking for audit purposes
- No `details` column (structured fields instead)

---

## Total Table Count

**Apollo Schema**: **53 tables** (not just 8 core tables)

Additional tables include:
- activation_snapshot, activation_status_audit, activation_status_transition
- aisle, location, store, media_element tables
- Creative management (creative_file, creative_finish)
- Bundle/package management
- Configuration and settings tables

**Documentation Impact**: Skill documentation focuses on 8 core tables for campaign lifecycle, which is appropriate for investigations. Other tables support supplementary features.

---

## Key Corrections Made to Skill Documentation

### ✅ Corrected

1. **Tenant schemas**: Added dunnhumby, noted apollo-1 exists
2. **Retailer mapping**: Changed from "ad_account_mapping" to actual `retailer` table
3. **Column names**:
   - `activation_id` (not `id`) as PK
   - `duration_from`/`duration_to` (not `start_date`/`end_date`)
   - `is_deleted` boolean (not `deleted_at` timestamp)
   - `store_code` (not `store_id`)
   - `action_type` (not `action`)
   - `created_at` (not `timestamp`)
4. **Soft delete pattern**: `WHERE is_deleted = false` (not `WHERE deleted_at IS NULL`)
5. **Retailer IDs**: Documented actual UUIDs from database

### ⚠️ Documentation Approach

The skill documentation intentionally:
- Focuses on **8 core tables** for campaign lifecycle (not all 53)
- Uses **conceptual descriptions** where helpful for understanding
- Provides **actual column names** for queries

This balance helps users understand the system without overwhelming them with every table/column.

---

## Query Pattern Updates Required

### Old Pattern (Incorrect):
```sql
SELECT * FROM activation 
WHERE id = 123 
  AND start_date < end_date 
  AND deleted_at IS NULL;
```

### New Pattern (Correct):
```sql
SELECT * FROM activation 
WHERE activation_id = '123' 
  AND duration_from < duration_to 
  AND is_deleted = false;
```

### Store Assignment Pattern:
```sql
-- Correct store reference
SELECT * FROM store_activation 
WHERE activation_id = 'ACT-123' 
  AND evaluation_type = 0; -- target stores

-- Stores use store_code, not store_id
```

### Audit Trail Pattern:
```sql
-- Correct audit query
SELECT * FROM store_list_audit_entity
WHERE activation_id = 'ACT-123'
  AND action_type = 0 -- locked
ORDER BY created_at DESC;
```

---

## Recommendations

### 1. Update Query Reference

All example queries in `query-reference.md` should use:
- `activation_id` instead of `id`
- `duration_from`/`duration_to` instead of `start_date`/`end_date`
- `is_deleted = false` instead of `deleted_at IS NULL`
- `action_type` instead of `action`
- `store_code` instead of `store_id`

### 2. Add Dunnhumby Tenant

Include `dunnhumby` schema in all multi-tenant examples:
```sql
-- Query all tenants
SET search_path TO apollo;    -- Primary (5,358 campaigns)
SET search_path TO dunnhumby;  -- UK market
SET search_path TO foodstuffs; -- NZ market
SET search_path TO tesco_uk;   -- UK market (empty)
```

### 3. Document Additional Tables

Consider adding reference for:
- `activation_status_audit` - Status change tracking
- `activation_snapshot` - Point-in-time snapshots
- `store` - Store master data
- `media_element` - Available media types

---

## Validation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Schema architecture | ✅ Verified | Two-level confirmed |
| Retailer mapping table | ✅ Verified | `store-media-api.retailer` |
| Tenant schemas | ✅ Verified | 5 schemas (apollo, apollo-1, dunnhumby, foodstuffs, tesco_uk) |
| activation table | ✅ Verified | 35 columns, activation_id PK |
| store_activation table | ✅ Verified | 4 columns, evaluation_type |
| store_list_audit_entity | ✅ Verified | 13 columns, action_type |
| Soft delete pattern | ✅ Corrected | is_deleted boolean |
| Date range columns | ✅ Corrected | duration_from/to |
| Row counts | ✅ Verified | Apollo: 5,358 active |

---

## Next Steps

1. ✅ Schema architecture documented
2. ✅ Retailer mapping verified
3. ✅ Core tables verified
4. 🔄 Update query-reference.md with correct column names
5. 🔄 Update investigation template examples
6. 🔄 Add dunnhumby to all multi-tenant examples
7. ⏳ Test queries against actual database

---

**Verification Complete**: 2026-02-13  
**Verified By**: GitHub Copilot with postgres-mcp-server  
**Confidence**: High (direct database queries)
