import { useCallback } from 'react';
import { RepoInfo } from '../types';

export function useClearData(selectedRepo: string | null, repos: RepoInfo[]) {
    return useCallback(async () => {
        if (!selectedRepo) { alert('Please select a repository first'); return; }
        const repoLabel = repos.find(r => r.repoRoot === selectedRepo)?.label ?? selectedRepo.split('/').pop();
        if (!window.confirm(`Delete all analysis data for "${repoLabel}"? This cannot be undone.`)) return;
        try {
            const res = await fetch('/api/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repo: selectedRepo }),
            });
            if (res.ok) {
                const data = await res.json();
                alert(`Deleted ${data.deleted} analyses.`);
                window.location.reload();
            } else { alert('Error clearing data'); }
        } catch { alert('Error clearing data'); }
    }, [selectedRepo, repos]);
}
