# Store Media API - Common Investigation Queries

Quick reference for frequently used database queries during investigations.

---

## Important: Two-Level Schema Architecture

**Understanding the Routing**:
- **Application Level**: `store-media-api` schema routes by `ad_account_id` (API layer)
- **Tenant Level**: `apollo`, `tesco_uk`, `foodstuffs` schemas contain actual data

**For Investigations**:
- You query **tenant schemas directly** (apollo/tesco_uk/foodstuffs)
- Application routing is **bypassed** when using `postgres-mcp-server`
- Must **explicitly specify** which tenant schema to query
- **No cross-schema JOINs** allowed—complete isolation

**Query Pattern**:
```sql
-- Always set search_path or use schema-qualified names
SET search_path TO apollo;
SELECT * FROM activation WHERE deleted_at IS NULL;

-- OR use schema-qualified table names
SELECT * FROM apollo.activation WHERE deleted_at IS NULL;
```

---

## Table of Contents
1. [Row Counts & Baseline](#row-counts--baseline)
2. [Lifecycle & State Analysis](#lifecycle--state-analysis)
3. [Store Assignment Queries](#store-assignment-queries)
4. [Product & Media Integrity](#product--media-integrity)
5. [Audit Trail Analysis](#audit-trail-analysis)
6. [Anomaly Detection](#anomaly-detection)
7. [Data Quality Metrics](#data-quality-metrics)

---

## Row Counts & Baseline

### Count All Records Per Table
```sql
SELECT 
  'activation' as table_name, 
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE deleted_at IS NULL) as active
FROM activation
UNION ALL
SELECT 
  'store_activation', 
  COUNT(*),
  COUNT(*) FILTER (WHERE deleted_at IS NULL)
FROM store_activation
UNION ALL
SELECT 
  'product_activation', 
  COUNT(*),
  COUNT(*) FILTER (WHERE deleted_at IS NULL)
FROM product_activation
UNION ALL
SELECT 
  'activation_measured_product', 
  COUNT(*),
  COUNT(*) FILTER (WHERE deleted_at IS NULL)
FROM activation_measured_product
UNION ALL
SELECT 
  'selected_media_element', 
  COUNT(*),
  COUNT(*) FILTER (WHERE deleted_at IS NULL)
FROM selected_media_element
UNION ALL
SELECT 
  'selected_store_element', 
  COUNT(*),
  COUNT(*) FILTER (WHERE deleted_at IS NULL)
FROM selected_store_element
UNION ALL
SELECT 
  'store_list_audit_entity', 
  COUNT(*),
  NULL
FROM store_list_audit_entity;
```

### Active Campaigns by Status
```sql
SELECT 
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM activation
WHERE deleted_at IS NULL
GROUP BY status
ORDER BY count DESC;
```

---

## Lifecycle & State Analysis

### Activations Without Store Assignments
```sql
SELECT 
  a.id,
  a.name,
  a.status,
  a.created_at,
  EXTRACT(DAY FROM NOW() - a.created_at) as days_old
FROM activation a
LEFT JOIN store_activation sa ON a.id = sa.activation_id
WHERE sa.id IS NULL 
  AND a.deleted_at IS NULL
ORDER BY a.created_at DESC;
```

### Stale Drafts (Never Locked, >7 Days Old)
```sql
SELECT 
  a.id,
  a.name,
  a.created_at,
  EXTRACT(DAY FROM NOW() - a.created_at) as days_old,
  COUNT(sa.id) as store_count
FROM activation a
LEFT JOIN store_activation sa ON a.id = sa.activation_id
LEFT JOIN store_list_audit_entity slae ON a.id = slae.activation_id AND slae.action = 0
WHERE a.status = 'DRAFT'
  AND a.created_at < NOW() - INTERVAL '7 days'
  AND slae.id IS NULL
  AND a.deleted_at IS NULL
GROUP BY a.id, a.name, a.created_at
ORDER BY days_old DESC;
```

### Campaign Progression Timeline
```sql
SELECT 
  a.id,
  a.name,
  a.created_at,
  MIN(sa.created_at) as first_store_assigned,
  MIN(CASE WHEN slae.action = 0 THEN slae.timestamp END) as first_locked,
  MIN(sme.created_at) as first_media_assigned,
  a.updated_at as last_updated,
  a.status as current_status
FROM activation a
LEFT JOIN store_activation sa ON a.id = sa.activation_id
LEFT JOIN store_list_audit_entity slae ON a.id = slae.activation_id
LEFT JOIN selected_media_element sme ON a.id = sme.activation_id
WHERE a.deleted_at IS NULL
GROUP BY a.id, a.name, a.created_at, a.updated_at, a.status
ORDER BY a.created_at DESC
LIMIT 50;
```

### Campaigns with High Churn (Multiple Lock/Unlock Cycles)
```sql
SELECT 
  activation_id,
  SUM(CASE WHEN action = 0 THEN 1 ELSE 0 END) as lock_count,
  SUM(CASE WHEN action = 1 THEN 1 ELSE 0 END) as unlock_count,
  SUM(CASE WHEN action = 2 THEN 1 ELSE 0 END) as amendment_count,
  MIN(timestamp) as first_action,
  MAX(timestamp) as last_action
FROM store_list_audit_entity
GROUP BY activation_id
HAVING SUM(CASE WHEN action = 0 THEN 1 ELSE 0 END) > 2
  OR SUM(CASE WHEN action = 1 THEN 1 ELSE 0 END) > 1
ORDER BY lock_count DESC, unlock_count DESC;
```

---

## Store Assignment Queries

### Target/Control Distribution Per Activation
```sql
SELECT 
  activation_id,
  COUNT(*) FILTER (WHERE evaluation_type = 0) as target_stores,
  COUNT(*) FILTER (WHERE evaluation_type = 1) as control_stores,
  COUNT(*) FILTER (WHERE evaluation_type IS NULL) as unassigned_stores,
  ROUND(
    COUNT(*) FILTER (WHERE evaluation_type = 0)::numeric / 
    NULLIF(COUNT(*) FILTER (WHERE evaluation_type = 0) + COUNT(*) FILTER (WHERE evaluation_type = 1), 0) * 100,
    2
  ) as target_pct
FROM store_activation
WHERE deleted_at IS NULL
GROUP BY activation_id
ORDER BY activation_id;
```

### Activations with Imbalanced Target/Control Ratio
```sql
WITH ratios AS (
  SELECT 
    activation_id,
    COUNT(*) FILTER (WHERE evaluation_type = 0) as target_count,
    COUNT(*) FILTER (WHERE evaluation_type = 1) as control_count,
    ROUND(
      COUNT(*) FILTER (WHERE evaluation_type = 0)::numeric / 
      NULLIF(COUNT(*), 0) * 100,
      2
    ) as target_pct
  FROM store_activation
  WHERE deleted_at IS NULL
  GROUP BY activation_id
)
SELECT 
  r.*,
  a.name,
  a.status
FROM ratios r
JOIN activation a ON r.activation_id = a.id
WHERE r.target_pct > 90 OR r.target_pct < 50 OR r.control_count = 0
ORDER BY r.target_pct DESC;
```

### Stores with NULL Evaluation Type
```sql
SELECT 
  sa.activation_id,
  a.name,
  a.status,
  COUNT(sa.id) as null_count
FROM store_activation sa
JOIN activation a ON sa.activation_id = a.id
WHERE sa.evaluation_type IS NULL
  AND sa.deleted_at IS NULL
  AND a.deleted_at IS NULL
GROUP BY sa.activation_id, a.name, a.status
ORDER BY null_count DESC;
```

---

## Product & Media Integrity

### Activations Missing Feature Products
```sql
SELECT 
  a.id,
  a.name,
  a.status,
  a.start_date,
  a.end_date
FROM activation a
LEFT JOIN product_activation pa ON a.id = pa.activation_id
WHERE pa.id IS NULL
  AND a.deleted_at IS NULL
ORDER BY a.created_at DESC;
```

### Activations Missing Measurement Products
```sql
SELECT 
  a.id,
  a.name,
  a.status,
  a.start_date,
  a.end_date
FROM activation a
LEFT JOIN activation_measured_product amp ON a.id = amp.activation_id
WHERE amp.id IS NULL
  AND a.deleted_at IS NULL
ORDER BY a.created_at DESC;
```

### Halo vs Feature Product Overlap (Should be 0)
```sql
SELECT 
  pa.activation_id,
  pa.product_id,
  'Both feature and halo' as issue
FROM product_activation pa
JOIN activation_measured_product amp 
  ON pa.activation_id = amp.activation_id 
  AND pa.product_id = amp.product_id
WHERE amp.is_halo = true
  AND pa.deleted_at IS NULL
  AND amp.deleted_at IS NULL;
```

### Target Stores Without Media Assignments
```sql
SELECT 
  sa.activation_id,
  a.name,
  sa.store_id,
  sa.evaluation_type
FROM store_activation sa
JOIN activation a ON sa.activation_id = a.id
LEFT JOIN selected_media_element sme 
  ON sa.activation_id = sme.activation_id 
  AND sa.store_id = sme.store_id
WHERE sa.evaluation_type = 0
  AND sme.id IS NULL
  AND sa.deleted_at IS NULL
  AND a.deleted_at IS NULL
ORDER BY sa.activation_id, sa.store_id;
```

### Media Assignment Coverage
```sql
SELECT 
  sa.activation_id,
  COUNT(DISTINCT sa.store_id) as total_target_stores,
  COUNT(DISTINCT sme.store_id) as stores_with_media,
  ROUND(
    COUNT(DISTINCT sme.store_id)::numeric / 
    NULLIF(COUNT(DISTINCT sa.store_id), 0) * 100,
    2
  ) as coverage_pct
FROM store_activation sa
LEFT JOIN selected_media_element sme 
  ON sa.activation_id = sme.activation_id 
  AND sa.store_id = sme.store_id
WHERE sa.evaluation_type = 0
  AND sa.deleted_at IS NULL
GROUP BY sa.activation_id
HAVING COUNT(DISTINCT sme.store_id) < COUNT(DISTINCT sa.store_id)
ORDER BY coverage_pct ASC;
```

---

## Audit Trail Analysis

### Lock/Unlock Timeline Per Activation
```sql
SELECT 
  activation_id,
  timestamp,
  CASE 
    WHEN action = 0 THEN 'LOCK'
    WHEN action = 1 THEN 'UNLOCK'
    WHEN action = 2 THEN 'AMEND'
  END as action_type,
  user_id,
  details
FROM store_list_audit_entity
WHERE activation_id = <ACTIVATION_ID>
ORDER BY timestamp ASC;
```

### Activations with Unbalanced Lock/Unlock
```sql
SELECT 
  activation_id,
  SUM(CASE WHEN action = 0 THEN 1 ELSE 0 END) as locks,
  SUM(CASE WHEN action = 1 THEN 1 ELSE 0 END) as unlocks,
  SUM(CASE WHEN action = 2 THEN 1 ELSE 0 END) as amendments
FROM store_list_audit_entity
GROUP BY activation_id
HAVING SUM(CASE WHEN action = 0 THEN 1 ELSE 0 END) != 
       SUM(CASE WHEN action = 1 THEN 1 ELSE 0 END)
ORDER BY ABS(
  SUM(CASE WHEN action = 0 THEN 1 ELSE 0 END) - 
  SUM(CASE WHEN action = 1 THEN 1 ELSE 0 END)
) DESC;
```

### Out-of-Hours Changes (Weekends or 10 PM - 6 AM)
```sql
SELECT 
  activation_id,
  timestamp,
  CASE 
    WHEN action = 0 THEN 'LOCK'
    WHEN action = 1 THEN 'UNLOCK'
    WHEN action = 2 THEN 'AMEND'
  END as action_type,
  user_id,
  CASE
    WHEN EXTRACT(DOW FROM timestamp) IN (0, 6) THEN 'Weekend'
    WHEN EXTRACT(HOUR FROM timestamp) >= 22 OR EXTRACT(HOUR FROM timestamp) < 6 THEN 'Night'
    ELSE 'Other'
  END as out_of_hours_type
FROM store_list_audit_entity
WHERE EXTRACT(DOW FROM timestamp) IN (0, 6)
   OR EXTRACT(HOUR FROM timestamp) >= 22 
   OR EXTRACT(HOUR FROM timestamp) < 6
ORDER BY timestamp DESC;
```

---

## Anomaly Detection

### Date Inconsistencies (End Before Start)
```sql
SELECT 
  id,
  name,
  start_date,
  end_date,
  EXTRACT(DAY FROM start_date - end_date) as days_invalid,
  status
FROM activation
WHERE end_date < start_date
  AND deleted_at IS NULL
ORDER BY days_invalid DESC;
```

### Timestamp Sequence Violations
```sql
SELECT 
  id,
  name,
  created_at,
  updated_at,
  deleted_at,
  CASE
    WHEN updated_at < created_at THEN 'updated_before_created'
    WHEN deleted_at < created_at THEN 'deleted_before_created'
    WHEN deleted_at < updated_at THEN 'deleted_before_updated'
  END as violation_type
FROM activation
WHERE updated_at < created_at
   OR (deleted_at IS NOT NULL AND deleted_at < created_at)
   OR (deleted_at IS NOT NULL AND deleted_at < updated_at);
```

### Orphaned Store Activations (Missing Parent Activation)
```sql
SELECT 
  sa.id,
  sa.activation_id,
  sa.store_id,
  sa.created_at
FROM store_activation sa
LEFT JOIN activation a ON sa.activation_id = a.id
WHERE a.id IS NULL
ORDER BY sa.created_at DESC;
```

### Orphaned Media Selections
```sql
SELECT 
  sme.id,
  sme.activation_id,
  sme.store_id,
  sme.media_element_id
FROM selected_media_element sme
LEFT JOIN store_activation sa 
  ON sme.activation_id = sa.activation_id 
  AND sme.store_id = sa.store_id
WHERE sa.id IS NULL
ORDER BY sme.activation_id, sme.store_id;
```

### Duplicate Store Assignments Per Activation
```sql
SELECT 
  activation_id,
  store_id,
  COUNT(*) as duplicate_count
FROM store_activation
WHERE deleted_at IS NULL
GROUP BY activation_id, store_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;
```

### Duplicate Activation Names (Same Tenant, Overlapping Dates)
```sql
SELECT 
  a1.id as activation_id_1,
  a2.id as activation_id_2,
  a1.name,
  a1.start_date as start1,
  a1.end_date as end1,
  a2.start_date as start2,
  a2.end_date as end2
FROM activation a1
JOIN activation a2 
  ON a1.name = a2.name 
  AND a1.id < a2.id
  AND (
    (a1.start_date BETWEEN a2.start_date AND a2.end_date)
    OR (a1.end_date BETWEEN a2.start_date AND a2.end_date)
    OR (a2.start_date BETWEEN a1.start_date AND a1.end_date)
    OR (a2.end_date BETWEEN a1.start_date AND a1.end_date)
  )
WHERE a1.deleted_at IS NULL 
  AND a2.deleted_at IS NULL
ORDER BY a1.name, a1.start_date;
```

### Post-Campaign Amendments
```sql
SELECT 
  slae.activation_id,
  a.name,
  a.end_date as campaign_end,
  slae.timestamp as amendment_time,
  EXTRACT(DAY FROM slae.timestamp - a.end_date) as days_after_end
FROM store_list_audit_entity slae
JOIN activation a ON slae.activation_id = a.id
WHERE slae.action = 2
  AND slae.timestamp > a.end_date
ORDER BY days_after_end DESC;
```

---

## Data Quality Metrics

### Completeness Score
```sql
WITH completeness AS (
  SELECT 
    a.id,
    a.name,
    EXISTS(SELECT 1 FROM store_activation WHERE activation_id = a.id) as has_stores,
    EXISTS(SELECT 1 FROM product_activation WHERE activation_id = a.id) as has_products,
    EXISTS(SELECT 1 FROM selected_media_element WHERE activation_id = a.id) as has_media,
    EXISTS(SELECT 1 FROM activation_measured_product WHERE activation_id = a.id) as has_measured_products,
    (a.start_date IS NOT NULL AND a.end_date IS NOT NULL) as has_dates,
    (a.status IS NOT NULL) as has_status
  FROM activation a
  WHERE a.deleted_at IS NULL
)
SELECT 
  COUNT(*) as total_activations,
  COUNT(*) FILTER (WHERE has_stores AND has_products AND has_media AND has_measured_products AND has_dates AND has_status) as complete_activations,
  ROUND(
    COUNT(*) FILTER (WHERE has_stores AND has_products AND has_media AND has_measured_products AND has_dates AND has_status)::numeric / 
    NULLIF(COUNT(*), 0) * 100,
    2
  ) as completeness_pct,
  COUNT(*) FILTER (WHERE NOT has_stores) as missing_stores,
  COUNT(*) FILTER (WHERE NOT has_products) as missing_products,
  COUNT(*) FILTER (WHERE NOT has_media) as missing_media,
  COUNT(*) FILTER (WHERE NOT has_measured_products) as missing_measured_products,
  COUNT(*) FILTER (WHERE NOT has_dates) as missing_dates,
  COUNT(*) FILTER (WHERE NOT has_status) as missing_status
FROM completeness;
```

### Consistency Score (Business Logic Checks)
```sql
WITH consistency_checks AS (
  SELECT 
    a.id,
    -- Date consistency
    (a.start_date < a.end_date OR a.start_date IS NULL OR a.end_date IS NULL) as valid_dates,
    -- Timestamp consistency
    (a.created_at <= a.updated_at) as valid_timestamps,
    -- Store assignment consistency (has stores AND all have eval_type)
    (
      NOT EXISTS(SELECT 1 FROM store_activation WHERE activation_id = a.id)
      OR NOT EXISTS(SELECT 1 FROM store_activation WHERE activation_id = a.id AND evaluation_type IS NULL)
    ) as valid_store_assignments,
    -- Target/control ratio (if has stores, should have reasonable ratio)
    (
      NOT EXISTS(SELECT 1 FROM store_activation WHERE activation_id = a.id AND evaluation_type = 0)
      OR EXISTS(SELECT 1 FROM store_activation WHERE activation_id = a.id AND evaluation_type = 1)
    ) as has_control_stores
  FROM activation a
  WHERE a.deleted_at IS NULL
)
SELECT 
  COUNT(*) as total_activations,
  COUNT(*) FILTER (WHERE valid_dates AND valid_timestamps AND valid_store_assignments AND has_control_stores) as consistent_activations,
  ROUND(
    COUNT(*) FILTER (WHERE valid_dates AND valid_timestamps AND valid_store_assignments AND has_control_stores)::numeric / 
    NULLIF(COUNT(*), 0) * 100,
    2
  ) as consistency_pct,
  COUNT(*) FILTER (WHERE NOT valid_dates) as invalid_dates,
  COUNT(*) FILTER (WHERE NOT valid_timestamps) as invalid_timestamps,
  COUNT(*) FILTER (WHERE NOT valid_store_assignments) as invalid_store_assignments,
  COUNT(*) FILTER (WHERE NOT has_control_stores) as missing_control_stores
FROM consistency_checks;
```

### Timeliness Metrics
```sql
SELECT 
  COUNT(*) FILTER (WHERE status = 'DRAFT' AND created_at < NOW() - INTERVAL '30 days') as stale_drafts_30d,
  COUNT(*) FILTER (WHERE status = 'DRAFT' AND created_at < NOW() - INTERVAL '60 days') as stale_drafts_60d,
  COUNT(*) FILTER (WHERE status = 'DRAFT' AND created_at < NOW() - INTERVAL '90 days') as stale_drafts_90d,
  COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '90 days') as not_updated_90d,
  COUNT(*) FILTER (WHERE end_date < NOW() AND updated_at > end_date) as past_campaign_updates
FROM activation
WHERE deleted_at IS NULL;
```

---

## Multi-Schema Queries

### Compare Row Counts Across All Tenant Schemas
```sql
-- Must run separately for each schema, then combine results manually
-- Run 1: apollo
SET search_path TO apollo;
SELECT 
  'apollo' as schema,
  COUNT(*) FILTER (WHERE deleted_at IS NULL) as active_activations,
  COUNT(DISTINCT sa.store_id) as unique_stores,
  COUNT(DISTINCT pa.product_id) as unique_products
FROM activation a
LEFT JOIN store_activation sa ON a.id = sa.activation_id
LEFT JOIN product_activation pa ON a.id = pa.activation_id;

-- Run 2: tesco_uk
SET search_path TO tesco_uk;
SELECT 
  'tesco_uk' as schema,
  COUNT(*) FILTER (WHERE deleted_at IS NULL) as active_activations,
  COUNT(DISTINCT sa.store_id) as unique_stores,
  COUNT(DISTINCT pa.product_id) as unique_products
FROM activation a
LEFT JOIN store_activation sa ON a.id = sa.activation_id
LEFT JOIN product_activation pa ON a.id = pa.activation_id;

-- Run 3: foodstuffs
SET search_path TO foodstuffs;
SELECT 
  'foodstuffs' as schema,
  COUNT(*) FILTER (WHERE deleted_at IS NULL) as active_activations,
  COUNT(DISTINCT sa.store_id) as unique_stores,
  COUNT(DISTINCT pa.product_id) as unique_products
FROM activation a
LEFT JOIN store_activation sa ON a.id = sa.activation_id
LEFT JOIN product_activation pa ON a.id = pa.activation_id;

-- Combine results manually in investigation report
```

### Cross-Schema Consistency Check
```sql
-- Run this query once per schema and compare results
SET search_path TO <SCHEMA_NAME>; -- apollo, tesco_uk, or foodstuffs

SELECT 
  '<SCHEMA_NAME>' as schema,
  COUNT(*) as total_activations,
  COUNT(*) FILTER (WHERE status = 'DRAFT') as draft_count,
  COUNT(*) FILTER (WHERE status = 'PUBLISHED') as published_count,
  AVG(EXTRACT(DAY FROM end_date - start_date)) as avg_campaign_duration_days
FROM activation
WHERE deleted_at IS NULL;
```

### Query Application Routing Schema (Ad Account Mapping)
```sql
-- Query the application-level schema to understand ad_account routing
SET search_path TO store-media-api;

-- Example: Find which schema an ad_account maps to
SELECT 
  ad_account_id,
  schema_name,  -- 'apollo', 'tesco_uk', or 'foodstuffs'
  created_at,
  is_active
FROM ad_account_schema_mapping
WHERE ad_account_id = <AD_ACCOUNT_ID>;

-- List all active ad_account mappings
SELECT 
  schema_name,
  COUNT(ad_account_id) as account_count,
  MIN(ad_account_id) as min_account_id,
  MAX(ad_account_id) as max_account_id
FROM ad_account_schema_mapping
WHERE is_active = true
GROUP BY schema_name
ORDER BY schema_name;
```

**Note**: Application schema queries are rarely needed for investigations—focus on tenant schemas for data analysis.

---

## Performance Notes

- Always include `WHERE deleted_at IS NULL` for active record queries
- Use indexes on: `activation_id`, `store_id`, `product_id`, `evaluation_type`, `status`, `created_at`
- For large result sets, add `LIMIT` and `OFFSET` for pagination
- Use `EXPLAIN ANALYZE` prefix to check query performance
- Consider creating materialized views for frequently-run metric queries
- **No cross-schema queries**: Each tenant is isolated—query separately and aggregate manually
- **Schema context is critical**: Always set `search_path` or use schema-qualified table names

---

## Usage Tips

1. **Copy-paste and customize**: Replace `<ACTIVATION_ID>`, `<SCHEMA_NAME>`, etc.
2. **Use CTEs for readability**: Break complex queries into Common Table Expressions
3. **Test on small datasets first**: Add `LIMIT 10` when developing queries
4. **Export results**: Save query results as CSV for further analysis
5. **Document findings**: Record query results in investigation template

---

**Last Updated**: 2026-02-13  
**Maintained By**: Store Media API Team
