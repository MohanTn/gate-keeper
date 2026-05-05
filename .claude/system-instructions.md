# TOKEN EFFICIENCY & CONTEXT MANAGEMENT

To maximize the 5-hour usage window, adhere to these strict efficiency protocols:

## 1. Minimalist Communication
- Be extremely concise. Use fragments and bullet points instead of full sentences.
- Never explain code unless specifically asked "Why?" or "Explain."
- Do not provide conversational filler (e.g., "Certainly," "I have updated the file," "Let me know if...").
- When a task is complete, simply output: "Done: [Task Name]".

## 2. Context Preservation
- **Explicit Targets Only:** Do not read or search the entire codebase. Only read files I explicitly name or that are strictly necessary for the current sub-task.
- **Incremental Reading:** Read the smallest possible snippets of a file first. Do not `cat` a 500-line file if you only need to see one function.
- **Log Suppression:** When running commands from CLAUDE.md, pipe verbose output to `/dev/null` or use silent flags (e.g., `-q`, `--silent`) to avoid filling the chat history with logs.

## 3. Tool Usage Optimization
- **Verify Before Search:** Before using `grep` or global searches, check if the information exists in the current conversation summary.
- **Batch Edits:** Whenever possible, perform multiple related edits in a single `write_file` or `edit_file` call to reduce the number of turn-cycles.
- **Summarize Results:** If a command returns a large amount of data, provide a 1-2 line summary rather than the full output.

## 4. Self-Correction
- If you notice the conversation history becoming long, proactively suggest running the `/compact` command to clear the token buffer.


# Gate Keeper System-Level Instructions

  These instructions override all other guidance for this repository.

  ## Rule 1: Quality Gate is Mandatory

  Every file edit triggers this sequence:

  [Before] get_file_context → [Edit] → [After] analyze_file → [Validate] rating ≥ 7.0 → [Response]

  If any step fails, pause and fix before responding.

  ## Rule 2: You Cannot Skip Steps

  - No "I'll analyze it later"
  - No "this is a small change"
  - No "I'll run the tests manually"

  Each edit → immediate analysis → validation → response.

  ## Rule 3: Violation Precedence

  If analysis returns violations, fix in this order:
  1. Errors (−1.5 pts) — missing keys, empty catches
  2. Warnings (−0.5 pts) — `any` usage, god classes
  3. Info (−0.1 pts) — console.log
  4. Circular deps (−1.0) — break cycles

  Stop responding and fix until rating ≥ 7.0.

  Then reference it in your main CLAUDE.md:

  **Quality Standards:** See `.claude/system-instructions.md` — these are mandatory overrides.