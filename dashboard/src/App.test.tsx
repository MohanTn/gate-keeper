// @ts-nocheck
/* eslint-disable */
// Run with: npx vitest (add vitest to devDependencies to execute)

// Pure utility functions duplicated here for unit testing.
// These live in App.tsx but are not exported; if they are ever extracted
// to a shared module, import them from there instead.

function globToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '__GLOBSTAR__')
        .replace(/\*/g, '[^/]*')
        .replace(/__GLOBSTAR__/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
}

function matchesAnyPattern(filePath: string, patterns: Array<{ pattern: string }>): boolean {
    const fileName = filePath.split('/').pop() ?? filePath;
    return patterns.some(p => {
        const re = globToRegex(p.pattern);
        return re.test(filePath) || re.test(fileName);
    });
}

describe('globToRegex', () => {
    it('matches a simple filename pattern', () => {
        const re = globToRegex('*.ts');
        expect(re.test('foo.ts')).toBe(true);
        expect(re.test('foo.tsx')).toBe(false);
    });

    it('matches a double-star glob across path segments', () => {
        const re = globToRegex('**/Migrations/**');
        expect(re.test('src/db/Migrations/001_init.ts')).toBe(true);
        expect(re.test('src/components/App.tsx')).toBe(false);
    });

    it('is case-insensitive', () => {
        const re = globToRegex('*.CS');
        expect(re.test('Program.cs')).toBe(true);
    });
});

describe('matchesAnyPattern', () => {
    it('returns false when no patterns provided', () => {
        expect(matchesAnyPattern('/src/App.tsx', [])).toBe(false);
    });

    it('matches on full path', () => {
        const patterns = [{ pattern: '**/Migrations/**' }];
        expect(matchesAnyPattern('/project/db/Migrations/001.ts', patterns)).toBe(true);
    });

    it('matches on filename alone', () => {
        const patterns = [{ pattern: '*.spec.ts' }];
        expect(matchesAnyPattern('/some/deep/path/foo.spec.ts', patterns)).toBe(true);
    });

    it('returns false when no pattern matches', () => {
        const patterns = [{ pattern: '*.spec.ts' }, { pattern: '**/Migrations/**' }];
        expect(matchesAnyPattern('/src/components/App.tsx', patterns)).toBe(false);
    });
});
