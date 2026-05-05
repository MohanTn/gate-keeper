import { useCallback, useEffect, useRef, useState } from 'react';
import { RepoInfo } from '../types';

interface UseRepoSelectionReturn {
    repos: RepoInfo[];
    selectedRepo: string | null;
    showRepoSelector: boolean;
    setShowRepoSelector: React.Dispatch<React.SetStateAction<boolean>>;
    handleRepoSelect: (repo: string) => void;
    refreshRepos: () => void;
}

export function useRepoSelection(): UseRepoSelectionReturn {
    const [repos, setRepos] = useState<RepoInfo[]>([]);
    const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
    const [showRepoSelector, setShowRepoSelector] = useState(false);
    const initialLoadDone = useRef(false);

    const loadRepos = useCallback(() => {
        fetch('/api/repos')
            .then(r => r.json())
            .then((data: RepoInfo[]) => {
                setRepos(data);
                if (!initialLoadDone.current) {
                    initialLoadDone.current = true;
                    if (data.length === 1) {
                        setSelectedRepo(data[0].repoRoot);
                    } else if (data.length > 1) {
                        setShowRepoSelector(true);
                    }
                }
            })
            .catch(() => { /* repo fetch failed — will retry on next render */ });
    }, []);

    useEffect(() => { loadRepos(); }, [loadRepos]);

    const handleRepoSelect = useCallback((repo: string) => {
        setSelectedRepo(repo);
        setShowRepoSelector(false);
    }, []);

    return {
        repos,
        selectedRepo,
        showRepoSelector,
        setShowRepoSelector,
        handleRepoSelect,
        refreshRepos: loadRepos,
    };
}
