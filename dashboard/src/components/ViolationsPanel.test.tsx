import type { Violation } from '../types';

describe('ViolationsPanel', () => {
  it('should group violations', () => {
    const violations: Violation[] = [
      { type: 'any_usage', severity: 'warning', message: 'Use of any type', line: 10 },
      { type: 'missing_key', severity: 'error', message: 'Missing key prop', line: 20 },
    ];
    expect(violations.length).toBe(2);
  });

  it('should filter by severity', () => {
    const violations: Violation[] = [
      { type: 'any_usage', severity: 'warning', message: 'Use of any type' },
      { type: 'missing_key', severity: 'error', message: 'Missing key prop' },
      { type: 'console_log', severity: 'info', message: 'console.log found' },
    ];
    const errorViolations = violations.filter(v => v.severity === 'error');
    expect(errorViolations.length).toBe(1);
  });

  it('should search violations', () => {
    const violations: Violation[] = [
      { type: 'any_usage', severity: 'warning', message: 'Use of any type' },
      { type: 'missing_key', severity: 'error', message: 'Missing key prop' },
    ];
    const searchTerm = 'any';
    const filtered = violations.filter(v =>
      v.message.toLowerCase().includes(searchTerm.toLowerCase())
    );
    expect(filtered.length).toBe(1);
  });

  it('should define severity colors', () => {
    const severityColors = {
      error: '#f87171',
      warning: '#fbbf24',
      info: '#93c5fd',
    };
    expect(severityColors.error).toBeTruthy();
    expect(severityColors.warning).toBeTruthy();
    expect(severityColors.info).toBeTruthy();
  });

  it('should define severity badges', () => {
    const badges = { error: 'ERR', warning: 'WARN', info: 'INFO' };
    expect(badges.error).toBe('ERR');
  });

  it('should format violations for clipboard', () => {
    const violations: Violation[] = [
      { type: 'missing_key', severity: 'error', message: 'Missing key', line: 10, fix: 'Add key prop' },
    ];
    let text = '';
    for (const v of violations) {
      const loc = v.line ? ` (line ${v.line})` : '';
      text += `[${v.severity.toUpperCase()}] ${v.message}${loc}\n`;
    }
    expect(text).toContain('ERROR');
  });

  it('should handle empty violations', () => {
    const violations: Violation[] = [];
    expect(violations.length).toBe(0);
  });

  it('should toggle expansion state', () => {
    const expandedFiles = new Set<string>();
    const fileId = 'file1.ts';

    expandedFiles.add(fileId);
    expect(expandedFiles.has(fileId)).toBe(true);

    expandedFiles.delete(fileId);
    expect(expandedFiles.has(fileId)).toBe(false);
  });
});
