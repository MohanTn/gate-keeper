import React from 'react';
import { render, screen } from '@testing-library/react';
import { QualityProgressCard } from './QualityProgressCard';
import { darkTokens } from '../ThemeContext';
import { QueueStats } from '../types';
import '@testing-library/jest-dom';

const T = darkTokens;

function makeStats(overrides: Partial<QueueStats> = {}): QueueStats {
  return {
    total: 100,
    pending: 20,
    inProgress: 5,
    completed: 60,
    failed: 10,
    skipped: 5,
    ...overrides,
  };
}

describe('QualityProgressCard', () => {
  describe('empty / no stats', () => {
    it('shows empty message when stats is null', () => {
      render(<QualityProgressCard stats={null} overallRating={7} running={false} paused={false} T={T} />);
      expect(screen.getByText(/No files in queue/i)).toBeInTheDocument();
    });

    it('shows empty message when total is 0', () => {
      render(<QualityProgressCard stats={makeStats({ total: 0 })} overallRating={7} running={false} paused={false} T={T} />);
      expect(screen.getByText(/No files in queue/i)).toBeInTheDocument();
    });
  });

  describe('with stats', () => {
    it('renders Quality Loop header', () => {
      render(<QualityProgressCard stats={makeStats()} overallRating={8} running={false} paused={false} T={T} />);
      expect(screen.getByText('Quality Loop')).toBeInTheDocument();
    });

    it('shows stat boxes with correct counts', () => {
      const stats = makeStats({ completed: 60, inProgress: 3, pending: 20, failed: 11, skipped: 6 });
      render(<QualityProgressCard stats={stats} overallRating={7} running={false} paused={false} T={T} />);

      expect(screen.getByText('60')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('20')).toBeInTheDocument();
      expect(screen.getByText('11')).toBeInTheDocument();
      expect(screen.getByText('6')).toBeInTheDocument();
    });

    it('shows percentage complete', () => {
      const stats = makeStats({ total: 100, completed: 75 });
      render(<QualityProgressCard stats={stats} overallRating={7} running={false} paused={false} T={T} />);
      expect(screen.getByText('75% complete')).toBeInTheDocument();
    });

    it('shows completed/total file count', () => {
      const stats = makeStats({ total: 100, completed: 75 });
      render(<QualityProgressCard stats={stats} overallRating={7} running={false} paused={false} T={T} />);
      expect(screen.getByText('75/100 files')).toBeInTheDocument();
    });

    it('displays overall rating', () => {
      render(<QualityProgressCard stats={makeStats()} overallRating={8.5} running={false} paused={false} T={T} />);
      expect(screen.getByText('8.5')).toBeInTheDocument();
    });

    it('shows Threshold: 7.0', () => {
      render(<QualityProgressCard stats={makeStats()} overallRating={7} running={false} paused={false} T={T} />);
      expect(screen.getByText('Threshold: 7.0')).toBeInTheDocument();
    });
  });

  describe('running state', () => {
    it('shows Running status when running and not paused', () => {
      render(<QualityProgressCard stats={makeStats()} overallRating={7} running={true} paused={false} T={T} />);
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('shows Paused status when running and paused', () => {
      render(<QualityProgressCard stats={makeStats()} overallRating={7} running={true} paused={true} T={T} />);
      expect(screen.getByText('Paused')).toBeInTheDocument();
    });

    it('shows Stopped status when not running', () => {
      render(<QualityProgressCard stats={makeStats()} overallRating={7} running={false} paused={false} T={T} />);
      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });
  });

  describe('progress bar color', () => {
    it('renders 0% when nothing is completed', () => {
      const stats = makeStats({ total: 100, completed: 0 });
      render(<QualityProgressCard stats={stats} overallRating={5} running={false} paused={false} T={T} />);
      expect(screen.getByText('0% complete')).toBeInTheDocument();
    });

    it('renders 100% when all files completed', () => {
      const stats = makeStats({ total: 50, completed: 50, pending: 0, inProgress: 0, failed: 0, skipped: 0 });
      render(<QualityProgressCard stats={stats} overallRating={9} running={false} paused={false} T={T} />);
      expect(screen.getByText('100% complete')).toBeInTheDocument();
    });

    it('renders correct percentage for partial completion', () => {
      const stats = makeStats({ total: 200, completed: 140 });
      render(<QualityProgressCard stats={stats} overallRating={7} running={false} paused={false} T={T} />);
      expect(screen.getByText('70% complete')).toBeInTheDocument();
    });
  });

  describe('rating color', () => {
    it('renders rating in green when overallRating >= 7', () => {
      render(<QualityProgressCard stats={makeStats()} overallRating={7.5} running={false} paused={false} T={T} />);
      const ratingEl = screen.getByText('7.5');
      expect(ratingEl).toHaveStyle({ color: '#22c55e' });
    });

    it('renders rating in red when overallRating < 7', () => {
      render(<QualityProgressCard stats={makeStats()} overallRating={6.5} running={false} paused={false} T={T} />);
      const ratingEl = screen.getByText('6.5');
      expect(ratingEl).toHaveStyle({ color: '#ef4444' });
    });
  });
});
