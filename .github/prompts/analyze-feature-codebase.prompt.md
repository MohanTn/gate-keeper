## Feature Codebase Analysis

This is a research-focused workflow designed to analyze the existing codebase and understand how to implement a new feature. The workflow systematically decomposes the feature, searches for existing patterns, analyzes design patterns and data flow, identifies gaps, and provides actionable recommendations. This is a research task - do NOT write any code changes.

# Input
- Feature statement (e.g., "Add user authentication with OAuth")

# Output file
- Create a new file in `.github/artifacts/<feature-slug>/analyze-codebase.md` (relative to current workspace)

# Step 1
- Parse the feature statement into core components: UI layer, API layer, business logic, data layer, integration points
- Identify data models, entities, and architectural patterns involved
- Generate search hypotheses for codebase exploration
- add Step 1 completed into output file with feature decomposition and core components

# Step 2
- Search for: domain services, repositories, API endpoints, data models, middleware, validators
- Search for: existing similar features, configuration constants, test fixtures, UI components
- For each discovery: note file path, purpose, patterns, dependencies
- Identify architecture layers: controller -> service -> repository
- Map cross-reference dependencies
- Query database schemas if applicable using postgres-mcp-server
- add Step 2 completed into output file with discovered patterns and files

# Step 3
- Document identified layers: presentation, API/controller, service, data access, infrastructure
- Identify design patterns: repository, service layer, middleware, DI, error handling, validation
- Trace request flow from entry point through layers
- Map data transformations, async operations, caching strategies
- Document naming conventions and code organization
- add Step 3 completed into output file with design patterns and data flow analysis

# Step 4
- Compare feature components with codebase: fully implemented, partially implemented, missing
- Document what exists, what needs creation, what needs enhancement, what can be reused
- Map implementation patterns to follow (with code examples from codebase)
- Assess risk areas: complexity, dependencies, backward compatibility
- add Step 4 completed into output file with identified gaps and implementation approach

# Step 5
- For each identified component document:
  - Implementation approach: create new, modify existing, or reuse
  - Code patterns and examples from the existing codebase
  - Configuration requirements (env vars, config files, migrations)
  - Testing strategy: unit tests, integration tests, edge cases
  - Technical risks with probability and mitigation
- Present findings as a structured analysis report
- add Step 5 completed into output file with final recommendations and complete the workflow
