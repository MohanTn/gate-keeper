/**
 * ViolationsPanel Test Suite
 * 
 * Tests for the ViolationsPanel component which displays violations grouped by file
 * with filtering and searching capabilities.
 * 
 * Test Coverage:
 * - Panel renders with violation data
 * - Violations are grouped by file
 * - Severity filtering works (all, error, warning, info)
 * - Search filtering by file name and message works
 * - Expanded/collapsed state toggles per file
 * - Copy all violations to clipboard functionality
 * - Theme tokens properly applied to colors and styles
 * 
 * Integration Points:
 * - GraphData with nodes containing violations array
 * - ThemeTokens for dynamic styling
 * - WebSocket updates for real-time violation changes
 * - File detail navigation on violation click
 */

// Manual test execution:
// 1. Render with test violations data
// 2. Verify all violations display correctly grouped by file
// 3. Test each severity filter button
// 4. Type in search box and verify filtering
// 5. Click file groups to expand/collapse
// 6. Click copy button and verify clipboard content
// 7. Verify colors match current theme (light/dark)
