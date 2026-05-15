import React from 'react';
import { render, screen } from '@testing-library/react';
import { QualityTrendChart } from './QualityTrendChart';
import { darkTokens } from '../ThemeContext';
import { TrendDataPoint } from '../types';
import '@testing-library/jest-dom';

function makeTrend(overrides: Partial<TrendDataPoint> = {}): TrendDataPoint {
  return {
    id: 1, repo: '/repo', overallRating: 7.5,
    filesTotal: 100, filesPassed: 80, filesFailed: 15, filesPending: 5,
    recordedAt: Date.now(),
    ...overrides,
  };
}

const T = darkTokens;

describe('QualityTrendChart', () => {
  describe('insufficient data', () => {
    it('shows placeholder when trends is empty', () => {
      render(<QualityTrendChart trends={[]} T={T} />);
      expect(screen.getByText(/Not enough data points/i)).toBeInTheDocument();
    });

    it('shows placeholder when trends has exactly 1 point', () => {
      render(<QualityTrendChart trends={[makeTrend()]} T={T} />);
      expect(screen.getByText(/Not enough data points/i)).toBeInTheDocument();
    });

    it('placeholder prompts user to run quality loop', () => {
      render(<QualityTrendChart trends={[makeTrend()]} T={T} />);
      expect(screen.getByText(/Run the quality loop/i)).toBeInTheDocument();
    });
  });

  describe('with sufficient data', () => {
    const trends = [
      makeTrend({ id: 1, overallRating: 6.5, recordedAt: Date.now() - 10000 }),
      makeTrend({ id: 2, overallRating: 7.2, recordedAt: Date.now() - 5000 }),
      makeTrend({ id: 3, overallRating: 7.8, recordedAt: Date.now() }),
    ];

    it('renders the SVG chart element', () => {
      const { container } = render(<QualityTrendChart trends={trends} T={T} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('renders the Quality Trend header', () => {
      render(<QualityTrendChart trends={trends} T={T} />);
      expect(screen.getByText('Quality Trend')).toBeInTheDocument();
    });

    it('shows the latest rating', () => {
      render(<QualityTrendChart trends={trends} T={T} />);
      expect(screen.getByText('7.8/10')).toBeInTheDocument();
    });

    it('renders a path element (the line)', () => {
      const { container } = render(<QualityTrendChart trends={trends} T={T} />);
      const path = container.querySelector('path');
      expect(path).toBeInTheDocument();
    });

    it('renders dots for each data point', () => {
      const { container } = render(<QualityTrendChart trends={trends} T={T} />);
      const circles = container.querySelectorAll('circle');
      expect(circles.length).toBe(3);
    });

    it('renders threshold label', () => {
      render(<QualityTrendChart trends={trends} T={T} />);
      expect(screen.getByText('threshold 7.0')).toBeInTheDocument();
    });

    it('renders with exactly 2 trend points', () => {
      const twoTrends = [
        makeTrend({ id: 1, overallRating: 5.0 }),
        makeTrend({ id: 2, overallRating: 8.0 }),
      ];
      const { container } = render(<QualityTrendChart trends={twoTrends} T={T} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      const circles = container.querySelectorAll('circle');
      expect(circles.length).toBe(2);
    });

    it('shows rating below threshold in red', () => {
      const lowTrends = [
        makeTrend({ id: 1, overallRating: 5.0 }),
        makeTrend({ id: 2, overallRating: 5.5 }),
      ];
      render(<QualityTrendChart trends={lowTrends} T={T} />);
      // 5.5 < 7 so should not display as green color
      const ratingText = screen.getByText('5.5/10');
      expect(ratingText).toHaveStyle({ color: '#ef4444' });
    });

    it('shows rating at or above threshold in green', () => {
      const goodTrends = [
        makeTrend({ id: 1, overallRating: 7.0 }),
        makeTrend({ id: 2, overallRating: 7.5 }),
      ];
      render(<QualityTrendChart trends={goodTrends} T={T} />);
      const ratingText = screen.getByText('7.5/10');
      expect(ratingText).toHaveStyle({ color: '#22c55e' });
    });
  });
});
