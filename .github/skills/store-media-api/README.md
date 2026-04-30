# Store Media API Domain Knowledge Skill

> Comprehensive domain expertise for investigating and working with the Store Media API retail campaign database.

## Overview

This skill provides deep knowledge about the Store Media API system, including:
- Database schema and relationships
- Campaign lifecycle management
- Data integrity rules
- Investigation frameworks
- Common SQL query patterns

## When to Use This Skill

Use this skill when you need to:
- 🔍 Investigate database anomalies or data quality issues
- 📊 Analyze campaign activation lifecycle problems
- 🛠️ Troubleshoot store assignment or media placement issues
- 📈 Generate data quality metrics and reports
- 🔎 Perform root cause analysis on database issues
- 📝 Understand Store Media API business logic

## Files in This Skill

### Core Documentation
- **[SKILL.md](./SKILL.md)** - Complete skill definition with database schema, business rules, investigation framework, and usage patterns
- **[architecture-overview.md](./architecture-overview.md)** - Detailed explanation of two-level schema architecture with diagrams and examples

### Templates
- **[templates/investigation-template.md](./templates/investigation-template.md)** - Structured template for conducting database investigations with all 6 phases pre-formatted

### Reference Guides
- **[query-reference.md](./query-reference.md)** - Quick reference of common SQL queries organized by investigation phase

## Quick Start

### Running a Database Investigation

1. **Trigger the skill** by asking questions like:
   - "Investigate why campaigns are stuck in DRAFT status"
   - "Analyze data quality in store-media-api-db"
   - "Find campaigns with missing store assignments"

2. **The agent will**:
   - Create investigation artifact directory
   - Use postgres-mcp-server to query the database
   - Follow the 6-phase investigation framework
   - Generate a structured report

3. **Review outputs** in `.claude/artifacts/<investigation-slug>/`

### Using the Query Reference

Need to quickly check something? Browse [query-reference.md](./query-reference.md) for ready-to-use queries:

```sql
-- Example: Find campaigns without stores
SELECT a.id, a.name, a.status 
FROM activation a
LEFT JOIN store_activation sa ON a.id = sa.activation_id
WHERE sa.id IS NULL AND a.deleted_at IS NULL;
```

## Investigation Phases

The skill follows a structured 6-phase approach:

| Phase | Focus | Output |
|-------|-------|--------|
| **0: Setup** | Create artifact structure | Investigation tracking file |
| **1: Data Structure Discovery** | Row counts, schema validation, FK integrity | Structure findings |
| **2: Lifecycle Analysis** | Campaign progression, state transitions | Lifecycle anomalies |
| **3: Product & Media Integrity** | Product/media completeness | Integrity issues |
| **4: Anomaly Detection** | Temporal, referential, business logic violations | Detected anomalies |
| **5: Data Quality Metrics** | Completeness, consistency, accuracy scores | Quality scorecard |
| **6: Root Cause Analysis** | Hypotheses, RCA, remediation plans | Prioritized recommendations |

## Database Context

### Connection Details
- **Database**: `store-media-api-db-local`
- **Architecture**: Two-level schema architecture
  - **Level 1**: Application schema (`store-media-api`) for routing
  - **Level 2**: Tenant schemas (`apollo`, `tesco_uk`, `foodstuffs`) for data
- **Routing**: API uses `ad_account_id` to determine tenant schema
- **Tool**: Use `postgres-mcp-server` with explicit schema parameter

### Schema Levels

**Application Level** (`store-media-api` schema):
- Routes requests based on `ad_account_id`
- Maps ad accounts to tenant schemas
- Not typically queried during investigations

**Tenant Level** (data schemas):
- `apollo` - Default tenant
- `tesco_uk` - Tesco UK retail
- `foodstuffs` - Foodstuffs retail
- Each contains identical table structure
- Complete data isolation between tenants

### Key Tables
- `activation` - Campaign master records
- `store_activation` - Store assignments (target/control cohorts)
- `product_activation` - Feature products
- `activation_measured_product` - Measurement products
- `store_list_audit_entity` - Change audit log
- `selected_media_element` - Media placements
- `selected_store_element` - Aisle/location reservations

