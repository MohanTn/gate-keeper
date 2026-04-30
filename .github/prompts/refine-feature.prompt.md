---
name: refine-feature
description: Enhanced feature refinement workflow — deep scope discovery, web research, design pattern recommendations, 4-role stakeholder review, and optional immediate dev execution for <10 tasks.
---

# refine-feature — Complete Workflow (Idea → Done)

## HARD CONSTRAINTS
- Valid statuses ONLY: `PendingProductDirector → PendingArchitect → PendingUiUxExpert → PendingSecurityOfficer → ReadyForDevelopment`
- Rejection: any → `NeedsRefinement` → fix via `update_task` → `transition_task_status` back to `PendingProductDirector`
- **If no intention provided: STOP and ask** — "What bigger goal does this feature serve?"
- Do NOT store PII, credentials, or API keys in any field.

---

## Step 1 — Snapshot & Intent Discovery

1. `get_workflow_context(repoName, featureSlug)` — check prior work; if tasks exist past `PendingProductDirector`, skip to Step 6.
2. Ask: **"What are you trying to build or investigate?"**
   - If bug/investigation → consider `/bug-fix` workflow instead
   - If feature → continue to Step 2
3. Capture intention: "We are building X *so that* Y."
4. `add_clarification("What is the core intention?", userAnswer, askedBy: "llm")`

---

## Step 2 — Scope Discovery (Batch Upfront — Optimization 1.1)

**Ask ALL clarifying questions in ONE batch upfront**, not sequential waits.

Collect answers for:
- Who are the target users?
- What does success look like (measurable metrics)?
- What tech integrations are needed or available?
- What security, compliance, or regulatory constraints exist?
- What are the edge cases or anti-cases (what this should NOT do)?
- What is the deadline or urgency level?
- Are there existing patterns in the codebase to follow?

Store each: `add_clarification(question, userAnswer, askedBy: "llm")`

**Why batch upfront?** Sequential batching (ask 2-3, wait → ask 2-3 more) creates 2-3 blocking cycles = 30-45 min wasted. Batching upfront = parallel answers = faster clarity.

---

## Step 2.5 — MoSCoW Scope Table & Option Proposals

**Based on answers from Step 2**, generate and present:

### A. MoSCoW Prioritization Table

Categorize every identified requirement:
```
| Requirement            | Must Have | Should Have | Could Have | Won't Have |
|------------------------|-----------|-------------|------------|------------|
| [requirement 1]        |    ✓      |             |            |            |
| [requirement 2]        |           |     ✓       |            |            |
| [anti-requirement]     |           |             |            |     ✓      |
```

Ask user: "Does this prioritization match your intent? Adjust if needed."

### B. Option Proposals for Key Decisions

For any requirement with multiple valid approaches, present choices:

```
Q: How should users authenticate?
Option A — JWT tokens (stateless, lightweight, but less control)
Option B — Session-based (server state, more control, scales with Redis)
Option C — OAuth2 (social login, more setup, better UX)

→ Please select preferred option(s)
```

Generate options for decisions like:
- Authentication/authorization method
- Data persistence model (relational, document, cache)
- API style (REST, GraphQL, gRPC)
- UI framework and component library
- Deployment model (monolith, microservices, serverless)

### C. Store Confirmed Choices

For each decision made, store via:
`add_clarification(question, chosenOption, askedBy: "llm")`

---

## Step 3 — Web Research Phase (Optimization 1.5)

**BEFORE defining acceptance criteria, conduct comprehensive web research.**

### Check for Web Search Tools

Attempt to use available web search MCP tools:
- `brave-search-mcp` (preferred)
- `duckduckgo-mcp`
- `mcp__duckduckgo__search` (if available)

**If NO web search tools available:**
> ⚠️ Web research tools (brave-search-mcp, duckduckgo-mcp) are not available. Proceeding with analysis-only mode. Research findings may be incomplete.

### Research Queries (if tools available)

