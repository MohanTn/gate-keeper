## SonarQube Issue Fix Workflow

This workflow automates SonarQube issue discovery and remediation, systematically addressing code quality issues through a structured fix-and-validate cycle. The workflow produces a feature branch with validated fixes, comprehensive test coverage, a merge request, and before/after quality metrics.

**Important Guidelines:**
- Use existing scripts from `.github/skills/sonarqube-issue-fix-workflow/` - do NOT create duplicate scripts
- Focus effort on fixing actual source code issues, not building tooling
- Write tests for code fixes (not the tooling)

# Input
- Repository root path (defaults to current directory)

# Output file
- Create a new file in `.github/artifacts/sonarqube-fixes/fix-sonarqube.md` (relative to current workspace)

# Step 1
Prerequisites: Docker running, port 9000 available, ~2-4GB disk space
- Run setup script from the skill folder:
  - Linux: `.github/skills/sonarqube-issue-fix-workflow/scripts/sonarqube-setup.sh`
  - Windows: `.github/skills/sonarqube-issue-fix-workflow/scripts/sonarqube-setup.ps1`
- Wait for SonarQube to be ready at `http://localhost:9000`
- Save credentials to `.env.local`
- add Step 1 completed into output file with SonarQube setup status and credentials confirmation

# Step 2
- Detect languages using: `.github/skills/sonarqube-issue-fix-workflow/utils/detect-languages.js`
- Run the Docker-based scan script: `.github/skills/sonarqube-issue-fix-workflow/scripts/sonarqube-scan.sh`
  - This generates `sonar-project.properties`, runs `sonar-scanner` via Docker on the `sonarqube-network`, polls for completion, and saves results to `.github/artifacts/sonarqube-campaign-*/issues.json`
- add Step 2 completed into output file with scan results and detected issues count

# Step 3
- Fetch issues using: `.github/skills/sonarqube-issue-fix-workflow/utils/sonarqube-api-client.js`
- Query `/api/issues/search` for CRITICAL and HIGH severity
- Categorize by severity, type, file, and rule
- add Step 3 completed into output file with categorized issues breakdown

# Step 4
- Group issues into tasks using: `.github/skills/sonarqube-issue-fix-workflow/utils/issue-grouper.js`
  - CRITICAL: 1 task per issue
  - HIGH: 2-3 issues per task
- Estimate sizes (Simple, Medium, Complex)
- Present task summary to user and wait for explicit approval (APPROVAL GATE)
- add Step 4 completed into output file with generated tasks and user approval confirmation

# Step 5
- For each task execute the following sub-steps in sequence:
  # Step 5.1
  - Switch to Role `developer`
  - Fix actual source code issues (not scripts/utilities)
  - Write unit tests covering fixes (>= 85% coverage)
  - Commit with descriptive messages
  - add Step 5.1 completed into output file with implementation summary and test coverage
  
  # Step 5.2
  - Switch to Role `qa`
  - Validate fixes and run integration tests
  - Re-run SonarQube scan to confirm resolution
  - If issues found: request changes and return to Step 5.1 (max 3 iterations)
  - If approved: mark task complete
  - add Step 5.2 completed into output file with QA validation results

# Step 6
- Verify all tasks complete
- Push feature branch
- Create MR with metrics and task summary using gitlab-mcp-server
- add Step 6 completed into output file with MR details and branch information

# Step 7
- Run final SonarQube scan
- Compare before/after metrics using: `.github/skills/sonarqube-issue-fix-workflow/utils/metrics-reporter.js`
- add Step 7 completed into output file with before/after metrics comparison

# Step 8
- Verify all CRITICAL and HIGH issues resolved
- Verify test coverage >= 85%
- Confirm MR is ready for review
- Run cleanup: `.github/skills/sonarqube-issue-fix-workflow/scripts/sonarqube-cleanup.sh --all`
  - Removes Docker containers, volumes, network, and generated files (.env.local, sonar-project.properties, .scannerwork/)
- add Step 8 completed into output file with final validation results and complete the workflow
