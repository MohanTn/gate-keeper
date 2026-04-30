## Database Investigation Framework

This workflow conducts a comprehensive investigation of the retail media campaign database to systematically identify data anomalies, validate integrity constraints, analyze lifecycle patterns, and produce a detailed root cause analysis with actionable recommendations. This is an analysis-only workflow - no database changes will be made.

> **Note**: This prompt uses the **[store-media-api skill](../skills/store-media-api/)** for comprehensive domain knowledge.
> 
> **Quick Links**:
> - 📚 [Full Skill Documentation](../skills/store-media-api/SKILL.md)
> - 🔍 [SQL Query Reference](../skills/store-media-api/query-reference.md)
> - 📋 [Investigation Template](../skills/store-media-api/templates/investigation-template.md)
> - 💡 [Example Investigation](../skills/store-media-api/examples/example-investigation-campaign-delays.md)

# Input
- Description of the data issue to investigate

# Output file
- Create a new file in `.github/artifacts/<investigation-slug>/investigate-db.md` (relative to current workspace)
- Use the [investigation template](../skills/store-media-api/templates/investigation-template.md) as starting point
- Activate the `store-media-api` skill by referencing it in your query

## Database Context

- **Database**: store-media-api-db-local
- **Architecture**: Two-level multi-tenant schema architecture
  - **Level 1**: Application schema (`store-media-api`) - Routes by `ad_account_id`
  - **Level 2**: Tenant schemas (`apollo`, `tesco_uk`, `foodstuffs`) - Data storage
- **Scope**: Multi-tenant schema analysis (query tenant schemas directly)
- **System**: Campaign activation + store targeting + media placement reservation

### Schema Routing

**Application Level** (`store-media-api` schema):
- Routes API requests based on `ad_account_id` parameter
- Maps ad accounts to appropriate tenant schema
- **Not typically queried during investigations**

**Tenant Level** (data schemas):
- `apollo` - Default tenant (primary)
- `tesco_uk` - Tesco UK retail tenant
- `foodstuffs` - Foodstuffs retail tenant
- Each contains identical table structure
- **Complete data isolation**—no cross-schema queries

**Investigation Pattern**: Query each tenant schema separately using `postgres-mcp-server`

## Key Tables

| Table | Purpose |
|-------|---------|
| `activation` | Campaign master records |
| `store_activation` | Store assignment (evaluation_type: 0=target, 1=control, NULL=unassigned) |
| `activation_measured_product` | Measurement product linkage |
| `product_activation` | Feature product mapping |
| `activation_attribute` | Campaign extended attributes |
| `store_list_audit_entity` | Change log (action: 0=locked, 1=unlocked, 2=amended) |
| `selected_media_element` | Media placement selection |
| `selected_store_element` | Aisle/location spot reservation |

---

# Step 1
- Catalog row counts, column types, constraints, indexes, and FK relationships per table using postgres-mcp-server
- Check for nullable columns that should be non-null, unexpected enum values
- Verify date/timestamp consistency (created_at < updated_at < deleted_at)
- Detect orphaned records, circular references, duplicate PKs
- add Step 1 completed into output file with data structure findings and baseline metrics

# Step 2
- Extract campaign state timelines: creation -> store assignment -> media selection -> publication
- Find: activations with no stores, never-locked drafts, slow progression, high churn
- Validate store assignment: target/control ratios, missing cohorts, NULL assignments
- Analyze audit trail: lock/unlock patterns, amendment abuse, out-of-hours changes
- add Step 2 completed into output file with lifecycle analysis findings and state transition patterns

# Step 3
- Verify every activation has >= 1 feature product
- Check for deactivated products linked to live campaigns
- Validate halo products distinct from feature products
- Verify media elements assigned to all target stores
- add Step 3 completed into output file with product and media integrity findings

# Step 4
- Detect temporal anomalies: end_date < start_date, out-of-sequence timestamps, post-campaign amendments
- Detect referential anomalies: orphaned records, missing external references
- Detect business logic violations: target/control imbalance, budget/store misalignment
- Detect duplication issues: duplicate activations, duplicate store entries, duplicate media assignments
- add Step 4 completed into output file with detected anomalies categorized by type

# Step 5
- Calculate data quality metrics:
  - Completeness: % of activations with all required fields
  - Consistency: Records passing business logic checks
  - Accuracy: Sample validation pass rate
- add Step 5 completed into output file with data quality scorecard

# Step 6
- For each identified issue, provide:
  - Pattern name, affected count, severity, timeline
  - 2-3 hypotheses with probability estimates and evidence
  - Most likely RCA with confidence level
  - Remediation steps and prevention measures
- Present findings as a structured report with executive summary, detailed findings, data quality scorecard, and prioritized recommendations
- add Step 6 completed into output file with root cause analysis and complete the workflow

---

## Query Strategy

1. Start with row counts to establish baseline
2. JOIN queries to find structural issues
3. Deep-dive with statistical queries on problem areas
4. Cross-validate findings across schemas

---

## Resources

For detailed guidance on each phase, database schema, business logic rules, and common query patterns, refer to:

- **[Store Media API Skill](../skills/store-media-api/SKILL.md)** - Complete domain knowledge
- **[Query Reference](../skills/store-media-api/query-reference.md)** - Ready-to-use SQL queries
- **[Investigation Template](../skills/store-media-api/templates/investigation-template.md)** - Structured report format
- **[Example Investigation](../skills/store-media-api/examples/example-investigation-campaign-delays.md)** - Sample output

---

**Maintained By**: Store Media API Team  
**Last Updated**: 2026-02-13
