/**
 * .graphifyignore parser — gitignore-compatible file exclusion for gate-keeper scans.
 *
 * Supports:
 *   #  comment lines
 *   !  negation (un-ignore a previously ignored path)
 *   *  matches any character except /
 *   ** matches any sequence including /
 *   ?  matches any single character except /
 *   Patterns without / match the basename at any depth (same as .gitignore).
 *   Patterns with / are anchored relative to the repo root.
 *
 * Usage:
 *   const rules = loadGraphifyIgnore(repoRoot);
 *   if (shouldIgnoreByGraphifyIgnore('/repo/src/gen/foo.ts', '/repo', rules)) skip();
 */

import * as fs from 'fs';
import * as path from 'path';

export interface IgnoreRule {
  pattern: string;
  negate: boolean;
  anchored: boolean; // true when pattern contains /
  regex: RegExp;
}

/** Parse the text content of a .graphifyignore file into rules. */
export function parseGraphifyIgnore(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const negate = line.startsWith('!');
    const raw = negate ? line.slice(1).trim() : line;
    const isDir = raw.endsWith('/');
    // Strip trailing / (directory marker — we match its contents)
    const pattern = isDir ? raw.slice(0, -1) : raw;
    // "anchored" = pattern originally had a / (including a trailing one)
    const anchored = raw.includes('/');

    rules.push({ pattern, negate, anchored, regex: buildRegex(pattern, anchored) });
  }
  return rules;
}

/** Load .graphifyignore from the repo root; returns empty array if file missing. */
export function loadGraphifyIgnore(repoRoot: string): IgnoreRule[] {
  const ignoreFile = path.join(repoRoot, '.graphifyignore');
  try {
    const content = fs.readFileSync(ignoreFile, 'utf8');
    return parseGraphifyIgnore(content);
  } catch {
    return [];
  }
}

/**
 * Returns true if `filePath` should be excluded according to `rules`.
 * Rules are evaluated in order; the last matching rule wins (gitignore semantics).
 */
export function shouldIgnoreByGraphifyIgnore(
  filePath: string,
  repoRoot: string,
  rules: IgnoreRule[],
): boolean {
  if (rules.length === 0) return false;

  const rel = path.relative(repoRoot, filePath).replace(/\\/g, '/'); // normalise on Windows
  const base = path.basename(rel);
  let ignored = false;

  for (const rule of rules) {
    const subject = rule.anchored ? rel : base;
    if (rule.regex.test(subject)) {
      ignored = !rule.negate;
    }
  }

  return ignored;
}

// ── Helpers ────────────────────────────────────────────────

function buildRegex(pattern: string, anchored: boolean): RegExp {
  // Escape special regex chars except * and ?
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // Multi-level wildcard ** must be replaced before single-level *
    // Use sentinel to avoid double-matching * inside **
    .replace(/\*\*/g, '\x00GLOBSTAR\x00')
    .replace(/\*/g, '[^/]*')               // single-level wildcard
    .replace(/\x00GLOBSTAR\x00/g, '.*')    // multi-level wildcard
    .replace(/\?/g, '[^/]');              // single char wildcard

  if (anchored) {
    // Anchored patterns: match from the start of the relative path
    return new RegExp(`^${escaped}(?:/.*)?$`);
  } else {
    // Un-anchored: match the basename only (exact or prefix for directories)
    return new RegExp(`^${escaped}(?:/.*)?$`);
  }
}
