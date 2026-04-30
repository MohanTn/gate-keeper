# Store Media API Skill - Setup Guide

## Quick Setup (Copy to Store Media API Repo)

### Step 1: Copy Skill Directory

Copy the entire skill directory to your store-media-api repository:

```bash
# From dh-mcp-server repo
cd /path/to/store-media-api-repo

# Copy the skill directory
cp -r /home/dh211371/REPO/Media/RetailMediaPortal/instore/dh-mcp-server/.github/skills/store-media-api \
     .github/skills/store-media-api
```

### Step 2: Verify Structure

Ensure the following structure exists in your store-media-api repo:

```
store-media-api/
├── .github/
│   └── skills/
│       └── store-media-api/
│           ├── SKILL.md                          # Main skill definition (REQUIRED)
│           ├── README.md                         # Overview and guide
│           ├── architecture-overview.md           # Architecture details
│           ├── query-reference.md                # SQL query library
│           ├── VERIFICATION-REPORT.md            # Database verification
│           ├── templates/
│           │   └── investigation-template.md     # Investigation template
│           └── examples/
│               └── example-investigation-campaign-delays.md
```

### Step 3: That's It! ✅

The skill is now automatically available in your store-media-api repo. No configuration needed.

---

## How It Works

### Automatic Detection

GitHub Copilot automatically:
1. Scans `.github/skills/*/SKILL.md` files
2. Reads the YAML frontmatter (name + description)
3. Makes the skill available in the workspace context

### YAML Frontmatter (Required)

Your `SKILL.md` must have this at the top:

```yaml
---
name: store-media-api
description: Comprehensive domain knowledge for Store Media API system including database schema, campaign lifecycle, data integrity rules, and investigation frameworks for retail media campaign database analysis and troubleshooting.
---
```

### Skill Activation

The skill is automatically activated when:
- You mention domain-specific terms: "activation", "campaign", "store assignment", etc.
- You explicitly reference it: "Using the store-media-api skill, investigate..."
- You use related workflows/prompts

---

## Usage in Workflows

### Option 1: Direct Reference

```markdown
Using the store-media-api skill, investigate why campaigns are stuck in DRAFT status.
```

### Option 2: Implicit Activation

```markdown
Analyze data quality in the apollo schema for campaign activations.
```

The AI will automatically load the skill based on context.

### Option 3: In Prompts/Instructions

Create a `.github/prompts/` directory with workflow prompts that reference the skill:

```markdown
# .github/prompts/investigate-database.prompt.md

> **Note**: This prompt uses the **store-media-api skill** for domain knowledge.

**Input:** Description of the data issue to investigate
...
```

---

## Integration with Other Tools

### Works Seamlessly With:

1. **postgres-mcp-server**: Query database with skill's query patterns
   ```
   SET search_path TO apollo;
   SELECT * FROM activation WHERE is_deleted = false;
   ```

2. **Investigation Templates**: Use pre-built templates
   ```
   cp .github/skills/store-media-api/templates/investigation-template.md \
      .claude/artifacts/my-investigation/investigate-db.md
   ```

3. **Query Reference**: Quick SQL lookup
   ```
   Reference: .github/skills/store-media-api/query-reference.md
   ```

---

## Testing the Skill

### Test 1: Check Skill is Loaded

Ask Copilot:
```
What skills are available in this workspace?
```

You should see `store-media-api` listed.

### Test 2: Ask Domain Question

```
What are the business rules for store evaluation types in store-media-api?
```

Copilot should reference the skill and provide accurate information.

### Test 3: Run Investigation

```
Using store-media-api skill, analyze campaigns in apollo schema that have no store assignments.
```

Copilot should:
- Load the skill
- Use postgres-mcp-server
- Query with correct column names (`activation_id`, `is_deleted`, etc.)
- Follow investigation framework

---

## Customization for Your Repo

### Update Database Context (if needed)

If your store-media-api repo has different database connection details:

1. Edit `SKILL.md`:
   ```yaml
   ### Database Configuration
   - **Database**: your-database-name
   - **Host**: your-host
   ```

2. Update `query-reference.md` with your connection strings

### Add Repo-Specific Queries

Add your common queries to `query-reference.md`:

