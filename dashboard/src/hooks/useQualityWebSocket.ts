import { useEffect, useRef, useState } from 'react';
import { QueueItem, QueueStats, TrendDataPoint } from '../types';

interface StatusResponse {
  stats: QueueStats;
  running: boolean;
  paused: boolean;
}

interface QueueResponse {
  items: QueueItem[];
}

export interface QualityState {
  stats: QueueStats | null;
  items: QueueItem[];
  trends: TrendDataPoint[];
  overallRating: number;
  running: boolean;
  paused: boolean;
}

export function useQualityWebSocket() {
  const [state, setState] = useState<QualityState>({
    stats: null,
    items: [],
    trends: [],
    overallRating: 10,
    running: false,
    paused: false,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = () => {
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); }

    const ws = new WebSocket(`ws://${window.location.host}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'queue_update' && msg.queueItem) {
          setState(prev => {
            const exists = prev.items.findIndex(i => i.id === msg.queueItem.id);
            const updatedItems = exists >= 0
              ? prev.items.map((i, idx) => idx === exists ? msg.queueItem : i)
              : [...prev.items, msg.queueItem];
            return { ...prev, items: updatedItems };
          });
        } else if (msg.type === 'queue_progress' && msg.queueStats) {
          setState(prev => ({
            ...prev,
            stats: msg.queueStats,
            overallRating: msg.queueOverallRating ?? prev.overallRating,
          }));
        } else if (msg.type === 'trend_update' && msg.trend) {
          setState(prev => ({
            ...prev,
            trends: [...prev.trends, msg.trend].slice(-100),
          }));
        } else if (msg.type === 'worker_activity' && msg.workerAction === 'start') {
          setState(prev => ({ ...prev, running: true }));
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  };

  useEffect(() => {
    connect();

    // Fetch initial state from IPC
    const fetchInitial = async () => {
      try {
        const [statusRes, queueRes, trendsRes] = await Promise.all([
          fetch('http://127.0.0.1:5379/api/quality/status').catch(() => null),
          fetch('http://127.0.0.1:5379/api/quality/queue').catch(() => null),
          fetch('http://127.0.0.1:5379/api/quality/trends').catch(() => null),
        ]);

        if (statusRes?.ok) {
          const data: StatusResponse = await statusRes.json();
          setState(prev => ({ ...prev, stats: data.stats, running: data.running, paused: data.paused }));
        }
        if (queueRes?.ok) {
          const data: QueueResponse = await queueRes.json();
          setState(prev => ({ ...prev, items: data.items ?? [] }));
        }
        if (trendsRes?.ok) {
          const data = await trendsRes.json() as TrendDataPoint[];
          setState(prev => ({ ...prev, trends: data }));
        }
      } catch { /* ignore */ }
    };

    // Delay initial fetch to let daemon start
    setTimeout(fetchInitial, 1000);

    return () => {
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, []);

  return state;
}