See [SKILL.md](./SKILL.md#core-database-schema) for full schema details.

## Business Logic Quick Reference

### Campaign States
```
DRAFT → (store assignment) → LOCKED → (media selection) → PUBLISHED
```

### Store Evaluation Types
- `0` = Target store (receives campaign)
- `1` = Control store (baseline)
- `NULL` = Unassigned (incomplete)

### Audit Actions
- `0` = Locked
- `1` = Unlocked
- `2` = Amended

### Critical Rules
1. Every activation MUST have >= 1 feature product
2. Target stores MUST have media assignments
3. `start_date` < `end_date`
4. Control stores recommended but optional
5. Halo products != Feature products (distinct sets)

## Example Usage

### Example 1: Quick Data Quality Check
```
User: "Check data quality for apollo schema"

Agent: 
1. Reads store-media-api SKILL
2. Uses completeness query from reference
3. Calculates metrics
4. Returns scorecard
```

### Example 2: Investigate Stuck Campaigns
```
User: "Why are campaigns stuck in DRAFT?"

Agent:
1. Reads store-media-api SKILL
2. Creates investigation artifact
3. Runs Phase 1-2 queries
4. Identifies missing store assignments
5. Generates RCA with remediation
```

### Example 3: Validate Migration
```
User: "Validate data after migration from legacy"

Agent:
1. Runs all 6 investigation phases
2. Compares metrics across schemas
3. Reports anomalies and data quality scores
4. Provides prioritized fix recommendations
```

## Integration with Other Skills

This skill works well with:

- **[sonarqube-issue-fix-workflow](../sonarqube-issue-fix-workflow/)** - Fix code quality issues in API layer
- **[scrum-master](../../.claude/skills/scrum-master/)** - Break down remediation work into tasks
- **[ralph](../ralph/)** - Automate large-scale data cleanup tasks
- **[workflow-qa-validation](../workflow-qa-validation/)** - Validate data integrity as test scenarios

## Best Practices

### ✅ Do
- **Understand routing**: Application uses `ad_account_id` for tenant selection
- **Specify schema explicitly**: Always set schema when querying (apollo/tesco_uk/foodstuffs)
- **Query each tenant separately**: No cross-schema queries—data is isolated
- Filter by `deleted_at IS NULL` for active records
- Document all findings in the investigation template
- Cross-validate across all tenant schemas
- Generate RCAs with specific remediation steps

### ❌ Don't
- **Mix schemas**: Never JOIN across tenant schemas—complete isolation
- **Assume routing**: Direct DB access bypasses application routing layer
- Modify database during investigations (analysis-only)
- Skip phases unless explicitly instructed
- Forget to check referential integrity (within same schema)
- Ignore soft-deleted records in counts
- Make assumptions without data evidence

## Troubleshooting

### Common Issues

**Q: Query returns too many results**  
A: Add `LIMIT 50` and pagination for readability

**Q: Query is slow**  
A: Check for missing indexes, use `EXPLAIN ANALYZE`

**Q: Finding orphaned records**  
A: Use LEFT JOIN pattern to find missing FK targets

**Q: Comparing across schemas**  
A: Run same query in each schema, compile results

## Contributing

To update this skill:

1. **Schema changes**: Update [SKILL.md](./SKILL.md#core-database-schema) table definitions
2. **New queries**: Add to [query-reference.md](./query-reference.md) under appropriate section
3. **Investigation patterns**: Add to [SKILL.md](./SKILL.md#common-investigation-patterns)
4. **Template updates**: Modify [templates/investigation-template.md](./templates/investigation-template.md)

## Support

**Maintained By**: Store Media API Team  
**Last Updated**: 2026-02-13  
**Version**: 1.0

For questions or issues, reference the skill in your query:
```
"Using store-media-api skill, investigate..."
```

---

📚 **Full Documentation**: [SKILL.md](./SKILL.md)  
🏗️ **Architecture Guide**: [architecture-overview.md](./architecture-overview.md)  
🔍 **Query Library**: [query-reference.md](./query-reference.md)  
📋 **Investigation Template**: [templates/investigation-template.md](./templates/investigation-template.md)
