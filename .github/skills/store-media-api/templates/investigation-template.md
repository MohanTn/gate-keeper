# Database Investigation: [Issue Description]

**Date**: YYYY-MM-DD  
**Investigator**: [Name/Agent]  
**Database**: store-media-api-db-local  
**Schemas**: apollo, tesco_uk, foodstuffs (tenant data schemas)  
**Status**: 🔄 In Progress / ✅ Complete

---

## Schema Architecture Context

**Two-Level Architecture**:
- **Level 1**: Application schema (`store-media-api`) - Routes by `ad_account_id`
- **Level 2**: Tenant schemas (`apollo`, `tesco_uk`, `foodstuffs`) - Contains data

**Investigation Scope**: 
- Querying **tenant schemas directly** (bypasses application routing)
- Each schema analyzed separately, results aggregated manually
- No cross-schema JOINs—complete data isolation

---

## Investigation Checklist

- [ ] Phase 0: Setup Complete
- [ ] Phase 1: Data Structure Discovery
- [ ] Phase 2: Activation Lifecycle Analysis
- [ ] Phase 3: Product & Media Integrity
- [ ] Phase 4: Anomaly Detection
- [ ] Phase 5: Data Quality Metrics
- [ ] Phase 6: Root Cause Analysis
- [ ] Report Finalized

---

## Executive Summary

[To be completed at end - 2-3 sentences summarizing key findings and impact]

---

## Phase 0: Setup

- **Investigation slug**: `[slug-name]`
- **Artifact location**: `.claude/artifacts/[slug-name]/investigate-db.md`
- **Mode**: Analysis-only (no database modifications)
- **Started**: [timestamp]

---

## Phase 1: Data Structure Discovery

### Row Counts

| Table | apollo | tesco_uk | foodstuffs | Notes |
|-------|--------|----------|------------|-------|
| activation | | | | |
| store_activation | | | | |
| activation_measured_product | | | | |
| product_activation | | | | |
| activation_attribute | | | | |
| store_list_audit_entity | | | | |
| selected_media_element | | | | |
| selected_store_element | | | | |

### Schema Validation

#### Nullable Columns Check
- [ ] Verified non-null constraints on critical fields
- Findings: [List any unexpected nullable columns]

#### Enum Values Check
- [ ] `store_activation.evaluation_type` values: [0, 1, NULL counts]
- [ ] `store_list_audit_entity.action` values: [0, 1, 2 counts]
- Findings: [List any unexpected enum values]

#### Date/Timestamp Consistency
- [ ] Verified `created_at < updated_at < deleted_at`
- [ ] Verified `start_date < end_date` for activations
- Violations found: [count]
- Details: [Query results]

#### Referential Integrity
- [ ] Checked for orphaned records (missing FK targets)
- [ ] Checked for circular references
- [ ] Verified no duplicate primary keys
- Issues found: [List tables with issues]

### Findings Summary
[Summarize key data structure issues discovered]

---

## Phase 2: Activation Lifecycle Analysis

### Campaign State Timeline

| Activation ID | Created | First Store Assigned | Locked | Media Assigned | Published | Status |
|---------------|---------|---------------------|--------|----------------|-----------|--------|
| | | | | | | |

### Lifecycle Anomalies

#### Activations Without Stores
- Count: [N]
- Query results:
```
[Paste query results]
```

#### Never-Locked Drafts (>7 days old)
- Count: [N]
- Oldest: [activation_id, created_at]
- Query results:
```
[Paste query results]
```

#### Slow Progression Campaigns
- Threshold: >N days between states
- Count: [N]
- Examples: [List activation IDs]

#### High Churn Campaigns (Multiple Lock/Unlock)
- Count: [N]
- Query results:
```
[Paste query results]
```

### Store Assignment Validation

#### Target/Control Ratios
| Activation ID | Target Stores | Control Stores | Ratio | Status |
|---------------|---------------|----------------|-------|--------|
| | | | | ✅/⚠️ |

#### Missing Cohorts
- All target, no control: [count]
- All control, no target: [count] (should be 0)

