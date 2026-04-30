# Copilot Instructions — Gate Keeper Repository

## MANDATORY: Quality Gate on Every Code Edit

**BLOCKING REQUIREMENT — DO NOT SKIP THIS UNDER ANY CIRCUMSTANCES.**

Every time you edit, create, or modify a `.ts`, `.tsx`, `.jsx`, `.js`, or `.cs` file, you **MUST**:

1. Call `analyze_file` (Gate Keeper MCP tool) with the absolute file path **immediately after the edit**
2. If the rating is **below 7.0**, fix the violations and re-analyze — repeat until ≥ 7.0
3. **Do NOT** move on to the next file or respond to the user until the file passes

This is **non-negotiable**. No edit to a code file is considered complete without a passing Gate Keeper analysis.

If the Gate Keeper MCP server is not available, **tell the user** rather than silently skipping.

## First Thing Every Session

Call `get_quality_rules` once at the start of the conversation to learn the scoring rules before writing any code.
