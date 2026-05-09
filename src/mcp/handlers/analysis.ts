import * as fs from 'fs';
import * as path from 'path';
import { UniversalAnalyzer } from '../../analyzer/universal-analyzer';
import { StringAnalyzer } from '../../analyzer/string-analyzer';
import { FileAnalysis } from '../../types';
import {
  fetchDaemonApi,
  findGitRoot,
  findSourceFiles,
  formatAnalysisResult,
  formatStringResult,
  getMinRating,
} from '../helpers';
import { text } from './shared';

// ── Shared instances ───────────────────────────────────────

const fileAnalyzer = new UniversalAnalyzer();
const stringAnalyzer = new StringAnalyzer();

// ── Handlers ───────────────────────────────────────────────

export async function handleAnalyzeFile(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');
  if (!fs.existsSync(filePath)) return text(`Error: File not found: ${filePath}`);
  if (!fileAnalyzer.isSupportedFile(filePath)) {
    return text('Error: Unsupported file type. Supported: .ts, .tsx, .jsx, .js, .cs');
  }

  const analysis = await fileAnalyzer.analyze(filePath);
  if (!analysis) return text('Error: Analysis returned no results.');

  const minRating = getMinRating();
  return text(formatAnalysisResult(analysis, minRating));
}

export async function handleAnalyzeCode(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  const code = String(args.code ?? '');
  const language = String(args.language ?? '');
  if (!code) return text('Error: code is required.');
  if (!['typescript', 'tsx', 'jsx', 'csharp'].includes(language)) {
    return text('Error: language must be one of: typescript, tsx, jsx, csharp');
  }

  const result = stringAnalyzer.analyze(code, language as 'typescript' | 'tsx' | 'jsx' | 'csharp');
  const minRating = getMinRating();
  return text(formatStringResult(result, minRating));
}

export async function handleCodebaseHealth(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  const maxFiles = Number(args.max_files) || 200;
  const dir = String(args.directory || findGitRoot(process.cwd()));

  if (!fs.existsSync(dir)) return text(`Error: Directory not found: ${dir}`);

  const files = findSourceFiles(dir, maxFiles);
  if (files.length === 0) return text('No supported source files found in the directory.');

  const analyses: FileAnalysis[] = [];
  for (const f of files) {
    const a = await fileAnalyzer.analyze(f);
    if (a) analyses.push(a);
  }

  const minRating = getMinRating();
  const totalRating = analyses.reduce((s, a) => s + a.rating, 0);
  const avgRating = Math.round((totalRating / analyses.length) * 10) / 10;

  const sorted = [...analyses].sort((a, b) => a.rating - b.rating);

  const violationCounts = new Map<string, number>();
  for (const a of analyses) {
    for (const v of a.violations) {
      violationCounts.set(v.type, (violationCounts.get(v.type) ?? 0) + 1);
    }
  }
  const topViolations = [...violationCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const excellent = analyses.filter(a => a.rating >= 8).length;
  const good = analyses.filter(a => a.rating >= 6 && a.rating < 8).length;
  const poor = analyses.filter(a => a.rating < 6).length;

  const passed = avgRating >= minRating;

  const lines = [
    '## Codebase Health Report',
    `**Overall Rating: ${avgRating}/10** (${analyses.length} files) ${passed ? '✅' : '⚠️'}`,
    '',
    '### Rating Distribution',
    `- 🟢 Excellent (≥8.0): ${excellent} files`,
    `- 🟡 Needs work (6.0–7.9): ${good} files`,
    `- 🔴 Poor (<6.0): ${poor} files`,
  ];

  if (sorted.length > 0 && sorted[0].rating < minRating) {
    lines.push('', '### Worst Files');
    for (const a of sorted.slice(0, 10)) {
      if (a.rating >= minRating) break;
      const relPath = path.relative(dir, a.path);
      lines.push(`- **${a.rating}/10** — ${relPath} (${a.violations.length} violations)`);
    }
  }

  if (topViolations.length > 0) {
    lines.push('', '### Most Common Violations');
    for (const [type, count] of topViolations) {
      lines.push(`- ${type}: ${count} occurrences`);
    }
  }

  return text(lines.join('\n'));
}

export async function handleQualityRules(): Promise<{ content: Array<{ type: string; text: string }> }> {
  const minRating = getMinRating();
  const rules = [
    '## Gate Keeper Quality Rules',
    '',
    `**Minimum acceptable rating: ${minRating}/10**`,
    '',
    '### Scoring',
    'Every file starts at 10.0. Deductions:',
    '- **Error** violations: −1.5 each (e.g., missing key prop, empty catch)',
    '- **Warning** violations: −0.5 each (e.g., `any` usage, god class, long method)',
    '- **Info** violations: −0.1 each (e.g., console.log)',
    '- Cyclomatic complexity >20: −2.0',
    '- Cyclomatic complexity >10: −1.0',
    '- Import count >30: −2.0',
    '- Import count >15: −0.5',
    '- Lines of code >500: −1.5',
    '- Lines of code >300: −0.5',
    '- Test coverage <50%: −1.0 (+ warning violation −0.5)',
    '- Test coverage 50–80%: −0.5 (+ info violation −0.1)',
    '- No test coverage data for file: warning violation −0.5',
    '',
    '### TypeScript / JavaScript Rules',
    '- **any_usage** (warning): Do not use `any`. Use specific types or `unknown`.',
    '- **console_log** (info): Remove console.log/warn/error from production code.',
    '- **hook_overload** (warning): React components should not have >7 hooks.',
    '- **duplicate_hooks** (warning): Do not call the same hook multiple times.',
    '- **missing_key** (error): Always add `key` prop in `.map()` JSX.',
    '- **inline_handler** (warning): Extract inline JSX event handlers to named functions.',
    '',
    '### Test Coverage Rules',
    '- **no_test_coverage** (warning): File has no unit test coverage in the coverage report.',
    '- **low_test_coverage** (warning): Test coverage below 50% — add more tests.',
    '- **moderate_test_coverage** (info): Test coverage between 50–80% — consider improving.',
    '- **uncovered_lines** (info): Lists specific lines not covered by tests.',
    '',
    '### C# / .NET Rules',
    '- **god_class** (warning): Classes with >20 methods should be split.',
    '- **long_method** (warning): Methods longer than 50 lines should be refactored.',
    '- **tight_coupling** (warning): Constructors/methods with >5 parameters need a parameter object.',
    '- **empty_catch** (error): Never swallow exceptions with empty catch blocks.',
    '',
    '### Best Practices for Passing',
    '1. Use specific types — never `any`.',
    '2. Add `key` props to all list-rendered JSX elements.',
    '3. Keep functions/methods under 50 lines.',
    '4. Keep files under 300 lines (ideally under 200).',
    '5. Limit parameters to 5 or fewer.',
    '6. Always handle errors in catch blocks.',
    '7. Remove console.log before committing.',
    '8. Run tests with coverage (`--coverage`) to generate lcov.info for coverage analysis.',
    '9. Aim for 80%+ test coverage on all source files.',
  ];

  return text(rules.join('\n'));
}
