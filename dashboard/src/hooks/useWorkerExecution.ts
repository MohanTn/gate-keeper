import { useState, useRef, useEffect, useCallback } from 'react';

export interface TerminalState {
  output: string;
  running: boolean;
  exitCode: number | null;
}

const POLL_INTERVAL = 2000;
const TERMINAL_KEEP_MS = 30_000;

export function useWorkerExecution() {
  const [executingWorkers, setExecutingWorkers] = useState<Record<number, string>>({});
  const [terminalOutputs, setTerminalOutputs] = useState<Record<number, TerminalState>>({});

  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const terminalCleanupTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const executingWorkersRef = useRef(executingWorkers);
  executingWorkersRef.current = executingWorkers;

  useEffect(() => {
    return () => {
      for (const t of Object.values(pollTimers.current)) clearInterval(t);
      for (const t of Object.values(terminalCleanupTimers.current)) clearTimeout(t);
    };
  }, []);

  const startPolling = useCallback((workerId: string, itemId: number) => {
    const poll = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:5379/api/quality/output/${workerId}`);
        if (res.ok) {
          const data = await res.json() as TerminalState;
          setTerminalOutputs(prev => ({ ...prev, [itemId]: data }));

          if (!data.running) {
            if (pollTimers.current[workerId]) {
              clearInterval(pollTimers.current[workerId]);
              delete pollTimers.current[workerId];
            }
            const cleanup = setTimeout(() => {
              setExecutingWorkers(prev => { const n = { ...prev }; delete n[itemId]; return n; });
            }, TERMINAL_KEEP_MS);
            terminalCleanupTimers.current[itemId] = cleanup;
          }
        }
      } catch { /* ignore */ }
    };

    poll();
    pollTimers.current[workerId] = setInterval(poll, POLL_INTERVAL);
  }, []);

  const handleExecute = useCallback(async (itemId: number) => {
    try {
      const res = await fetch(`http://127.0.0.1:5379/api/quality/execute/${itemId}`, { method: 'POST' });
      const data = await res.json() as { ok: boolean; workerId: string; error?: string };
      if (data.ok && data.workerId) {
        setExecutingWorkers(prev => ({ ...prev, [itemId]: data.workerId }));
        startPolling(data.workerId, itemId);
      }
    } catch { /* ignore */ }
  }, [startPolling]);

  const handleCancel = useCallback((itemId: number) => {
    const workerId = executingWorkersRef.current[itemId];
    if (!workerId) return;
    (async () => {
      try {
        await fetch(`http://127.0.0.1:5379/api/quality/cancel/${workerId}`, { method: 'POST' });
      } catch { /* ignore */ }
      if (pollTimers.current[workerId]) {
        clearInterval(pollTimers.current[workerId]);
        delete pollTimers.current[workerId];
      }
    })();
  }, []);

  const clearWorkerState = useCallback((itemId: number) => {
    const workerId = executingWorkersRef.current[itemId];
    if (workerId) {
      handleCancel(itemId);
    }
    if (terminalCleanupTimers.current[itemId]) {
      clearTimeout(terminalCleanupTimers.current[itemId]);
      delete terminalCleanupTimers.current[itemId];
    }
    setExecutingWorkers(prev => { const n = { ...prev }; delete n[itemId]; return n; });
    setTerminalOutputs(prev => { const n = { ...prev }; delete n[itemId]; return n; });
  }, [handleCancel]);

  return {
    executingWorkers,
    terminalOutputs,
    handleExecute,
    handleCancel,
    clearWorkerState,
  };
}