1. **Competitor / Prior Art:** "[feature name] best practices [current year]"
2. **Design Patterns:** "design patterns for [feature type] implementation"
3. **Implementation Examples:** "[tech stack] [feature] tutorial implementation 2025"
4. **Security/Compliance:** "[feature] security requirements OWASP compliance" (if applicable)
5. **Edge Cases:** "[feature] common pitfalls gotchas industry standards"

### Store Research Findings in Clarifications

After research, store key findings:

- `add_clarification("Market research findings", "[competitor analysis, key patterns, industry standards, best practices identified]", askedBy: "llm")`
- `add_clarification("Recommended design patterns", "[pattern 1: reason, pattern 2: reason, anti-patterns to avoid]", askedBy: "llm")`
- `add_clarification("Security/compliance findings", "[standards found, threat model implications, regulatory requirements]", askedBy: "llm")`
- `add_clarification("Implementation edge cases", "[common pitfalls, scalability considerations, performance notes]", askedBy: "llm")`

These findings will be **reused at Step 6** in stakeholder reviews — no repeat research needed.

---

## Step 4 — Feature-Level AC & Test Scenarios (Research-Informed)

### Add Feature Acceptance Criteria

`add_feature_acceptance_criteria` — 5–8 SMART criteria:
- **First 1–2 criteria** MUST directly verify the intention
- Include **research-informed criteria** (e.g., "Must conform to [standard] identified in market research", "Must handle [edge case] found in competitor analysis")
- Each criterion's description should **reference relevant research findings**

Example criteria informed by research:
```
AC-1 (Must Have): Feature conforms to [standard] per market research findings
AC-2 (Must Have): Handles [edge case] identified in industry analysis
AC-3 (Should Have): Implements [recommended pattern] per design research
AC-4 (Could Have): Supports [scalability concern] identified in implementation examples
```

### Add Feature Test Scenarios

`add_feature_test_scenarios` — 1:1+ mapping to AC:
- **First scenario (P0)** = end-to-end intention validation
- **Include research-informed scenarios** (e.g., edge cases from competitor analysis, performance edge cases from implementation examples)
- Scenario descriptions **embed research citations** (e.g., "FTS-2: Verify [edge case] handling per industry analysis")

---

## Step 5 — Task Breakdown & Validation

- `create_feature(featureSlug, featureName, description, intention, repoName)` — pass both `description` AND `intention`.
- `add_task` per task:
  - `status: PendingProductDirector`
  - Description **starts with** `[Layer: Backend|API|Frontend|…]`
  - **Include recommended design patterns** from Step 3 research in task description
  - Examples:
    - `[Layer: Backend] Implement authentication using [recommended pattern] per design research (see clarifications)`
    - `[Layer: Frontend] Build dashboard following [UI pattern] and accessibility standards identified in research`
- Layer coverage required: Database, Backend, API, Frontend, Integration, Navigation (skip with explicit justification only)
- `get_task_execution_plan` — review execution order and parallelizable phases
- `get_refinement_status` — **BLOCK if** clarifications, acceptanceCriteria, or testScenarios are empty

---

## Step 5.5 — Smart Refinement Inheritance (Optimization 1.6)

**When adding new tasks to a feature already through stakeholder review:**

1. **Check Prior Approvals** — Does feature have tasks in `ReadyForDevelopment` or beyond?
2. **Analyze New Task Concerns** — Does the new task introduce new stakeholder concerns?
   - Product concerns? (market positioning, business value, user segment changes)
   - Architecture concerns? (new patterns, tech changes, complexity)
   - UX concerns? (user workflows, accessibility, interface changes)
   - Security concerns? (compliance, data handling, threat model changes)
3. **Apply Smart Inheritance:**
   - **No new concerns** → Inherit all prior approvals → Move new task directly to `ReadyForDevelopment` (system transition)
   - **New concerns detected** → Trigger targeted review ONLY for affected roles (not full 4-role cycle)

