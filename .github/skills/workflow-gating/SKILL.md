---
name: workflow-gating
description: >
  Enforces hard stage gates and sequential execution for multi-stage workflows.
  Use when defining workflows with prerequisites, hard gates, checkpoints, and escalation paths.
  Prevents skipping stages or combining dependent steps. Ensures each stage completes before advancing.
---


# Workflow Stage Gating (Condensed)

All workflows are strictly stage-gated: each stage must complete before advancing. No skipping. Blockers are escalated, not worked around.

## Stage-Gate Model

    [Stage N: Description] ← HARD GATE
    - Prerequisites: [checklist]
    - If all met: advance
    - If any missing: STOP, escalate to user

## Implementation Rules

- Each stage: explicit prerequisites (checklist)
- Verify all before advancing
- If any fail: stop, ask user, document what's missing

**Example Hard Gate:**

    ## Stage 3: Gather Code Context
    Prerequisites:
    - ☑ Source file path valid
    - ☑ Project type detected
    - ☑ Dependencies installed
    - ☑ Git in sync
    Proceed only if all ☑ complete

**Escalation Template:**

    WORKFLOW BLOCKED at Stage X: [Stage Name]
    Reason: [Missing prerequisite]
    To unblock:
    1. [Action needed]
    2. ...
    Current status: [Completed before block]
    Next step: [What happens when unblocked]

## Context Accumulation

Before advancing:
- What was completed
- Context consumed (tokens)
- What is needed next
- Unknowns/assumptions

**Example Completion Summary:**

    Stage 2 Complete
    - ✓ Ticket details fetched
    - ✓ Dependencies identified
    - Context: ~2.5K tokens
    - Next: Code context (JIT)
    - Unknown: Performance reqs (clarify in Stage 4)

## Context Thresholds

- 50% used: Pause, review, defer non-critical, focus on core
- 70% used: Hard stop, output interim, document remaining, offer new session

    CONTEXT THRESHOLD (70%) REACHED
    Interim deliverable generated. Remaining:
    - [ ] Item A
    - [ ] Item B
    To continue, start new workflow with this output

## No Skipping Justification

- Prevents cascading failures
- Ensures completeness
- Enables reproducibility
- Catches blockers early

**Example:**

    ❌ Skip Stage 2 → Jump to Stage 4: Implement wrong thing, waste time
    ✓ Complete Stage 2 → Clarify → Proceed: Build right thing, no rework

## Prompt Writer Checklist

- [ ] All stages defined upfront
- [ ] Each stage has explicit, testable prerequisites
- [ ] Escalation path clear
- [ ] Context tracked at each stage
- [ ] Output summarizes completed stages
- [ ] No skipping allowed
- [ ] 50%/70% checkpoint rules documented
