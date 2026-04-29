import React from 'react';

interface MetricCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  alert?: boolean;
  trend?: 'up' | 'down' | 'flat';
  onClick?: () => void;
  color?: string;
}

export function MetricCard({ title, value, subtitle, alert, trend, onClick, color }: MetricCardProps) {
  const borderColor = alert ? '#f44336' : (color ?? '#3f51b5');

  return (
    <div
      onClick={onClick}
      style={{
        background: '#16213e',
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 12,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.2s'
      }}
    >
      <div style={{ fontSize: 11, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: 1 }}>
        {title}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: borderColor, marginTop: 4 }}>
        {value}
        {trend === 'up' && <span style={{ fontSize: 14, marginLeft: 6, color: '#4caf50' }}>↑</span>}
        {trend === 'down' && <span style={{ fontSize: 14, marginLeft: 6, color: '#f44336' }}>↓</span>}
      </div>
      {subtitle && <div style={{ fontSize: 12, color: '#757575', marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}
