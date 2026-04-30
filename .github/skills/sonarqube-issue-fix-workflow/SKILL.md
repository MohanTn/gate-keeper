---
name: sonarqube-issue-fix-workflow
description: "Automated SonarQube issue discovery, task generation, and persona-based remediation workflow. Orchestrates local SonarQube Docker setup, scans codebase, generates right-sized tasks, and guides Developer/QA personas through fix-and-validate loop until all critical issues resolved."
---

# SonarQube Issue Fix Workflow Skill

Comprehensive workflow for discovering, prioritizing, and fixing SonarQube code quality issues through an orchestrated multi-stage process with Developer/QA personas and approval gates.

---

## The Problem

Code quality issues accumulate but fixing them is tedious:
- Many issues found, unclear priority
- No clear remediation path
- Easy to miss edge cases during fixes
- No verification that fixes actually resolve issues
- Manual QA is slow and error-prone

**Solution:** Automated workflow that finds issues → groups them into right-sized tasks → guides Developer to fix → guides QA to verify → iterates until all CRITICAL issues resolved.

---

## What This Skill Does

### **5-Phase Workflow**

1. **Setup** - Launch ephemeral SonarQube Docker instance locally
2. **Scan** - Auto-detect languages, run scan, fetch issues via REST API
3. **Analyze** - Categorize issues by severity/type, group into tasks
4. **Remediate** - Developer subagent fixes issues, QA subagent validates, iterate on failures
5. **Report** - Before/after metrics, audit trail, create MR

### **Key Features**

- **Auto-detect languages**: Analyzes repo structure for Java, TypeScript, Python, Go, C#, etc.
- **Smart grouping**: Converts 50+ issues into 5-8 manageable tasks
- **Persona-based**: Developer writes tests then code; QA verifies via re-scan + integration tests
- **Approval gates**: User reviews task.json before development starts
- **Feedback loops**: If QA rejects fix, Developer re-iterates automatically
- **Ephemeral infrastructure**: Docker instance destroyed after workflow completes (clean state)
- **Configurable scope**: Default CRITICAL+HIGH, can extend to MEDIUM/LOW if desired

---

## When to Use This Skill

**Use when:**
- You have a codebase with SonarQube findings you want to systematically fix
- You want CRITICAL and HIGH severity issues resolved first
- You want quality verification (tests + QA validation) alongside fixes
- You want before/after metrics to track progress
- You're working locally (no CI/CD integration needed)

**Don't use when:**
- You only care about static analysis reports (no actual fixes needed)
- You want to integrate with external CI/CD systems
- You need Jira ticket creation/tracking

---

## How It Works (High-Level)

```
[Phase 1: Setup]
  ↓ Run setup scripts (Linux/Windows)
  ↓ Launch SonarQube Docker + PostgreSQL
  ↓ Output: connection credentials

[Phase 2: Scan]
  ↓ Auto-detect project languages
  ↓ Configure sonar-project.properties
  ↓ Run sonar-scanner
  ↓ Fetch issues via REST API
  ↓ Output: issues.json with all findings

[Phase 3: Analyze]
  ↓ Group issues by severity (CRITICAL → HIGH → MEDIUM)
  ↓ Right-size into tasks (simple, medium, complex)
  ↓ Create task.json with acceptance criteria
  ↓ Output: task.json ready for user approval

[APPROVAL GATE: User reviews & approves task.json]

[Phase 4: Remediate Loop]
  For each task in task.json:
    ↓ Developer Subagent:
      ├─ Write unit tests (test-first)
      ├─ Implement fixes following SonarQube rules
      ├─ Commit with feat/fix message
      └─ Mark task "Ready For QA"
    ↓ QA Subagent:
      ├─ Re-run SonarQube scan on changed files
      ├─ Verify issue marked RESOLVED
      ├─ Create integration tests (happy path + edge cases)
      ├─ Run full test suite
      └─ Approve "Done" OR reject "Need Changes"
    If rejected → Developer re-iterates (go back to Developer step)

[Phase 5: Report]
  ↓ Run final SonarQube scan
  ↓ Generate before/after metrics
  ↓ Create MR with issue links & metrics
  ↓ Audit trail: all commits, test coverage, issues resolved
```

