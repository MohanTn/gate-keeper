import { useState, useRef, useCallback } from 'react';
import { AttemptLog } from '../types';

export function useAttemptHistory() {
  const [attempts, setAttempts] = useState<Record<number, AttemptLog[]>>({});
  const [loadingAttempts, setLoadingAttempts] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const attemptsRef = useRef(attempts);
  attemptsRef.current = attempts;

  const loadAttempts = useCallback(async (itemId: number) => {
    if (attemptsRef.current[itemId]) {
      setExpandedId(prev => prev === itemId ? null : itemId);
      return;
    }
    setLoadingAttempts(prev => new Set(prev).add(itemId));
    try {
      const res = await fetch(`http://127.0.0.1:5379/api/quality/attempts/${itemId}`);
      if (res.ok) {
        const data = await res.json() as AttemptLog[];
        setAttempts(prev => ({ ...prev, [itemId]: data }));
      }
    } catch { /* ignore */ }
    setLoadingAttempts(prev => { const n = new Set(prev); n.delete(itemId); return n; });
    setExpandedId(itemId);
  }, []);

  return {
    attempts,
    loadingAttempts,
    expandedId,
    loadAttempts,
  };
}
