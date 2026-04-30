## Refine Feature Ticket / PRD

This workflow refines a feature ticket by gathering context, analyzing attachments, clarifying ambiguities, generating SMART acceptance criteria and test scenarios, and updating the Jira ticket. This is a refinement-only workflow - no code changes will be made.

# Input
- Jira Ticket Key or feature description

# Output file
- Create a new file in `.github/artifacts/<JiraTicketKey>/refine-ticket.md` (relative to current workspace)

# Step 1
- If Jira ticket key provided: fetch full issue details via jira-mcp-server using get_issue tool
- Download all attachments using mcp_jira-mcp-serv_download_attachments and save inside `.github/artifacts/<JiraTicketKey>/artifacts`
- Search the codebase for related services, components, APIs, data models
- Query database schemas if applicable using postgres-mcp-server
- Determine scope: feature enhancement, bug fix, or refinement
- add Step 1 completed into output file with the gathered context and scope

# Step 2
- For each attachment analyze:
  - Excel files: Extract columns, list items, data patterns
  - Images/designs: Extract design elements, component structure using Figma tools if applicable
  - Documents: Extract objectives, business rules, requirements
- Summarize key information from all attachments
- add Step 2 completed into output file with attachment analysis summary

# Step 3
- Identify ambiguous or incomplete requirements from Steps 1-2
- Do NOT ask about information already visible in attachments
- Present specific clarifying questions to the user
- Wait for user answers before proceeding
- add Step 3 completed into output file with the clarifications and user responses

# Step 4
- Create 3-5 SMART acceptance criteria:
  - Specific: No vague language
  - Measurable: Quantifiable outcomes
  - Achievable: Technically feasible
  - Relevant: Tied to the feature objective
  - Testable: Can be verified with a test
- Cover: happy path, edge cases, exceptions, and database changes if applicable
- Write each criterion as a clear, complete sentence in plain English
- add Step 4 completed into output file with the generated acceptance criteria

# Step 5
- Create test scenarios with 1:1+ mapping to acceptance criteria
- For each scenario: clear preconditions and expected results as complete sentences
- Include happy path, edge cases, error conditions
- Ensure all scenarios are specific and repeatable
- add Step 5 completed into output file with the generated test scenarios

# Step 6
- Combine all acceptance criteria into a single text block
- Combine all test scenarios into a single text block
- Update the Jira ticket using mcp_jira-mcp-serv_update_issue
- Verify the update succeeded by re-fetching the issue
- Present the final AC and test scenarios to the user
- add Step 6 completed into output file with the Jira update status and complete the workflow