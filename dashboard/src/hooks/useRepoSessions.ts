import { useState, useEffect } from 'react';

export function useRepoSessions() {
  const [repoSessionTypes, setRepoSessionTypes] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const fetchRepos = async () => {
      try {
        const res = await fetch('http://127.0.0.1:5379/repos');
        if (res.ok) {
          const data = await res.json() as { repos: Array<{ path: string; sessionType: string }> };
          if (!cancelled) {
            const map: Record<string, string> = {};
            for (const r of data.repos) map[r.path] = r.sessionType;
            setRepoSessionTypes(map);
          }
        }
      } catch { /* ignore */ }
    };
    fetchRepos();
    return () => { cancelled = true; };
  }, []);

  return repoSessionTypes;
}
