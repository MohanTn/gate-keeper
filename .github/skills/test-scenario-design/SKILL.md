---
name: test-scenario-design
description: >
  Translate acceptance criteria into concrete, step-by-step test scenarios that QA can execute.
  Use for feature refinement, testing setup, and QA planning.
  Each scenario is independent, repeatable, and documents what to do, what to expect, and how to verify.
  Categories: happy path (35-40%), exception paths (25-35%), edge cases (10-15%), regression (10-15%).
---


# Test Scenario Design (Condensed)

Translate acceptance criteria into step-by-step, independent, repeatable QA scenarios. Each scenario documents:
- What to do
- What to expect
- How to verify

## Scenario Template

    ## Scenario: [Name]
    **Objective:** [What this validates]
    **Preconditions:** [Setup, user, data]
    **Test Steps:**
    1. [Action]
    2. [Verification]
    **Expected Result:** [Outcome(s)]
    **Related AC:** [AC-X, AC-Y]
    **Notes:** [Special/Env details]

## Scenario Categories

- **Happy Path (35-40%)**: Normal, successful workflow
- **Exception Paths (25-35%)**: Error handling, invalid input
- **Edge Cases (10-15%)**: Boundaries, unusual data
- **Regression (10-15%)**: Existing features unaffected

## Examples

| Category        | Example                                 |
|-----------------|-----------------------------------------|
| Happy Path      | Create role successfully                |
| Exception Path  | Duplicate name error                    |
| Edge Case       | Create role with special characters     |
| Regression      | Existing login unchanged                |

## Good vs Bad Steps

**Bad:**
    1. Create a role
    2. Assign it
    → Expected: It works

**Good:**
    1. Click "Create New Role"
    2. Enter "Content Manager"
    3. Check "Edit" and "Publish"
    4. Click "Save"
    → Expected: Role appears in dropdown; success message

## Mapping to Acceptance Criteria

- Each scenario should test 1-2 AC items for full coverage and traceability.

| AC | Scenario |
|----|----------|
| AC-1: Create role | Scenario 1-3 |
| AC-2: Role in list <5s | Scenario 1, 4 |
| AC-3: Duplicate prevented | Scenario 2 |
| AC-4: Access feature | Scenario 5 |
| AC-5: Unauthorized denied | Scenario 6 |
| AC-6: Login unchanged | Scenario 10 |

## Scenario Quality Checklist

- [ ] Scenario is independent, repeatable
- [ ] Preconditions explicit
- [ ] Steps specific, numbered
- [ ] Results measurable
- [ ] Title descriptive
- [ ] Related AC documented
- [ ] No missing steps
- [ ] Error messages exact
- [ ] Edge cases covered
- [ ] Regression included
- [ ] Can be automated (if applicable)
