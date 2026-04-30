---

name: figma-design-integration
description: >
  Extract design context and generate UI code from Figma using Figma MCP server. Use for retrieving design specs, generated code, variables, and assets. Essential for UI/design features needing design-to-code integration.

## Figma Design & Code Integration (Condensed)

Figma MCP server enables:
- Extraction of design context, UI code, variables, assets, and Code Connect mappings
- Visual documentation and design-to-code workflows

### Prerequisites
- `figma-mcp-server` running
- Authenticated Figma user
- File shared with user
- Figma file URL or fileKey

### Key Tool Usage

**Extract fileKey/nodeId:**
- From Figma URL: `/design/{fileKey}/...node-id={nodeId}` (normalize nodeId to 123:456)
- Use `get_design_context` for design files, `get_figjam` for FigJam

**Retrieve design/code:**
- `get_design_context(fileKey, nodeId, clientFrameworks, clientLanguages)`
  - Returns: code, assets, metadata
- `get_variable_defs(fileKey, nodeId, ...)` for design tokens/variables
- `get_screenshot(fileKey, nodeId, ...)` for PNG screenshot

### Integration Workflow
1. Request Figma URL early (Stage 1.5)
2. Extract design context/code after database discovery
3. Add design specs/screenshots to acceptance criteria
4. Include design testing in test scenarios
5. Link Figma in Jira ticket and PRD

### Error Handling
- Node/file not found: check fileKey/nodeId format
- Access denied: request file access
- Code too large: use forceCode or request smaller node
- Missing assets: document and download manually if needed

### Best Practices
- Always extract Figma URL early
- Use nodeId for specific components, not whole file
- Document asset dependencies and design tokens
- Include screenshots in PRD and link Figma in Jira
- Version design references and test variants/responsiveness