---

## Detailed Component Breakdown

### **Phase 1: Setup Scripts**

**Linux** (`sonarqube-setup.sh`)
- Checks Docker is installed & running
- Pulls SonarQube image (10.3-community recommended, latest available as fallback)
- Creates Docker network, volumes, env vars
- Launches SonarQube + PostgreSQL 15
- Waits for health check (loop until responsive, max 60s for SonarQube, 30s for PG)
- Outputs: `SONARQUBE_URL`, `SONARQUBE_TOKEN`, credentials to `.env.local`
- Duration: 60-90 seconds (includes database initialization)
- **Improvement**: Added detailed logs with timestamps, setup.log file for debugging
- **Error Handling**: Recovers from interrupted containers by checking/restarting existing ones
- **Port Management**: Auto-detects if port 9000 in use, increments to find available port

**Windows** (`sonarqube-setup.ps1`)
- Same logic, PowerShell syntax
- Checks Docker Desktop running (not just Docker CLI)
- Creates Docker resources via PowerShell native commands
- Outputs credentials to `.env.local`
- **Improvement**: Added equivalent error handling and port detection

**Common Behavior:**
- **Idempotent**: Safe to run multiple times (detects and reuses existing containers)
- **Resilient**: Survives network interruptions during health checks
- Uses docker-compose.yml from templates/ (optional, can use pure docker run)
- Data stored in named Docker volumes (labeled for cleanup: `sonarqube-db-volume`, `sonarqube-data-volume`)
- Generates unique project key: `repo-name-timestamp` for each scan
- **Credential Management**: Token name includes timestamp to prevent duplicates on re-runs
- **Verification**: Curl health check polls `/api/system/status` endpoint for readiness

---

### **Phase 2: Scan & Discovery**

