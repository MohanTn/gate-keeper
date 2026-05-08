import { useEffect, useState } from 'react';
import { ArchMapping } from '../types';

export function useArchConfig(selectedRepo: string | null): ArchMapping | null {
    const [archConfig, setArchConfig] = useState<ArchMapping | null>(null);

    useEffect(() => {
        if (!selectedRepo) {
            setArchConfig(null);
            return;
        }
        fetch(`/api/arch?repo=${encodeURIComponent(selectedRepo)}`)
            .then(r => r.json())
            .then(config => setArchConfig(config))
            .catch(() => setArchConfig(null));
    }, [selectedRepo]);

    return archConfig;
}
