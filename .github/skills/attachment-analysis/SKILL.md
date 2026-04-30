---
name: attachment-analysis
description: >
  Analyze Jira attachments to extract context for Acceptance Criteria (AC) and Test Scenarios.
  Supports Excel files, design specs, requirement documents, and images. Extracts key data,
  maps findings to AC, and identifies missing test scenario details.
---

## Skill: Jira Attachment Analysis for AC & Test Scenarios

**Category**: Requirements Analysis  
**Scope**: Extract structured context from Jira attachments to clarify AC and Test Scenarios

### Skill Overview

This skill analyzes downloaded Jira attachments to extract data and design details that inform Acceptance Criteria and Test Scenarios. Attachment content is treated as the primary source of truth for requirements.

**Core Principle**: Use attachments as the authoritative source for AC details and test case design.

---

## Execution Process

### Step 1: Extract Attachment Content

**Excel Files** (rate cards, config tables, pricing):
- Identify columns and their purpose
- Count total items/records
- Note patterns and variants (e.g., NW vs PNS types)
- Record sample values with specifics

**Design Files** (mockups, screenshots, wireframes):
- Document component layout and placement
- List design elements, colors, typography
- Note states shown (default, hover, active, error, disabled, loading)
- Identify edge cases (empty state, error messages, loading states)

**Documents** (requirements, process flows, specs):
- Extract objectives and success criteria
- Note business rules and constraints
- Document data models and workflows
- Flag any new info compared to Jira ticket description

### Step 2: Map Findings to AC & Test Scenarios

For each attachment, identify:
1. **Which AC does this attachment clarify?** (list AC numbers)
2. **What scope does it define?** (item count, categories, coverage)
3. **What test scenarios does it enable?** (specific test cases, edge cases)
4. **What details are still missing?** (incomplete info, ambiguities)

Create a simple mapping:
```
Attachment: Updated Price Card.xlsx
├─ Clarifies AC: AC1 (pricing), AC2 (product scope)
├─ Test Scenarios: 
│  ├─ Verify 46 items are seeded correctly
│  ├─ Verify NW vs PNS pricing applied correctly
│  └─ Validate price ranges match provided values
└─ Gaps: Unclear if prices are NEW or CURRENT values
```

### Step 3: Document Findings

Report extracted data clearly:
- **File**: Name and type
- **Content Summary**: What's in the attachment (items, structure, key values)
- **Maps to AC**: Which acceptance criteria are addressed
- **Test Scenarios Enabled**: What can be tested based on this data
- **Remaining Questions**: What's still unclear


## Implementation Checklist

When analyzing attachments:

- [ ] Download all attachments from Jira ticket
- [ ] Extract content from each file (text, structure, data)
- [ ] Document findings with specific examples and values
- [ ] Map attachments to AC (identify which AC each file clarifies)
- [ ] Identify test scenarios each attachment enables
- [ ] List remaining gaps or ambiguities
- [ ] Create summary of key findings for AC and Test Scenarios
## Quick Reference

**When to use**: Jira ticket has attachments that provide AC details, test data, or design specifications

**Typical outputs**:
- Summary of attachment contents
- Which AC each attachment clarifies
- Test scenarios enabled by attachment data
- Any remaining gaps in AC or Test Scenarios

**Time investment**: 5-10 minutes per ticket with attachments

---