#### NULL evaluation_type Assignments
- Count: [N]
- Affected activations: [List IDs]

### Audit Trail Analysis

#### Lock/Unlock Patterns
| Activation ID | Lock Count | Unlock Count | Amendment Count | First Lock | Last Unlock |
|---------------|-----------|--------------|----------------|-----------|------------|
| | | | | | |

#### Out-of-Hours Changes
- Definition: Changes between 10 PM - 6 AM or weekends
- Count: [N]
- Query results:
```
[Paste query results]
```

### Findings Summary
[Summarize key lifecycle issues discovered]

---

## Phase 3: Product & Media Integrity

### Product Completeness

#### Activations Missing Feature Products
- Count: [N]
- Query results:
```
[Paste query results]
```

#### Deactivated Products Linked to Live Campaigns
- Count: [N]
- Affected activations: [List IDs]

#### Halo vs Feature Product Overlap
- Count: [N] (should be 0)
- Violations: [List activation IDs with overlap]

#### Activations Missing Measurement Products
- Count: [N]
- Query results:
```
[Paste query results]
```

### Media Completeness

#### Target Stores Without Media Assignments
- Count: [N store-activation pairs]
- Query results:
```
[Paste query results]
```

#### Media Over-Allocation
- Stores with >expected media elements: [count]
- Details: [List store IDs and counts]

### Findings Summary
[Summarize key product and media integrity issues]

---

## Phase 4: Anomaly Detection

### Temporal Anomalies

#### End Date Before Start Date
- Count: [N]
- Query results:
```
[Paste query results]
```

#### Out-of-Sequence Timestamps
- Violations: [count]
- Examples:
```
[Paste examples]
```

#### Post-Campaign Amendments
- Count: [N]
- Latest amendment vs end_date: [List cases]

### Referential Anomalies

#### Orphaned Records
| Table | Orphaned FK | Count | Sample IDs |
|-------|------------|-------|-----------|
| store_activation | activation_id | | |
| product_activation | activation_id | | |
| selected_media_element | activation_id | | |
| | store_id | | |

#### Missing External References
- Non-existent store IDs: [count]
- Non-existent product IDs: [count]
- Non-existent media element IDs: [count]

### Business Logic Violations

#### Target/Control Imbalance
- >90% target or <5% control: [count activations]
- Details:
```
[Paste query results]
```

#### Budget/Store Misalignment
- [Define specific rule]
- Violations: [count]

#### Invalid Status Transitions
- [Define expected flow]
- Violations: [count]

### Duplication Issues

#### Duplicate Activation Names
- Same tenant, overlapping dates: [count]
- Query results:
```
[Paste query results]
```

#### Duplicate Store Entries Per Activation
- Count: [N]
- Affected activations: [List IDs]

#### Duplicate Media Assignments
- Count: [N]
- Details: [List cases]

### Findings Summary
[Summarize key anomalies detected]

---

## Phase 5: Data Quality Metrics

### Completeness Score

```sql
-- Query used
[Paste completeness query]
```

**Result**: XX.X%  
**Threshold**: >95%  
**Status**: ✅ Pass / ❌ Fail

**Details**:
- Activations with all required fields: [N/total]
- Missing stores: [count]
- Missing products: [count]
- Missing media: [count]

### Consistency Score

```sql
-- Query used
[Paste consistency query]
```

**Result**: XX.X%  
**Threshold**: >98%  
**Status**: ✅ Pass / ❌ Fail

**Details**:
- Records passing business logic checks: [N/total]
- Date consistency failures: [count]
- Referential integrity failures: [count]
- Enum value violations: [count]

### Accuracy Score

**Validation Method**: [Describe sampling approach]  
**Sample Size**: [N records]  
**Result**: XX.X%  
**Threshold**: >99%  
**Status**: ✅ Pass / ❌ Fail

**Details**:
- Manually validated records: [count]
- Validation failures: [count]
- Failure categories: [List]

### Timeliness Metrics

