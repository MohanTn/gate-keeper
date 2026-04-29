/**
 * gate-keeper hook-receiver
 *
 * Called by Claude Code's PostToolUse hook on every Write/Edit operation.
 * Must exit in < 100ms — all heavy work is delegated to the daemon.
 *
 * Reads JSON from stdin, extracts the file path, wakes the daemon (starting
 * it in the background if needed), then exits immediately.
 */
export {};
//# sourceMappingURL=hook-receiver.d.ts.map