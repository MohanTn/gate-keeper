import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../types';

const SCAN_EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.next', 'out',
  'coverage', 'vendor', '.cache', '__pycache__', 'bin', 'obj'
]);

/** Convert a simple glob pattern to a RegExp. Supports * and ** wildcards. */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTAR__/g, '.*');
  return new RegExp(`(?:^|/)${escaped}$`, 'i');
}

/** Map file extension to config language key */
export function extToConfigLang(ext: string): 'csharp' | 'typescript' | null {
  if (ext === '.cs') return 'csharp';
  if (['.ts', '.tsx', '.jsx', '.js'].includes(ext)) return 'typescript';
  return null;
}

/** Check if a file path should be excluded by scan patterns */
export function shouldExcludeFile(filePath: string, ext: string, patterns: Config['scanExcludePatterns']): boolean {
  if (!patterns) return false;
  const fileName = filePath.split('/').pop() ?? filePath;

  if (patterns.global) {
    for (const p of patterns.global) {
      const re = globToRegex(p);
      if (re.test(filePath) || re.test(fileName)) return true;
    }
  }

  const lang = extToConfigLang(ext);
  const langPatterns = lang ? patterns[lang] : null;
  if (langPatterns) {
    for (const p of langPatterns) {
      const re = globToRegex(p);
      if (re.test(filePath) || re.test(fileName)) return true;
    }
  }

  return false;
}

export function* walkFiles(
  dir: string,
  filter?: (filePath: string) => boolean,
): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SCAN_EXCLUDE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      yield* walkFiles(fullPath, filter);
    } else if (entry.isFile()) {
      if (!filter || filter(fullPath)) yield fullPath;
    }
  }
}

export function getGitDiffStats(filePath: string): { added: number; removed: number } | null {
  try {
    const numstat = spawnSync('git', ['diff', '--numstat', 'HEAD', '--', filePath], {
      encoding: 'utf8', timeout: 5000
    });
    const line = numstat.stdout?.trim();
    if (line) {
      const parts = line.split('\t');
      return { added: parseInt(parts[0], 10) || 0, removed: parseInt(parts[1], 10) || 0 };
    }

    const status = spawnSync('git', ['status', '--porcelain', '--', filePath], {
      encoding: 'utf8', timeout: 5000
    });
    const statusLine = status.stdout?.trim() ?? '';
    if (statusLine.startsWith('??') || statusLine.startsWith('A ')) {
      const wc = spawnSync('wc', ['-l', filePath], { encoding: 'utf8' });
      const lines = parseInt(wc.stdout?.trim().split(' ')[0] ?? '0', 10) || 0;
      return { added: lines, removed: 0 };
    }

    return { added: 0, removed: 0 };
  } catch {
    return null;
  }
}
