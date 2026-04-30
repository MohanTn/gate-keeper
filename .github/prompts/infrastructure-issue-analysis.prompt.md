## Infrastructure Issue Analysis

This workflow investigates infrastructure issues using available MCP servers to collect data from multiple systems, analyze patterns, construct event timelines, and produce a comprehensive root cause analysis with actionable recommendations. This is an analysis-only workflow - no code or infrastructure changes will be made.

# Input
- Description of the infrastructure issue

# Output file
- Create a new file in `.github/artifacts/<issue-slug>/infra-analysis.md` (relative to current workspace)

# Step 1
- Determine which systems are involved: GCloud, NewRelic, GitLab, PostgreSQL
- Use available MCP servers to collect data:
  - GitLab: Merge requests, pipelines, job logs using gitlab-mcp-server
  - NewRelic: APM entities, NRQL queries, NerdGraph queries using newrelic-mcp-server
  - GCloud: Kubernetes pod logs, cluster configs using gcloud-mcp-server
  - PostgreSQL: Database queries for data integrity checks using postgres-mcp-server
- Identify the timeline and scope of the issue
- add Step 1 completed into output file with gathered context and affected systems

# Step 2
- Break the investigation into actionable tasks
- Present the investigation plan to the user for review and approval
- Adjust based on user feedback
- add Step 2 completed into output file with investigation plan and user-approved scope

# Step 3
- Execute the investigation plan using MCP tools
- Fetch relevant logs, metrics, and configurations from all identified systems
- Query databases for anomalies and data integrity issues
- Check deployment history and recent changes
- Correlate events across systems to identify patterns
- add Step 3 completed into output file with collected data summary and key findings

# Step 4
- Identify patterns, anomalies, and correlations in the collected data
- Construct a detailed timeline of events
- Identify gaps or missing information (ask user for clarification if needed)
- add Step 4 completed into output file with event timeline and analysis

# Step 5
- Identify the root cause based on evidence from all data sources
- Provide actionable recommendations prioritized by impact:
  - Immediate fix actions
  - Process improvements
  - Monitoring/alerting additions
  - Preventive measures
- Compare before/after metrics if applicable
- Present findings as a structured report with executive summary, timeline, root cause, and recommendations
- add Step 5 completed into output file with root cause analysis and complete the workflow
