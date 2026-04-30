---
name: dev-workflow
description: Feature development workflow — implements all tasks (Developer → Code Reviewer → QA) in batched role order, commits changes, and moves all tasks to Done.
---

# dev-workflow — Compact State-Machine Reference

## HARD CONSTRAINTS
- Valid statuses ONLY: `ReadyForDevelopment → InProgress → InReview → InQA → Done`
- Rejection: `InReview|InQA → NeedsChanges → InProgress` (direct — do NOT go via ReadyForDevelopment or ToDo)
- Actor values (exact camelCase): `developer`, `codeReviewer`, `qa`, `system`
- `documentationNotes` is **required** in developer metadata — "No documentation updates required: [reason]" if none needed.
- Do NOT store credentials or sensitive data in notes fields.

## Status Transition Table

| From | To | Actor | Tool |
|------|----|-------|------|
| `ReadyForDevelopment` | `InProgress` | `developer` | `batch_transition_tasks` |
| `InProgress` | `InReview` | `developer` | `batch_transition_tasks` |
| `InReview` | `InQA` | `codeReviewer` | `batch_transition_tasks` |
| `InReview` | `NeedsChanges` | `codeReviewer` | `batch_transition_tasks` |
| `InQA` | `Done` | `qa` | `batch_transition_tasks` |
| `InQA` | `NeedsChanges` | `qa` | `batch_transition_tasks` |
| `NeedsChanges` | `InProgress` | `developer` | `transition_task_status` |

## Required Metadata per Role

| Role | Required Fields | Optional Fields |
|------|-----------------|-----------------|
| `developer` | `developerNotes`, `filesChanged` (str[]), `documentationNotes` | `testFiles` (str[]), `docsUpdated` (str[]) |
| `codeReviewer` | `codeReviewerNotes`, `testResultsSummary` | `codeQualityConcerns` |
| `qa` | `qaNotes`, `testExecutionSummary`, `acceptanceCriteriaMet` (bool) | — |

## Workflow Steps

### 1 — Prerequisites
`get_workflow_context(repoName, featureSlug)` — confirm all tasks `ReadyForDevelopment`. Review stakeholder notes.
`get_workflow_metrics` — verify healthScore and no blocking alerts.

### 2 — Branch
`git checkout -b feature/<featureSlug>/description`

### 3 — Developer Batch (implement ALL tasks)
1. `get_next_step(repoName, featureSlug, T01)` — get developer systemPrompt (once for entire batch).
2. Read all stakeholder notes (Architect patterns, Security requirements, UX guidelines).
3. `batch_transition_tasks(taskIds: all, fromStatus: ReadyForDevelopment, toStatus: InProgress, actor: developer)`.
4. Implement all tasks in `orderOfExecution` order.
5. Run build: `npm run build` — must succeed with zero errors.
6. Search `*.md`, `docs/`, `CLAUDE.md` — update any outdated references.
7. `batch_transition_tasks(taskIds: all, fromStatus: InProgress, toStatus: InReview, actor: developer, metadata: {developerNotes, filesChanged, documentationNotes})`.
8. `save_workflow_checkpoint` — "After developer batch - all tasks in InReview".
9. Commit: `git commit -m "feature/<slug>: implement all tasks"`.

### 4 — Code Reviewer Batch (review ALL tasks)
1. `get_next_step(repoName, featureSlug, T01)` — get code reviewer systemPrompt (once for batch).
2. Review each task's `filesChanged`. Verify AC, design patterns, security controls, and `documentationNotes`.
3. `batch_transition_tasks(approved: InReview→InQA, actor: codeReviewer, metadata: {codeReviewerNotes, testResultsSummary})`.
4. `batch_transition_tasks(rejected: InReview→NeedsChanges, actor: codeReviewer, metadata: {codeReviewerNotes})` (if any).

### 5 — QA Batch (test ALL tasks)
1. `get_next_step(repoName, featureSlug, T01)` — get QA systemPrompt (once for batch).
2. Execute test scenarios from task definitions. Verify all AC.
3. `batch_update_acceptance_criteria([{taskId, criterionId, verified: true}])` — mark all verified AC at once.
4. `batch_transition_tasks(passed: InQA→Done, actor: qa, metadata: {qaNotes, testExecutionSummary, acceptanceCriteriaMet: true})`.
5. `batch_transition_tasks(failed: InQA→NeedsChanges, actor: qa, metadata: {qaNotes})` (if any).
6. `save_workflow_checkpoint` — "After QA batch - N done, M need fixes".

### 6 — Handle NeedsChanges (if any)
`get_workflow_metrics` — check rework cycle count (alert if high).
Fix issues → `transition_task_status(NeedsChanges→InProgress)` → re-enter step 3 for those tasks.

### 7 — Finalization
1. `verify_all_tasks_complete(repoName, featureSlug)` — confirm all `Done`.
2. `get_workflow_snapshot` — final overview.
3. Create PR with feature summary and link to feature in dashboard.