```sql
-- Your custom query
SELECT ...
FROM activation a
JOIN your_custom_table t ON ...
```

### Add Repo-Specific Examples

Add examples to `examples/` directory:
```
examples/
├── example-investigation-campaign-delays.md (existing)
└── example-your-use-case.md (new)
```

---

## Multi-Repo Strategy

### Shared Skills (Current Setup)

Keep skills in `dh-mcp-server` repo and reference across projects:
- ✅ Single source of truth
- ✅ Easy to update centrally
- ❌ Requires path awareness

### Per-Repo Skills (Recommended for Store Media API)

Copy skill to each repo that needs it:
- ✅ Self-contained - works anywhere
- ✅ Repo-specific customization
- ✅ No cross-repo dependencies
- ❌ Must sync updates manually

**Recommendation**: Copy to store-media-api repo for self-containment.

---

## Maintenance

### Updating the Skill

When database schema changes:

1. Update `SKILL.md` core table definitions
2. Update `query-reference.md` with new queries
3. Run verification queries to confirm accuracy
4. Update `VERIFICATION-REPORT.md` with findings

### Version Control

Consider adding version to frontmatter:

```yaml
---
name: store-media-api
version: 1.1.0
description: ...
last_updated: 2026-02-13
---
```

### Documentation

Keep `README.md` updated with:
- Latest usage examples
- New query patterns
- Common troubleshooting

---

## Troubleshooting

### Skill Not Loading

**Symptom**: Copilot doesn't recognize domain terms

**Solution**:
1. Verify YAML frontmatter exists in `SKILL.md`
2. Check file is in `.github/skills/store-media-api/SKILL.md`
3. Restart Copilot workspace
4. Explicitly reference: "Using store-media-api skill..."

### Incorrect Information

**Symptom**: Skill provides wrong column names

**Solution**:
1. Verify database with postgres-mcp-server
2. Update `SKILL.md` with correct schema
3. Update `VERIFICATION-REPORT.md`
4. Clear Copilot cache (restart)

### Query Patterns Don't Work

**Symptom**: SQL queries fail

**Solution**:
1. Check actual schema: `\d+ apollo.activation`
2. Verify column names match documentation
3. Update `query-reference.md`
4. Test queries manually first

---

## Advanced Usage

### Combine Multiple Skills

Create workflows that use multiple skills together:

```markdown
Using store-media-api and sonarqube-issue-fix-workflow skills:
1. Investigate database issues
2. Generate tasks for code fixes
3. Validate with QA workflow
```

### Create Domain-Specific Prompts

```
.github/prompts/
├── investigate-database.prompt.md    # Uses store-media-api
├── campaign-lifecycle-analysis.prompt.md
└── data-quality-audit.prompt.md
```

### Build Automation Scripts

Reference skill in scripts:

```bash
#!/bin/bash
# run-investigation.sh

echo "Running database investigation using store-media-api skill..."
copilot submit "Using store-media-api skill, investigate $1"
```

---

## Benefits of This Setup

### ✅ Portability
- Copy skill to any repo, works immediately
- No configuration needed
- Self-contained documentation

### ✅ Consistency
- Same database knowledge across all repos
- Standardized query patterns
- Consistent investigation workflows

### ✅ Maintainability
- Single `SKILL.md` file to update
- Version controlled with your code
- Easy to review changes

### ✅ Discoverability
- Developers can read `README.md`
- Query reference provides quick lookups
- Examples show best practices

---

## Next Steps

1. ✅ Copy skill to store-media-api repo
2. ⏳ Test with simple domain question
3. ⏳ Run sample investigation workflow
4. ⏳ Customize for your specific needs
5. ⏳ Train team on skill usage

---

## Support

**Questions?** Check:
- [SKILL.md](./SKILL.md) - Full domain knowledge
- [README.md](./README.md) - Quick reference
- [query-reference.md](./query-reference.md) - SQL patterns
- [architecture-overview.md](./architecture-overview.md) - Schema details

**Issues?** Verify:
- Database connection (postgres-mcp-server working)
- Schema structure (matches SKILL.md)
- Column names (use VERIFICATION-REPORT.md)

---

**Last Updated**: 2026-02-13  
**Maintained By**: Store Media API Team  
**License**: MIT (or your license)