**Example:** Adding task T05 (automated research) to feature with T01-T04 `ReadyForDevelopment`:
- Analysis: No new Product/Architecture/UX/Security concerns (backend infrastructure only)
- Action: Inherit approvals
- Result: T05 → `ReadyForDevelopment` without re-review
- **Time saved:** 40 minutes (89% reduction)

---

## Step 6 — Stakeholder Review Cycle (Batched by Role)

**Pattern:** `get_next_step` ONCE per role → **reuse Step 3 research** → `submit_role_batch_review` all tasks in ONE call.

**KEY OPTIMIZATION:** Step 3 research directly feeds these fields — no repeat research needed at Step 6.

| Role | `stakeholder` | Required `additionalFields` | Source |
|------|---------------|-----------------------------|--------|
| Product Director | `productDirector` | `marketAnalysis`, `competitorAnalysis`, `quickSummary` | Step 3 market research |
| Architect | `architect` | `technologyRecommendations`, `designPatterns` | Step 3 design pattern research |
| UI/UX Expert | `uiUxExpert` | `usabilityFindings`, `accessibilityRequirements`, `userBehaviorInsights` | Step 3 + feature AC/scenarios |
| Security Officer | `securityOfficer` | `securityRequirements`, `complianceNotes` | Step 3 security/compliance research |

### Per-Role Review Flow

**For each of the 4 roles (PD → Architect → UX → Security):**

1. `get_next_step(repoName, featureSlug, anyPendingTaskId)` — get systemPrompt for role (call ONCE for entire batch)
2. **Populate additionalFields** from Step 3 research (already stored in clarifications)
3. `submit_role_batch_review(repoName, featureSlug, stakeholder, reviews[{taskId, decision, notes, additionalFields}])`
4. Approved → auto-transitions to next role. Rejected → `NeedsRefinement`.

### Handle Rejections

If any task rejected to `NeedsRefinement`:
1. `update_task` — address feedback
2. `transition_task_status(NeedsRefinement → PendingProductDirector)` — reset
3. Re-run full stakeholder review cycle from Step 6 Product Director

---

## Step 7 — Finalization & Auto-Execute Decision

1. `get_tasks_by_status(ReadyForDevelopment)` — confirm all tasks present
2. `save_workflow_checkpoint` — description: "All tasks ReadyForDevelopment - ready for dev workflow"
3. `update_feature(description, intention)` — persist final versions if refined
4. **Present summary:**
   - Intention Statement
   - Clarifications count + summary
   - AC count + research citations
   - Test scenarios count
   - Task list with IDs and design patterns

### Auto-Execute Gate (if < 10 tasks)

**Check task count:**

```
if (taskCount < 10):
  Ask: "Feature has {taskCount} tasks (< 10). Execute full development 
        workflow now (Developer → Code Reviewer → QA → Done)? [yes/no]"
  
  if yes:
    → Continue to Step 8 (inline dev-workflow)
  else:
    → STOP. User can invoke /dev-workflow later.
else:
  → STOP at ReadyForDevelopment (too many tasks for immediate execution)
```

---

## Step 8 — OPTIONAL: Inline Dev-Workflow Execution (if <10 tasks + user approves)

**Proceed only if:**
- Task count < 10
- User answered "yes" to auto-execute

### Step 8.1 — Prerequisites & Branch
1. `get_workflow_context(repoName, featureSlug)` — confirm all `ReadyForDevelopment`
2. `get_workflow_metrics` — verify health, no critical alerts
3. Git: `git checkout -b feature/<featureSlug>/implementation`

