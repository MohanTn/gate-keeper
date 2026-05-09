import { useMemo } from 'react';
import { GraphData, RepoInfo } from '../types';

type ScanProgress = { analyzed: number; total: number } | null;

export function useAppMetrics(
    filteredGraphData: GraphData,
    selectedRepo: string | null,
    repos: RepoInfo[],
    scanProgress: ScanProgress,
) {
    const totalViolations = useMemo(
        () => filteredGraphData.nodes.reduce((a, n) => a + n.violations.length, 0),
        [filteredGraphData.nodes]
    );

    const overallRating = useMemo(() => {
        const locTotal = filteredGraphData.nodes.reduce((a, n) => a + (n.metrics.linesOfCode || 1), 0);
        return filteredGraphData.nodes.length > 0 && locTotal > 0
            ? Math.round((filteredGraphData.nodes.reduce((a, n) => a + n.rating * (n.metrics.linesOfCode || 1), 0) / locTotal) * 10) / 10
            : null;
    }, [filteredGraphData.nodes]);

    const currentRepoLabel = useMemo(
        () => selectedRepo ? (repos.find(r => r.repoRoot === selectedRepo)?.label ?? selectedRepo.split('/').pop()) : null,
        [selectedRepo, repos]
    );

    const scanPct = useMemo(
        () => scanProgress && scanProgress.total > 0 ? Math.round((scanProgress.analyzed / scanProgress.total) * 100) : null,
        [scanProgress]
    );

    return { totalViolations, overallRating, currentRepoLabel, scanPct };
}
