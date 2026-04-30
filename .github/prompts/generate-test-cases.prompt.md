## Generate Test Cases for MR

This workflow generates comprehensive test cases for code changes in a merge request by analyzing the MR details, investigating code impact, and creating categorized test scenarios. The workflow produces a structured report with smoke tests, impacted area tests, and regression tests.

# Input
- GitLab MR link or "project-id mr-iid"

# Output file
- Create a new file in `.github/artifacts/<project-id>-<mr-iid>/generate-tests.md` (relative to current workspace)

# Step 1
- Fetch MR details and code diffs from GitLab MCP server using gitlab-mcp-server tools
- Extract Jira ticket key if available; fetch Jira details for acceptance criteria using jira-mcp-server
- Verify the current branch matches the MR branch (alert user if mismatch)
- add Step 1 completed into output file with MR analysis findings and Jira context

# Step 2
- Analyze all changed files and their impact
- Gather context from impacted code, neighboring areas, and related modules
- Identify the scope: which features, APIs, components are affected
- Check if database schemas are impacted using postgres-mcp-server if applicable
- add Step 2 completed into output file with code impact analysis and affected components

# Step 3
- Categorize test cases into Priority Smoke Tests, Impacted Areas, and Neighboring Areas
- For each test case provide:
  - ID: TC-001, TC-002, etc.
  - Category: Smoke / Impacted / Neighboring
  - Priority: P1 (Critical) / P2 (High) / P3 (Medium)
  - Description: What is being tested
  - Preconditions: Setup required
  - Steps: Numbered step-by-step actions
  - Expected Result: What should happen
  - Notes: Special considerations
- For UI changes: include detailed step-by-step flow with page navigation
- For .NET API changes: include Swagger URL, request payload, expected response
- add Step 3 completed into output file with all generated test cases categorized by priority

# Step 4
- Summarize as a user-friendly report with categories, priorities, and tester notes
- Include test execution recommendations and coverage assessment
- add Step 4 completed into output file with final report and complete the workflow
