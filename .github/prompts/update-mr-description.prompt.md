## Update MR Description

This workflow generates and updates a comprehensive merge request description in GitLab by fetching context from GitLab and Jira, analyzing code impact, and creating a structured description with 6 mandatory sections covering problem statement, solution, changes, testing, impact, and deployment notes.

# Input
- GitLab Project ID and MR IID (e.g., "project-id 123")

# Output file
- Create a new file in `.github/artifacts/<project-id>-<mr-iid>/update-mr.md` (relative to current workspace)

# Step 1
- Fetch MR metadata from gitlab-mcp-server (title, branches, current description)
- Fetch all code diffs and commits in the MR using get_merge_request_detailed_diff
- Extract Jira ticket key from description or branch name
- Fetch Jira ticket details using jira-mcp-server: summary, description, acceptance criteria, priority
- add Step 1 completed into output file with fetched context and Jira details

# Step 2
- Identify affected services, modules, and components from the code diffs
- Extract commit messages documenting core logic changes
- Identify breaking changes, migrations, and new dependencies
- add Step 2 completed into output file with impact analysis and affected components

# Step 3
- Create the MR description with these 6 mandatory sections:
  1. Problem Statement: Why this MR is needed (specific, clear)
  2. Solution Overview: What was done and how it solves the problem
  3. Code Changes Summary: Files modified, lines changed, core logic changes
  4. Testing & Validation: Tests run, scenarios verified, results including:
     - Common checklist: app startup, migrations, tenancy, permissions, CRUD, isolation, outbox, unit/functional tests, SonarQube, regressions
     - MR-specific checklist: endpoint verification, edge cases, API contracts, performance, logs, AC coverage
  5. Impact & Risk: Affected services, breaking changes, compatibility concerns
  6. Deployment Notes: Steps, rollback plan, requirements
- add Step 3 completed into output file with generated description

# Step 4
- Update the MR description using gitlab-mcp-server update_merge_request_description_with_summary tool
- Verify the update was applied by re-fetching the MR
- Confirm all 6 sections are present in the updated description
- Present the result to the user
- add Step 4 completed into output file with update confirmation and complete the workflow
