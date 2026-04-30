## Merge Request Code Review

This workflow performs a comprehensive code review of a merge request by gathering context from GitLab and Jira, analyzing code changes against coding standards and acceptance criteria, and producing a structured findings report. This is a review-only workflow - no code changes will be made.

# Input
- GitLab Project ID and MR IID (e.g., "project-id 123")

# Output file
- Create a new file in `.github/artifacts/<project-id>-<mr-iid>/review-mr.md` (relative to current workspace)

# Step 1
- Fetch MR metadata from gitlab-mcp-server: title, author, branches, description
- Fetch full diffs for all changed files using get_merge_request_detailed_diff
- Fetch related pipelines and job logs (build/test results)
- Fetch MR comments, discussions, and approval status using get_merge_request_notes
- add Step 1 completed into output file with MR context overview and metadata summary

# Step 2
- Extract Jira ticket key from MR description or branch name
- Fetch Jira issue details using jira-mcp-server: acceptance criteria, test scenarios, requirements
- Download any attached design specs or requirements docs
- add Step 2 completed into output file with Jira context and AC mapping

# Step 3
- For each changed file:
  - Detect the language from file extension
  - Load the relevant coding standards from instruction files (.NET or React sections)
  - Check compliance with coding standards
  - Map changes to Jira acceptance criteria - note coverage and gaps
  - Check for:
    - Architecture: Correct layer placement, pattern adherence
    - Security: Input validation, SQL injection, XSS, secrets exposure
    - Performance: N+1 queries, missing pagination, unnecessary re-renders
    - Testing: Missing tests, untested edge cases
    - Language-specific: Import order, naming conventions, type safety
- add Step 3 completed into output file with code analysis findings per file

# Step 4
- Present findings grouped by severity (Critical / High / Medium / Low)
- For each issue provide:
  - Location: file:line
  - Severity: Critical / High / Medium / Low
  - Category: Security, Architecture, Performance, Standards, Testing
  - Description: What the issue is and why it matters
  - Current code: Short snippet
  - Recommendation: How to fix it
  - Fixed code: Short snippet showing the fix
- Include:
  - AC coverage assessment (which criteria are met, which have gaps)
  - Overall code quality assessment
  - MR readiness: ready to merge, needs changes, or needs discussion
- add Step 4 completed into output file with findings summary and complete the workflow
