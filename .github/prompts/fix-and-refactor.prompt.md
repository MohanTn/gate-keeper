## Fix and Refactor

This workflow guides you through fixing bugs or refactoring code while maintaining existing behavior and following project standards. The workflow emphasizes a test-first approach, ensuring that changes are properly validated and documented throughout the process.

# Input
- Description of the issue to fix or code to refactor

# Output file
- Create a new file in `.github/artifacts/<issue-slug>/fix-and-refactor.md` (relative to current workspace)

# Step 1
- Parse the issue description to understand what needs fixing or refactoring
- Search the codebase for the affected files and related code
- Identify the root cause (for bugs) or the target architecture (for refactoring)
- Load relevant coding standards from instruction files
- add Step 1 completed into output file with problem analysis and root cause

# Step 2
- Identify all files that need changes
- For refactoring: ensure existing behavior is preserved (no functional changes)
- For bug fixes: identify the root cause and verify the fix addresses it
- Consider edge cases and potential regressions
- Present the plan to the user for approval if the change is significant
- add Step 2 completed into output file with the fix plan and affected files

# Step 3
- Write or update tests that cover the expected behavior
- For bug fixes: write a test that reproduces the bug (should fail before fix)
- For refactoring: ensure existing tests pass (add missing coverage if needed)
- Target >= 85% coverage for changed code
- add Step 3 completed into output file with test writing progress and coverage metrics

# Step 4
- Apply the fix or refactoring following project patterns
- For .NET: Follow CQRS, Clean Architecture, Repository patterns
- For React: Follow component patterns, hooks patterns, Emotion styling
- Ensure import organization follows the mandatory ordering
- Run linter and typecheck
- add Step 4 completed into output file with implementation summary and modified files

# Step 5
- Run all tests (existing + new)
- Verify coverage >= 85%
- Verify build succeeds
- For refactoring: verify no functional behavior changes
- For bug fixes: verify the reproducing test now passes
- Commit with descriptive message
- add Step 5 completed into output file with verification results and complete the workflow
