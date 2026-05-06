import { useCallback, useEffect, useMemo, useState } from 'react';
import { GraphData, ExcludePattern } from '../types';

interface ScanExcludePatterns {
    global: string[];
    csharp: string[];
    typescript: string[];
}

/** Convert a simple glob pattern to a RegExp. Supports * and ** wildcards. */
function globToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '__GLOBSTAR__')
        .replace(/\*/g, '[^/]*')
        .replace(/__GLOBSTAR__/g, '.*');
    return new RegExp(escaped, 'i');
}

function matchesAnyPattern(filePath: string, patterns: ExcludePattern[]): boolean {
    const fileName = filePath.split('/').pop() ?? filePath;
    return patterns.some(p => {
        const re = globToRegex(p.pattern);
        return re.test(filePath) || re.test(fileName);
    });
}

interface UseExcludePatternsReturn {
    filteredGraphData: GraphData;
    patterns: ExcludePattern[];
    addPattern: (pattern: string, label?: string) => Promise<void>;
    removePattern: (id: number) => Promise<void>;
    scanExcludePatterns: ScanExcludePatterns | null;
}

export function useExcludePatterns(selectedRepo: string | null, graphData: GraphData): UseExcludePatternsReturn {
    const [patterns, setPatterns] = useState<ExcludePattern[]>([]);
    const [scanExcludePatterns, setScanExcludePatterns] = useState<ScanExcludePatterns | null>(null);

    const load = useCallback(() => {
        if (!selectedRepo) { setPatterns([]); return; }
        fetch(`/api/exclude-patterns?repo=${encodeURIComponent(selectedRepo)}`)
            .then(r => r.json())
            .then(data => setPatterns(Array.isArray(data) ? data : []))
            .catch(() => { setPatterns([]); /* API unreachable — reset to empty */ });
    }, [selectedRepo]);

    useEffect(() => { load(); }, [load]);

    const addPattern = useCallback(async (pattern: string, label?: string) => {
        if (!selectedRepo || !pattern.trim()) return;
        await fetch('/api/exclude-patterns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo: selectedRepo, pattern: pattern.trim(), label }),
        });
        load();
    }, [selectedRepo, load]);

    const removePattern = useCallback(async (id: number) => {
        await fetch(`/api/exclude-patterns/${id}`, { method: 'DELETE' });
        load();
    }, [load]);

    useEffect(() => {
        fetch('/api/scan-config')
            .then(r => r.json())
            .then(data => setScanExcludePatterns(data.scanExcludePatterns ?? null))
            .catch(() => { setScanExcludePatterns(null); /* config fetch failed */ });
    }, []);

    const filteredGraphData = useMemo<GraphData>(() => {
        if (patterns.length === 0) return graphData;
        const excludedIds = new Set<string>();
        for (const node of graphData.nodes) {
            if (matchesAnyPattern(node.id, patterns)) excludedIds.add(node.id);
        }
        if (excludedIds.size === 0) return graphData;
        return {
            nodes: graphData.nodes.filter(n => !excludedIds.has(n.id)),
            edges: graphData.edges.filter(e => {
                const s = typeof e.source === 'string' ? e.source : e.source?.id;
                const t = typeof e.target === 'string' ? e.target : e.target?.id;
                return !excludedIds.has(s) && !excludedIds.has(t);
            }),
        };
    }, [graphData, patterns]);

    return { filteredGraphData, patterns, addPattern, removePattern, scanExcludePatterns };
}