### Step 8.2 — Developer Batch
1. `get_next_step(repoName, featureSlug, T01)` — developer systemPrompt (once)
2. Review all stakeholder notes: Product intent, Architect patterns, UX guidelines, Security requirements
3. `batch_transition_tasks(all tasks, ReadyForDevelopment→InProgress, actor: developer)`
4. **Implement all tasks** in `orderOfExecution` order
5. Ensure: `npm run build` succeeds with zero errors
6. Update docs: Search `*.md`, `docs/`, `CLAUDE.md` for outdated references
7. `batch_transition_tasks(all tasks, InProgress→InReview, actor: developer, metadata: {developerNotes, filesChanged, documentationNotes})`
8. `save_workflow_checkpoint` — "After developer batch"
9. Git: `git commit -m "feature/<slug>: implement all tasks"`

### Step 8.3 — Code Reviewer Batch
1. `get_next_step(repoName, featureSlug, T01)` — code reviewer systemPrompt
2. Review: `filesChanged` per task, AC adherence, design patterns, security, docs quality
3. Approved tasks:
   - `batch_transition_tasks(approved, InReview→InQA, actor: codeReviewer, metadata: {codeReviewerNotes, testResultsSummary})`
4. Rejected tasks:
   - `batch_transition_tasks(rejected, InReview→NeedsChanges, actor: codeReviewer, metadata: {codeReviewerNotes})`

### Step 8.4 — QA Batch
1. `get_next_step(repoName, featureSlug, T01)` — QA systemPrompt
2. Execute all test scenarios per task definitions
3. Verify all AC via: `batch_update_acceptance_criteria([{taskId, criterionId, verified: true}])`
4. Passed tasks:
   - `batch_transition_tasks(passed, InQA→Done, actor: qa, metadata: {qaNotes, testExecutionSummary, acceptanceCriteriaMet: true})`
5. Failed tasks:
   - `batch_transition_tasks(failed, InQA→NeedsChanges, actor: qa, metadata: {qaNotes})`
6. `save_workflow_checkpoint` — "After QA batch"

### Step 8.5 — Handle Rework
If `NeedsChanges` tasks exist:
1. `get_workflow_metrics` — check rework cycles; alert if concerning
2. Fix issues
3. `transition_task_status(NeedsChanges→InProgress)` per task (singular tool, not batch)
4. **Return to Step 8.2 Developer Batch** (re-implement, re-review, re-test)

### Step 8.6 — Finalization
1. `verify_all_tasks_complete(repoName, featureSlug)` — confirm all `Done`
2. `get_workflow_snapshot` — final overview
3. Git: Create PR with feature summary + dashboard link
4. **Print summary:**
   ```
   ✅ Feature Complete!
   Intention: [intention]
   Tasks: [N] → Done
   AC Verified: [N]/[total]
   PR: [link to PR]
   Dashboard: [link to dashboard]
   ```

---

## Summary of New Optimizations

1. **Batch Clarifications Upfront (1.1)** — All scope Q&A in one batch, parallel answers
2. **MoSCoW Prioritization (2.5)** — Structured scope table + option proposals
3. **Web Research Phase (1.5+)** — Automatic market, design pattern, security, and edge case research
4. **Research Reuse (Step 6)** — No repeat research; stakeholder fields pre-populated from Step 3
5. **Smart Refinement Inheritance (1.6)** — Add tasks to refined features without full re-review
6. **Auto-Execute for Small Features** — <10 tasks auto-execute dev pipeline if approved
7. **Design Pattern Integration** — Research findings embedded in task descriptions
8. **One-Command Idea→Done** — Optional Step 8 enables full execution without manual workflow switching

---

## State Machine Reference

### Refinement Phase
```
PendingProductDirector
  → PendingArchitect
    → PendingUiUxExpert
      → PendingSecurityOfficer
        → ReadyForDevelopment

Any state → NeedsRefinement (on rejection)
NeedsRefinement → PendingProductDirector (after update_task fix)
```

### Development Phase (Step 8 only)
```
ReadyForDevelopment
  → InProgress (developer)
    → InReview (developer)
      → InQA (code reviewer approved)
      → NeedsChanges (code reviewer or QA rejected)
        → InProgress (developer, after fix)
      → Done (QA approved)
```