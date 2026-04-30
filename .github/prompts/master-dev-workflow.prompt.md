## master development workflow

Here you will execute a carefully orchestrated workflow by following the steps exactly as outlined below. This workflow is designed to ensure a comprehensive and structured approach to feature development, from gathering requirements to implementing code changes. Each stage builds upon the previous one, so it is critical to follow the sequence and complete each step thoroughly before moving on to the next.

# Input
- Jira Ticket Key (e.g., PROJ-1234)

# Output file
- Create a new file in `.github/artifacts/<JiraTicketKey>/dev-workflow.md` (relative to current workspace)

# Step 1
- using jira-mcp-server 'get_issue' tool, gather the following details about the ticket:
  - objective
  - acceptance criteria (need 3+)
  - dependencies
  - blockers
  - priority
  - attachments (download all to `.github/artifacts/<JiraTicketKey>/attachments`)
- add Step 1 completed into output file with the gathered details

# Step 2
- analyze all attachments for design specs, data structures, and requirements
- validate each acceptance criterion is testable, measurable, and specific
- add Step 2 completed into output file with analysis summary

# Step 3
- search the codebase for related services, components, and existing patterns
- identify relevant repositories, services, controllers, and middleware
- query DB schemas if applicable: tables, foreign keys, constraints using postgres-mcp-server and its tools
- document architecture decisions and design patterns to follow
- add Step 3 completed into output file with codebase investigation findings

# Step 4
- Break feature into 5-8 discrete tasks and generate a task tracking file in `.github/artifacts/<JiraTicketKey>/task.json` using the `.github/prompts/templates/task-breakdown.md` template.  
- Document each task with clear descriptions in the tracking file
- add Step 4 completed into output file with task breakdown and descriptions

# Step 5
- Create a feature branch: `git checkout -b feature/<JiraTicketKey>/description`
- add Step 5 completed into output file with branch name and initial commit message

# Step 6 
- foreach task '$TASK' in `.github/artifacts/<JiraTicketKey>/task.json` which is not in status "Done" and lowest orderOfExecution, execute the following sub-steps:
  # Step 6.1
  - Switch to Role `developer` and implement the feature according to the tasks defined in Step 4
  - Pick the '$TASK' from `.github/artifacts/<JiraTicketKey>/task.json` which is 'ToDo' or 'NeedsChanges'
  - Update '$TASK'.status = "InProgress"
  - Ensure code adheres to established design patterns and architecture decisions
  - Add comprehensive unit and integration tests to validate functionality against acceptance criteria
  - Update '$TASK'.status = "InReview" and add transition record:
    - '$TASK'.transitions.add({
      "from": "InProgress",
      "to": "InReview",
      "actor": "developer",
      "timestamp": "<current_timestamp>",
      "developerNotes": "<implementation_summary>",
      "filesChanges": ["<list_of_modified_files>"],
      "testFiles": ["<list_of_test_files_created_or_modified>"]
    })
  - add Step 6.1 completed into output file with implementation summary and test coverage details

  # Step 6.2
  - Switch to Role `reviewer` 
  - Pick the task from `.github/artifacts/<JiraTicketKey>/task.json` which is in status "InReview"
  - Perform comprehensive code review against acceptance criteria and design patterns
  - If feedback required: update transition and set status to "NeedsChanges":
    - Update existing InReview transition or add new NeedsChanges transition:
      "from": "InReview",
      "to": "NeedsChanges",
      "actor": "reviewer",
      "timestamp": "<current_timestamp>",
      "reviewerNotes": "<feedback_and_required_changes>"
    - Return task to developer and exit Step 6.2
  - If all tests pass and code meets standards: update transition and set status to "InQA":
    - '$TASK'.transitions.add({
      "from": "InReview",
      "to": "InQA",
      "actor": "reviewer",
      "timestamp": "<current_timestamp>",
      "reviewerNotes": "<approval_summary>",
      "qaSignOff": "approved_for_qa",
      "testResultsSummary": "<test_results_and_coverage_metrics>"
    })
  - add Step 6.2 completed into output file with code review summary

  # Step 6.3
  - Switch to Role `qa`
  - Pick the task from `.github/artifacts/<JiraTicketKey>/task.json` which is in status "InQA"
  - Perform thorough testing against all acceptance criteria and test scenarios
  - For each acceptance criterion: verify and set verified = true
  - If acceptance criteria not met: update transition and set status to "NeedsChanges":
    - '$TASK'.transitions.add({
      "from": "InQA",
      "to": "NeedsChanges",
      "actor": "qa",
      "timestamp": "<current_timestamp>",
      "qaNotes": "<issues_found_and_required_fixes>"
    })
    - Return task to developer and exit Step 6.3
  - If all acceptance criteria met: update transition and set status to "Done":
    - '$TASK'.transitions.add({
      "from": "InQA",
      "to": "Done",
      "actor": "qa",
      "timestamp": "<current_timestamp>",
      "qaNotes": "<qa_sign_off_and_findings>",
      "deploymentReadiness": "ready_for_production",
      "acceptanceCriteriaMet": true
    })
  - add Step 6.3 completed into output file with QA testing summary

  # Step 6.4
  - Review task completion: verify all tasks in `.github/artifacts/<JiraTicketKey>/task.json` have status "Done"
  - Create a Pull Request with comprehensive description linking to Jira ticket
  - Ensure all CI/CD checks pass and code coverage meets minimum thresholds
  - Merge feature branch to development branch upon approval
  - add Step 6.4 completed into output file with PR details and merge confirmation

  # Step 6.5
  - Commit the changes file with a single line comment as summary in this pattern `feature/<JiraTicketKey>: summary of changes`
  - add Step 6.5 completed into output file with commit message and summary of changes

# Step 7
- Verify all the tasks in `.github/artifacts/<JiraTicketKey>/task.json` have status "Done"
- Generate a details MR description linking to the Jira ticket and summarizing the changes made, test coverage, and deployment readiness
- Complete the workflow.
