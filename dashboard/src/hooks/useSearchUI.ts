import { useCallback, useMemo, useRef, useState } from 'react';
import { GraphNode } from '../types';

interface UseSearchUIReturn {
    searchQuery: string;
    searchRef: React.RefObject<HTMLInputElement>;
    searchResults: GraphNode[];
    showSearchDropdown: boolean;
    handleSearchSelect: (node: GraphNode) => void;
    handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleSearchFocus: () => void;
    handleSearchBlur: () => void;
    handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function useSearchUI(nodes: GraphNode[], onNodeSelect: (node: GraphNode) => void): UseSearchUIReturn {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchFocused, setSearchFocused] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);

    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        const q = searchQuery.toLowerCase();
        return nodes
            .filter(n => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
            .slice(0, 8);
    }, [searchQuery, nodes]);

    const showSearchDropdown = searchFocused && searchQuery.trim().length > 0 && searchResults.length > 0;

    const handleSearchSelect = useCallback((node: GraphNode) => {
        onNodeSelect(node);
        setSearchQuery('');
        setSearchFocused(false);
        searchRef.current?.blur();
    }, [onNodeSelect]);

    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
    }, []);

    const handleSearchFocus = useCallback(() => setSearchFocused(true), []);

    const handleSearchBlur = useCallback(() => {
        setTimeout(() => setSearchFocused(false), 150);
    }, []);

    const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            setSearchQuery('');
            searchRef.current?.blur();
        }
    }, []);

    return {
        searchQuery,
        searchRef,
        searchResults,
        showSearchDropdown,
        handleSearchSelect,
        handleSearchChange,
        handleSearchFocus,
        handleSearchBlur,
        handleSearchKeyDown,
    };
}