- Stale drafts (>30 days): [count]
- Last updated >90 days ago: [count]
- Campaigns past end_date with recent updates: [count]

### Overall Data Quality Scorecard

| Metric | Score | Threshold | Status | Priority |
|--------|-------|-----------|--------|----------|
| Completeness | XX.X% | >95% | ✅/❌ | P0/P1/P2 |
| Consistency | XX.X% | >98% | ✅/❌ | P0/P1/P2 |
| Accuracy | XX.X% | >99% | ✅/❌ | P0/P1/P2 |
| Timeliness | XX.X% | >90% | ✅/❌ | P0/P1/P2 |

**Overall Grade**: [A/B/C/D/F based on weighted average]

---

## Phase 6: Root Cause Analysis

### Issue 1: [Pattern Name]

**Count**: [N records]  
**Severity**: Critical / High / Medium / Low  
**First Observed**: [Date]  
**Frequency**: [Daily/Weekly/One-time]  
**Affected Schemas**: [apollo, tesco_uk, foodstuffs]

#### Timeline
[Describe when this pattern emerged and how it evolved]

#### Hypotheses

1. **[Hypothesis 1]** - Probability: XX%
   - **Evidence**: [Supporting data from queries]
   - **Counter-evidence**: [Data that contradicts this hypothesis]
   - **Test**: [How to verify this hypothesis]

2. **[Hypothesis 2]** - Probability: XX%
   - **Evidence**: [Supporting data]
   - **Counter-evidence**: [Contradicting data]
   - **Test**: [Verification approach]

3. **[Hypothesis 3]** - Probability: XX%
   - **Evidence**: [Supporting data]
   - **Counter-evidence**: [Contradicting data]
   - **Test**: [Verification approach]

#### Most Likely Root Cause

**RCA**: [Primary root cause]  
**Confidence**: XX%  
**Reasoning**: [Explain why this is most likely]

#### Remediation

**Immediate Fix** (Timeline: <24 hours):
1. [Action step 1]
2. [Action step 2]
3. [Action step 3]

**Short-term** (Timeline: 1-2 weeks):
1. [Action step 1]
2. [Action step 2]

**Long-term Prevention**:
1. [Database constraint to add]
2. [Validation rule to implement]
3. [Monitoring/alerting to set up]
4. [Process change to enforce]

---

### Issue 2: [Pattern Name]

[Repeat structure from Issue 1]

---

## Prioritized Recommendations

### P0 - Critical (Immediate Action Required)
1. **[Recommendation 1]**
   - Impact: [Description of impact if not fixed]
   - Effort: [S/M/L]
   - Timeline: <24 hours
   - Owner: [Team/person]
   - Success criteria: [How to verify fix]

### P1 - High (Within 1-2 Weeks)
1. **[Recommendation 1]**
   - Impact: [Description]
   - Effort: [S/M/L]
   - Timeline: 1-2 weeks
   - Owner: [Team/person]
   - Success criteria: [Verification]

### P2 - Medium (Backlog)
1. **[Recommendation 1]**
   - Impact: [Description]
   - Effort: [S/M/L]
   - Timeline: Backlog
   - Owner: [Team/person]
   - Success criteria: [Verification]

---

## Appendix: Query Log

### Query 1: [Description]
```sql
[Full SQL query]
```

**Results Summary**: [Brief description]  
**Execution Time**: [N ms]  
**Rows Returned**: [count]

### Query 2: [Description]
```sql
[Full SQL query]
```

**Results Summary**: [Brief description]  
**Execution Time**: [N ms]  
**Rows Returned**: [count]

[Continue for all significant queries run]

---

## Investigation Complete

**Completed**: [timestamp]  
**Duration**: [X hours]  
**Total Queries Executed**: [count]  
**Issues Identified**: [count]  
**Recommendations**: P0: [N], P1: [N], P2: [N]

---

**Next Steps**:
1. Review findings with [stakeholder]
2. Create Jira tickets for P0/P1 recommendations
3. Schedule remediation work
4. Set up monitoring for identified patterns
