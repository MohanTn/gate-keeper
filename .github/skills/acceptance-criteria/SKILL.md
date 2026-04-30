---
name: acceptance-criteria
description: >
  Design measurable, testable acceptance criteria (AC) that define when work is "done".
  Use for feature refinement, ticket planning, and requirements definition.
  Ensures criteria are specific (not vague), measurable (not subjective), and testable (not ambiguous).
  Categories: happy path (40%), exception paths (25%), quality (20%), regression (15%).
---

## Acceptance Criteria (AC)

**AC are measurable, testable conditions that define when work is "done."**

### Principles
- Be specific (not vague)
- Be measurable (not subjective)
- Be testable (not ambiguous)

### Categories
- **Happy Path (40%)**: Normal, successful workflow
- **Exception Paths (25%)**: Errors and edge cases
- **Quality & Non-Functional (20%)**: Code quality, performance, security
- **Regression (15%)**: Ensure existing features aren't broken

### Template
```markdown
## Acceptance Criteria

### Happy Path (40%)
- [ ] [Action] → [Expected outcome]

### Exception Paths (25%)
- [ ] [Error condition] → [Expected error/behavior]

### Quality & Integration (20%)
- [ ] [Quality requirement] (measure: [X])

### Regression (15%)
- [ ] [Existing feature X] still works as before
```

### Common Mistakes
- Vague: "Feature works correctly" → Specify outcome and measure
- Subjective: "Code is clean" → Use objective standards (e.g., ESLint 0 warnings)
- Scope creep: Limit to 8-12 criteria per feature

### Validation Checklist
1. Is it testable?
2. Is it specific?
3. Can dev implement it?
4. Does QA know how to verify?
5. Can it be automated?