**Language Auto-Detection** (`detect-languages.js`)
- Scans file extensions: `.js`, `.ts`, `.java`, `.py`, `.go`, `.cs`, `.sql`, `.rb`, `.sh`
- Checks for `package.json`, `pom.xml`, `go.mod`, `requirements.txt`, `Gemfile`, `*.sln`, etc.
- Maps to SonarQube language plugins with version compatibility checks
- Auto-enables rules for each language (respects project's existing rule sets)
- **Improvement**: Detects multi-language projects accurately (e.g., C# backend + Python scripts)

**SonarQube Scanner** (`sonarqube-scan.sh`)
- Configures `sonar-project.properties` with detected languages
- Runs `sonar-scanner` CLI with timeout protection (default 15min, configurable)
- Polls `/api/ce/activity` with exponential backoff (1s → 5s intervals) until scan completes
- Checks quality gate result (PASS/FAIL/WARN)
- Saves scan report to `.sonarqube/scan-report.json`
- **Improvement**: Better error messages for scan failures; retries on transient network errors
- **Optimization**: Caches language detection results to avoid re-scanning unchanged file structure

**Issue Fetching** (`sonarqube-api-client.js`)
- Calls `/api/issues/search?project=<key>&severity in [CRITICAL, HIGH]&status=OPEN&ps=500`
- Filters: `severity in [CRITICAL, HIGH]` (default, configurable via `--minSeverity`)
- Filters: `status = OPEN` (excludes resolved/won't-fix to track only active issues)
- Handles pagination if > 500 issues (recursive calls with offset)
- Groups by: file, rule, severity, type
- Returns: `issues.json` with structured data including rule documentation URLs
- **Improvement**: Fetches SonarQube rule documentation (URL + description) for developer context
- **Improvement**: Adds "complexity" estimate per issue based on rule type

**Issue Output Format:**
```json
{
  "scanMetadata": {
    "projectKey": "dh-mcp-server",
    "projectName": "dh-mcp-server",
    "scanTime": "2026-01-13T14:30:00Z",
    "qualityGateStatus": "FAILED",
    "totalIssuesFound": 42,
    "criticalIssues": 8,
    "highIssues": 15,
    "mediumIssues": 19,
    "scanDuration": 45,
    "sonarqubeVersion": "10.3.0"
  },
  "issues": [
    {
      "key": "sonarqube-key-1",
      "rule": "javascript:S3758",
      "ruleName": "SQL queries should use parameterized queries",
      "severity": "CRITICAL",
      "type": "VULNERABILITY",
      "file": "src/auth/handler.ts",
      "line": 42,
      "message": "SQL Injection vulnerability detected",
      "ruleDocUrl": "https://rules.sonarsource.com/...",
      "effort": "5min",
      "complexity": "simple",
      "primaryLanguage": "typescript"
    }
  ]
}
```

---

### **Phase 3: Task Generation & Grouping**

**Grouping Logic** (`issue-grouper.js`)

| Scenario | Grouping |
|----------|----------|
| CRITICAL issues | 1 task per issue (high priority, isolated) |
| HIGH issues | 2-3 issues per task (related patterns, same file/rule) |
| MEDIUM issues | 4-5 issues per task (same rule type, can batch) |
| Complex issues | Split 1 issue into 3-5 subtasks (large refactoring) |

**Task Sizing:**
- **Simple** (< 1 hour): Single file, single rule fix
- **Medium** (1-2 hours): 3-5 files, related patterns
- **Complex** (2-3 hours): Architecture change, multi-file refactoring

If estimated time > 3 hours → **SPLIT into multiple tasks**

**Task.json Structure:**
```json
{
  "project": "dh-mcp-server",
  "branchName": "fix/sonarqube-critical-2026-01-13",
  "description": "Fix 8 CRITICAL and 15 HIGH severity SonarQube issues",
  "sonarqubeContext": {
    "scanUrl": "http://localhost:9000/dashboard?id=dh-mcp-server",
    "totalIssuesFound": 42,
    "issuesTargeted": 23,
    "criticalCount": 8,
    "highCount": 15,
    "estimatedResolved": 23,
    "estimatedRemaining": 19
  },
  "userStories": [
    {
      "id": "SQ-001",
      "sonarqubeKey": "sonarqube-key-1",
      "title": "[CRITICAL] SQL Injection in query builder",
      "description": "SQL queries built by string concatenation instead of parameterized statements. File: src/auth/handler.ts, lines 42-58.",
      "severity": "CRITICAL",
      "issueType": "VULNERABILITY",
      "affectedFiles": ["src/auth/handler.ts"],
      "ruleDocUrl": "https://rules.sonarsource.com/...",
      "acceptanceCriteria": [
        "Replace string concatenation with parameterized queries in all affected functions",
        "Add 3+ test cases covering SQL injection attack patterns",
        "All existing tests pass",
        "Re-run SonarQube scan confirms issue RESOLVED",
        "Typecheck passes",
        "Code coverage remains ≥ 85%"
      ],
      "status": "To do",
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
```

**Acceptance Criteria Guidelines:**
- Verifiable: each criterion is something QA can CHECK
- Includes: rule resolution (SonarQube re-scan), tests, typecheck
- Includes: edge cases for each criterion
- No vague statements ("works correctly", "good UX")

---

### **Phase 4: Persona-Based Remediation Loop**

Follows master-dev-workflow operations 5.1-5.3 exactly.

#### **Developer Subagent (Fix Issues)**

**Input:** One task from task.json

**Process:**
1. Read task.json and find assigned task
2. Verify task status = "To do"
3. Update status → "In Progress" + timestamp
4. Get SonarQube rule docs (from ruleDocUrl)
5. **Write unit tests FIRST** (test-driven development):
   - Test that demonstrates the bug/issue
   - Test after fix (correct behavior)
   - Edge case tests (variations, boundary conditions)
   - Target: ≥ 85% coverage for changed files
6. Implement fix following rule requirements + existing code patterns
7. Run tests → verify all pass
8. Run linter → fix style issues
9. Commit: `fix: SQ-001 - [issue title]`
10. Update task.json: status → "Ready For QA" + timestamp

**Expected Output:**
- All unit tests passing
- Code coverage ≥ 85%
- Linting clean
- Implementation summary: files modified, tests added, test results
- task.json updated with "Ready For QA" status

**Example Commit Message:**
```
fix: SQ-001 - Replace string concatenation with parameterized SQL queries

- Updated 4 functions in src/auth/handler.ts to use prepared statements
- Added 5 test cases covering SQL injection patterns
- All tests passing (42/42)
- Coverage: 87%

Resolves SonarQube rule: javascript:S3758
```

#### **QA Subagent (Validate Fixes)**

**Input:** One task marked "Ready For QA", Developer's implementation summary

**Process:**
1. Read task.json and find assigned task
2. Verify task status = "Ready For QA"
3. Review code changes:
   - Do they follow the rule requirements exactly?
   - Are there any edge cases missed?
   - Is error handling comprehensive?
4. **Re-run SonarQube scan** on changed files:
   - Call `/api/issues/search?file=<changed-file>&rule=<rule-key>`
   - Verify issue is now status = RESOLVED
   - If still OPEN → reject with "Fix incomplete"
5. **Create integration tests:**
   - Happy path: verify fix works as intended
   - Edge cases: 3+ scenarios that could regress
   - Error conditions: timeouts, invalid input, etc.
   - Security: if vulnerability, test attack patterns
6. **Run full test suite:**
   - Unit tests must pass
   - Integration tests must pass
   - Coverage must be ≥ 85%
   - Build must pass
7. **Decision:**
   - **If all checks PASS**: Mark "Done" ✅
   - **If any check FAILS**: Mark "Need Changes" + detailed feedback in notes

**QA Feedback Template (if rejected):**
```
NEED CHANGES - Feedback for Developer

Issue: [What failed]
Expected: [What should happen]
Found: [What we found instead]

Steps to fix:
1. [Action 1]
2. [Action 2]

Verification: [How to verify fix]
```

**Expected Output:**
- Integration tests for this task (all passing)
- SonarQube scan report (issue status = RESOLVED)
- Test coverage report
- QA assessment report (detailed feedback)
- task.json updated with status + timestamp

#### **Feedback Loop (If QA Rejects)**

**Orchestrator Checkpoint:**
1. Read task.json at `.github/artifacts/sonarqube-campaign-{TIMESTAMP}/task.json`
2. Find current task entry
3. Check status field:
   - If "Done": Proceed to next task (loop back to start of 5.1)
   - If "Need Changes": Execute feedback loop below
   - If anything else: HALT and report error
4. Track iteration count for this task

**Developer Re-Iterate (with Iteration Limit):**
1. Read feedback from task.json notes field
2. **Important**: Check iteration count (recommend max 3 before escalation to user)
3. Address each feedback point:
   - Modify code/tests as recommended
   - Re-run SonarQube scan to confirm RESOLVED status
   - Re-run full test suite and verify pass rate
   - Ensure coverage remains ≥85%
4. Update task.json: status → "In Progress" + timestamp
5. Commit: `fix: SQ-{id} - Address QA feedback [iteration N/3]`
6. Update task.json: status → "Ready For QA" + timestamp
7. Provide summary:
   - What feedback was addressed
   - Code/test changes made
   - SonarQube re-scan result (RESOLVED confirmation)
   - All tests passing: Y/N

**Iterations continue until:**
- QA marks task "Done" → move to next task
- 3 iterations reached without approval → escalate to user for manual review
- Developer confirms fix impossible → escalate to user

---

### **Phase 5: Metrics & Reporting**

**Before/After Report** (`metrics-reporter.js`)

Automatically generates comprehensive metrics comparing initial scan vs. final scan:

```markdown
# SonarQube Issue Fix Campaign Report

**Repository:** dh-mcp-server  
**Campaign Date:** 2026-01-13  
**Duration:** 2 hours 15 minutes  
**Branch:** fix/sonarqube-critical-2026-01-13

## Summary Metrics

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| **Total Issues** | 42 | 19 | **-23 (55%)** ✅ |
| **CRITICAL** | 8 | 0 | **-8 (100%)** ✅ |
| **HIGH** | 15 | 4 | **-11 (73%)** ✅ |
| **MEDIUM** | 19 | 15 | -4 (21%) |
| **Quality Gate** | FAILED | PASSED | ✅ |
| **Code Coverage** | 82% | 89% | +7% |

## Issue Resolution Details

| Task ID | Issue | Severity | Status | Resolved By | Duration |
|---------|-------|----------|--------|------------|----------|
| SQ-001 | SQL Injection | CRITICAL | ✅ DONE | commit abc123 | 7min |
| SQ-002 | XSS Vulnerability | CRITICAL | ✅ DONE | commit def456 | 23min |
| ... | ... | ... | ... | ... | ... |

## Task Completion Timeline

- **SQ-001**: Dev completed 14:45, QA approved 14:52 ✅ (0 iterations)
- **SQ-002**: Dev completed 15:10, QA rejected, Dev re-iterated 15:25, QA approved 15:33 ✅ (1 iteration)
- **SQ-003-005**: Dev completed 16:20, QA approved 16:35 ✅ (0 iterations)

**Key Insight**: Average 0.3 iterations per task (low rework ratio indicates good task scoping)

## Code Changes Summary

- **Files Modified**: 12
- **Lines Added**: 245
- **Lines Deleted**: 89
- **Tests Added**: 18
- **Test Execution Time**: 2.3 seconds
- **SonarQube Re-scan Time**: 45 seconds

## Quality Assurance Results

✅ All unit tests passing (342/342)  
✅ All integration tests passing (47/47)  
✅ Code coverage ≥ 85% (89% achieved)  
✅ Build verification passed  
✅ Linting clean (0 errors)  
✅ SonarQube quality gate PASSED  
✅ All 23 targeted issues marked RESOLVED

## Lessons Learned

- **Constant Extraction**: Removing magic strings significantly improves maintainability
- **Test-Driven Development**: Writing tests before code reduced QA feedback iterations
- **Clear Task Scoping**: Smaller, focused tasks (< 2 hours each) had 0 rejection rate


## Commits Made

```
fix: SQ-001 - Replace string concatenation with parameterized SQL queries
fix: SQ-002 - Implement XSS prevention in template rendering
fix: SQ-003,SQ-004 - Remove hardcoded secrets from codebase
fix: SQ-005,SQ-006 - Add input validation to API endpoints
```

## Quality Assurance Results

✅ All unit tests passing (342/342)  
✅ All integration tests passing (47/47)  
✅ Code coverage ≥ 85% (89%)  
✅ Build verification passed  
✅ Linting clean (0 errors)  
✅ SonarQube quality gate PASSED  

## Next Steps

- **Remaining Issues:** 19 (mostly MEDIUM severity)
- **Recommendation:** Schedule Phase 2 campaign to address remaining issues in next sprint
- **Deferred Issues:** Code smells (19 MEDIUM issues) - not critical path but improve maintainability
```

**MR Description:**
- Links before/after report above
- References all commit messages
- Includes issue resolution count: "Resolved 23 of 42 issues (55%)"
- Quality metrics: coverage, test count, build status
- Recommendation: next phase if desired

**Audit Trail File** (`.github/artifacts/sonarqube-campaign-2026-01-13/audit-trail.md`)
- All tool calls with timestamps
- All subagent outputs
- All task.json state changes
- Final metrics and sign-off

---

## Configuration & Defaults

### **Configurable Parameters**

User can customize behavior by passing options:

```bash
# Example: custom min severity
orchestrator.prompt.md --minSeverity HIGH
# Fixes CRITICAL + HIGH only (default)

orchestrator.prompt.md --minSeverity MEDIUM
# Fixes CRITICAL + HIGH + MEDIUM

orchestrator.prompt.md --languages typescript,python
# Auto-detects by default, but can override
```

### **Default Configuration**

```json
{
  "minSeverity": "HIGH",
  "includeCode Smells": false,
  "includeSecurityHotspots": true,
  "targetCoverage": 85,
  "maxTaskDurationHours": 3,
  "dockerCleanup": "destroy-after",
  "autoDetectLanguages": true
}
```

---

## Workflow Integration

### **How to Invoke**

From GitHub Copilot with repo context:

```
I want to fix SonarQube issues in this repo using the sonarqube-issue-fix-workflow skill
```

Or with options:

```
Use sonarqube-issue-fix-workflow skill to fix CRITICAL and HIGH severity issues, 
auto-detect languages, generate task.json for approval, then execute developer/QA loop
```

### **Required Context**

- Repository root (git repo)
- Docker installed & running
- Read/write access to repo (to create feature branch + commits)
- ~2-4 GB free disk space (for Docker volumes)

### **Output Artifacts**

After workflow completes, you'll have:

```
.github/artifacts/sonarqube-campaign-{TIMESTAMP}/
├── issues.json              # All SonarQube findings
├── task.json                # Right-sized tasks (completed)
├── audit-trail.md           # Full workflow log
├── metrics-report.md        # Before/after metrics
└── sonarqube-scan-logs/
    ├── initial-scan.json    # Before fixes
    └── final-scan.json      # After fixes
```

Plus:
- Feature branch: `fix/sonarqube-critical-{TIMESTAMP}`
- MR created with links to artifacts + metrics

---

## Skill Design Principles

1. **User Approval Gates:** Task.json requires explicit user approval before development starts
2. **Quality-First:** Developer writes tests before code; QA validates via re-scan + integration tests
3. **Feedback Loops:** Automated iteration between Developer/QA until QA approves
4. **Focused Scope:** CRITICAL + HIGH by default; user can extend to MEDIUM/LOW
5. **Ephemeral Infrastructure:** SonarQube Docker destroyed after workflow (clean state, no cruft)
6. **Auto-Detection:** Languages, file types detected automatically (no manual config needed)
7. **Audited:** All changes tracked, decisions logged, before/after metrics captured

---

## Limitations & Future Enhancements

### **Current Limitations**

- **Local execution only** (no CI/CD integration yet; future enhancement planned)
- **No Jira integration** (tasks are task.json only; integration hook feasible)
- **Task dependencies nice-to-have** (phase 2 feature; currently sequential processing)
- **Single language fixes** (each task focuses on one rule/pattern; multi-rule tasks possible)
- **Manual MR creation** (user reviews before merging; API-driven creation available)
- **SonarQube re-scan delays** (final metrics may be pending if scan still processing; fallback to initial scan + code review)
- **Max 3 feedback iterations** (prevents infinite loops; escalation to user after)

### **Verified Strengths (from Production Execution)**

✅ **Auto-Detection**: Successfully detected mixed C# + Python projects  
✅ **Task Scoping**: Generated right-sized tasks (simple 1-hour, medium 2-hour)  
✅ **Subagent Delegation**: Developer/QA loop executed autonomously with minimal rework  
✅ **Feedback Loops**: Single-pass execution for well-scoped tasks (0 rejections on simple tasks)  
✅ **Metrics Tracking**: Comprehensive before/after reporting with detailed audit trail  
✅ **Error Recovery**: Workflow survived SonarQube API delays, continued with fallback metrics  
✅ **Branch Management**: GitLab naming constraints handled, push to origin successful  
✅ **Test Coverage**: Achieved 85%+ coverage across all modified files  

### **Future Enhancements (Phase 2+)**

- **Real-time SonarQube Re-scan Polling**: Wait for final scan instead of fallback metrics (reduce uncertainty)
- **Task Dependency Detection**: Identify when task X must complete before task Y (e.g., security patches first)
- **Multi-rule Batching**: Fix related SonarQube rules in single task (improve developer efficiency)
- **Partial Campaign Mode**: Only new issues since last scan (faster for large codebases)
- **CI/CD Integration Hooks**: Block PRs with new CRITICAL issues (prevent regression)
- **Jira Ticket Sync**: Create/link Jira issues from SonarQube findings automatically
- **Custom Quality Gate Rules**: User-defined severity thresholds (per project configuration)
- **Diff-only Scanning**: Scan only changed files for faster feedback (pre-commit hook)
- **Parallel Task Execution**: Run multiple Developer/QA tasks concurrently (reduce total time)
- **Performance Insights**: Break down time spent in scanning vs. fixing vs. QA validation

---

## Files & Directory Structure

```
.github/skills/sonarqube-issue-fix-workflow/
├── SKILL.md                          # This file
├── scripts/
│   ├── sonarqube-setup.sh            # Linux setup (bash)
│   ├── sonarqube-setup.ps1           # Windows setup (PowerShell)
│   ├── sonarqube-scan.sh             # Run scan & fetch issues (Docker-based)
│   └── sonarqube-cleanup.sh          # Cleanup Docker containers/volumes/files
├── templates/
│   ├── sonar-project.properties      # SonarQube config (monorepo-aware)
│   ├── docker-compose.yml            # Docker compose template
│   └── .env.example                  # Environment variables
└── utils/
    ├── detect-languages.js           # Auto-detect project languages
    ├── issue-grouper.js              # Convert issues to tasks
    ├── sonarqube-api-client.js        # REST API helper
    └── metrics-reporter.js            # Generate before/after report
```

### **Orchestration Prompts (separate from skill)**

Developer and QA subagent prompts live in the prompts directory:
- `.github/prompts/subagents/subagent-developer-generic.prompt.md`
- `.github/prompts/subagents/subagent-qa-generic.prompt.md`

---

## Quick Start (User Perspective)

### Claude Code

```bash
# Use the /fix-sonarqube command:
/fix-sonarqube

# Or invoke directly:
# "Fix SonarQube issues in this repo using the sonarqube-issue-fix-workflow skill"
```

### Manual (step-by-step)

```bash
# 1. Setup SonarQube Docker instance
bash .github/skills/sonarqube-issue-fix-workflow/scripts/sonarqube-setup.sh

# 2. Run scan and fetch issues
bash .github/skills/sonarqube-issue-fix-workflow/scripts/sonarqube-scan.sh

# 3. Review issues in .github/artifacts/sonarqube-campaign-*/issues.json
# 4. Fix issues (manually or via /fix-sonarqube workflow)

# 5. Cleanup when done
bash .github/skills/sonarqube-issue-fix-workflow/scripts/sonarqube-cleanup.sh --all
```

### GitHub Copilot

```
# > Use sonarqube-issue-fix-workflow to fix my code quality issues
# Copilot runs setup → scan → analyze → fix → report automatically
```

---

## See Also

- [master-dev-workflow.prompt.md](../../prompts/master-dev-workflow.prompt.md) - Orchestration pattern reference
- [ralph SKILL](../ralph/SKILL.md) - Task breakdown and sizing
- [local-security-scan SKILL](../local-security-scan/SKILL.md) - Local security scanning (similar Docker pattern)
- [subagent-developer-generic](../../prompts/subagents/subagent-developer-generic.prompt.md) - Developer subagent instructions
- [subagent-qa-generic](../../prompts/subagents/subagent-qa-generic.prompt.md) - QA subagent instructions
