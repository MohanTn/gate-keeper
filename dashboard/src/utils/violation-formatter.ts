import type { Violation } from '../types';

export interface FileViolationItem {
  fileLabel: string;
  fileId: string;
  violation: Violation;
}

/**
 * Convert a violation fix field to a display string.
 * Returns undefined when fix is null/undefined,
 * the string itself when fix is a string,
 * or the description property when fix is an object.
 */
export function toFixStr(fix: unknown): string | undefined {
  if (fix == null) return undefined;
  return typeof fix === 'string' ? fix : (fix as { description: string }).description;
}

/**
 * Build a plain-text summary of violations grouped by file.
 * Used for clipboard copy.
 */
export function buildCopyText(items: FileViolationItem[]): string {
  const grouped = new Map<string, FileViolationItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.fileId) ?? [];
    existing.push(item);
    grouped.set(item.fileId, existing);
  }

  const lines: string[] = [];
  for (const [, fileItems] of grouped) {
    const first = fileItems[0];
    lines.push(`### ${first.fileLabel}`);
    for (const fi of fileItems) {
      const loc = fi.violation.line ? ` (line ${fi.violation.line})` : '';
      lines.push(`  [${fi.violation.severity.toUpperCase()}] ${fi.violation.message}${loc}`);
      const fixStr = toFixStr(fi.violation.fix);
      if (fixStr) lines.push(`    Fix: ${fixStr}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}
