import React, { useMemo } from 'react';
import { TrendDataPoint } from '../types';
import { ThemeTokens } from '../ThemeContext';

interface Props {
  trends: TrendDataPoint[];
  T: ThemeTokens;
}

export function QualityTrendChart({ trends, T }: Props) {
  const svgWidth = 400;
  const svgHeight = 140;
  const pad = { top: 10, right: 10, bottom: 20, left: 30 };

  const { points, yMin, yMax } = useMemo(() => {
    if (trends.length < 2) return { points: [], yMin: 0, yMax: 10 };
    const vals = trends.map(t => t.overallRating);
    const yMin = Math.max(0, Math.min(...vals) - 0.5);
    const yMax = Math.min(10, Math.max(...vals) + 0.5);
    const pts = trends.map((t, i) => {
      const x = pad.left + (i / (trends.length - 1)) * (svgWidth - pad.left - pad.right);
      const y = svgHeight - pad.bottom - ((t.overallRating - yMin) / (yMax - yMin)) * (svgHeight - pad.top - pad.bottom);
      return { x, y, rating: t.overallRating, when: new Date(t.recordedAt).toLocaleTimeString() };
    });
    return { points: pts, yMin, yMax };
  }, [trends]);

  if (trends.length < 2) {
    return (
      <div style={{ background: T.panel, borderRadius: 8, padding: 20, border: `1px solid ${T.border}`, height: svgHeight + pad.top + pad.bottom }}>
        <div style={{ fontSize: 12, color: T.textMuted, textAlign: 'center', marginTop: 40 }}>
          Not enough data points yet. Run the quality loop to see trends.
        </div>
      </div>
    );
  }

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const avgRating = trends[trends.length - 1]!.overallRating.toFixed(1);

  return (
    <div style={{ background: T.panel, borderRadius: 8, padding: 20, border: `1px solid ${T.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Quality Trend</div>
        <div style={{ fontSize: 12, color: avgRating >= '7' ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
          {avgRating}/10
        </div>
      </div>
      <svg width={svgWidth} height={svgHeight}>
        {/* Y-axis grid lines */}
        {[yMin, (yMin + yMax) / 2, yMax].map(v => {
          const y = svgHeight - pad.bottom - ((v - yMin) / (yMax - yMin)) * (svgHeight - pad.top - pad.bottom);
          return (
            <g key={v.toFixed(1)}>
              <line x1={pad.left} y1={y} x2={svgWidth - pad.right} y2={y} stroke={T.border} strokeWidth={0.5} />
              <text x={pad.left - 4} y={y + 3} textAnchor="end" fontSize={9} fill={T.textMuted}>
                {v.toFixed(1)}
              </text>
            </g>
          );
        })}
        {/* Threshold line */}
        <line x1={pad.left} y1={svgHeight - pad.bottom - ((7 - yMin) / (yMax - yMin)) * (svgHeight - pad.top - pad.bottom)}
          x2={svgWidth - pad.right}
          y2={svgHeight - pad.bottom - ((7 - yMin) / (yMax - yMin)) * (svgHeight - pad.top - pad.bottom)}
          stroke="#22c55e" strokeWidth={1} strokeDasharray="4,3" />
        <text x={svgWidth - pad.right - 2} y={4 + svgHeight - pad.bottom - ((7 - yMin) / (yMax - yMin)) * (svgHeight - pad.top - pad.bottom)}
          fontSize={8} fill="#22c55e" textAnchor="end">threshold 7.0</text>
        {/* Line */}
        <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={2} />
        {/* Dots */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill={p.rating >= 7 ? '#22c55e' : '#ef4444'} />
        ))}
      </svg>
    </div>
  );
}
