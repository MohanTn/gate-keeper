/**
 * Git hook script generator.
 *
 * Produces shell scripts for post-commit, post-checkout, and the graphify
 * merge driver. Scripts are designed to be written into .git/hooks/ and
 * made executable. They trigger gate-keeper analysis after commits/checkouts
 * without blocking the git operation.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface HookInstallResult {
  hook: string;
  path: string;
  action: 'created' | 'updated' | 'skipped';
  content: string;
}

/** Shell script that re-analyzes changed files via the daemon (if running) */
export function postCommitScript(gateKeeperDir: string): string {
  const hook = path.join(gateKeeperDir, 'dist', 'hook-receiver.js');
  return `#!/bin/sh
# Gate Keeper — post-commit hook
# Re-analyzes files changed in this commit via the daemon (non-blocking).
set -e

HOOK="${hook}"
if [ ! -f "$HOOK" ]; then exit 0; fi

git diff-tree --no-commit-id -r --name-only HEAD | grep -E '\\.(ts|tsx|js|jsx|cs)$' | while read -r file; do
  FULL_PATH="$(git rev-parse --show-toplevel)/$file"
  if [ -f "$FULL_PATH" ]; then
    echo '{"tool_name":"Write","tool_input":{"file_path":"'"$FULL_PATH"'"}}' | node "$HOOK" 2>/dev/null &
  fi
done

exit 0
`;
}

/** Shell script that triggers a full re-scan after branch checkout */
export function postCheckoutScript(gateKeeperDir: string): string {
  const hook = path.join(gateKeeperDir, 'dist', 'hook-receiver.js');
  return `#!/bin/sh
# Gate Keeper — post-checkout hook
# Triggers a re-scan when switching branches (non-blocking).
set -e

PREV_HEAD="$1"
NEW_HEAD="$2"
BRANCH_CHECKOUT="$3"

# Only act on branch checkouts, not file checkouts
if [ "$BRANCH_CHECKOUT" != "1" ]; then exit 0; fi

HOOK="${hook}"
if [ ! -f "$HOOK" ]; then exit 0; fi

# Re-analyze files that differ between branches (non-blocking)
git diff --name-only "$PREV_HEAD" "$NEW_HEAD" | grep -E '\\.(ts|tsx|js|jsx|cs)$' | head -20 | while read -r file; do
  FULL_PATH="$(git rev-parse --show-toplevel)/$file"
  if [ -f "$FULL_PATH" ]; then
    echo '{"tool_name":"Write","tool_input":{"file_path":"'"$FULL_PATH"'"}}' | node "$HOOK" 2>/dev/null &
  fi
done

exit 0
`;
}

/** Git merge driver that union-merges graph JSON files */
export function mergeDriverScript(): string {
  return `#!/bin/sh
# Gate Keeper — graph.json merge driver
# Registers as: [merge "gate-keeper-graph"] driver = gate-keeper-merge %O %A %B
# In .gitattributes: graph.json merge=gate-keeper-graph

BASE="$1"
OURS="$2"
THEIRS="$3"

node -e "
const fs = require('fs');
const a = JSON.parse(fs.readFileSync('$OURS', 'utf8'));
const b = JSON.parse(fs.readFileSync('$THEIRS', 'utf8'));

// Union-merge nodes (take min rating on conflict)
const nodeMap = new Map(a.nodes.map(n => [n.id, n]));
for (const n of b.nodes) {
  const existing = nodeMap.get(n.id);
  if (existing && existing.rating !== n.rating) {
    nodeMap.set(n.id, { ...n, rating: Math.min(existing.rating, n.rating) });
  } else {
    nodeMap.set(n.id, n);
  }
}

// Union edges
const edgeSet = new Set((a.edges || []).map(e => e.source + '->' + e.target));
const edges = [...(a.edges || [])];
for (const e of (b.edges || [])) {
  const key = e.source + '->' + e.target;
  if (!edgeSet.has(key)) { edgeSet.add(key); edges.push(e); }
}

const merged = { ...a, nodes: [...nodeMap.values()], edges, generatedAt: Date.now() };
fs.writeFileSync('$OURS', JSON.stringify(merged, null, 2));
" 2>/dev/null

exit 0
`;
}

/**
 * Install git hooks into a repository's .git/hooks/ directory.
 * Returns one result entry per hook.
 */
export function installGitHooks(
  repoRoot: string,
  gateKeeperDir: string,
  force = false,
): HookInstallResult[] {
  const hooksDir = path.join(repoRoot, '.git', 'hooks');
  const results: HookInstallResult[] = [];

  if (!fs.existsSync(hooksDir)) {
    throw new Error(`No .git/hooks directory at ${hooksDir}. Is this a git repository?`);
  }

  const hooksToInstall: Array<{ name: string; content: string }> = [
    { name: 'post-commit', content: postCommitScript(gateKeeperDir) },
    { name: 'post-checkout', content: postCheckoutScript(gateKeeperDir) },
  ];

  for (const { name, content } of hooksToInstall) {
    const hookPath = path.join(hooksDir, name);
    const exists = fs.existsSync(hookPath);

    if (exists && !force) {
      results.push({ hook: name, path: hookPath, action: 'skipped', content });
      continue;
    }

    fs.writeFileSync(hookPath, content, { encoding: 'utf8', mode: 0o755 });
    results.push({ hook: name, path: hookPath, action: exists ? 'updated' : 'created', content });
  }

  return results;
}

/** Generate the .gitattributes line for the graph merge driver */
export function gitAttributesEntry(): string {
  return 'graph.json merge=gate-keeper-graph\n';
}

/** Generate the .git/config snippet for the merge driver */
export function gitConfigEntry(gateKeeperDir: string): string {
  const driverPath = path.join(gateKeeperDir, 'dist', 'hooks', 'merge-driver.sh');
  return `[merge "gate-keeper-graph"]\n\tname = Gate Keeper graph merge driver\n\tdriver = ${driverPath} %O %A %B\n`;
}
