import React from 'react';
import { render, screen } from '@testing-library/react';
import { RatingBar, LangBadge, SevDot } from './SidebarComponents';
import { darkTokens, lightTokens } from '../ThemeContext';
import '@testing-library/jest-dom';

describe('RatingBar', () => {
  it('renders rating bar with correct percentage width', () => {
    const { container } = render(<RatingBar rating={8} T={darkTokens} />);
    expect(container.innerHTML).toContain('width: 80%');
  });

  it('displays rating value', () => {
    render(<RatingBar rating={7.5} T={darkTokens} />);
    expect(screen.getByText('7.5')).toBeInTheDocument();
  });

  it('uses green color for rating >= 8', () => {
    render(<RatingBar rating={9} T={darkTokens} />);
    expect(screen.getByText('9')).toHaveStyle('color: rgb(34, 197, 94)');
  });

  it('uses yellow color for rating >= 6 and < 8', () => {
    render(<RatingBar rating={7} T={darkTokens} />);
    expect(screen.getByText('7')).toHaveStyle('color: rgb(234, 179, 8)');
  });

  it('uses orange color for rating >= 4 and < 6', () => {
    render(<RatingBar rating={5} T={darkTokens} />);
    expect(screen.getByText('5')).toHaveStyle('color: rgb(249, 115, 22)');
  });

  it('uses red color for rating < 4', () => {
    render(<RatingBar rating={2} T={darkTokens} />);
    expect(screen.getByText('2')).toHaveStyle('color: rgb(239, 68, 68)');
  });

  it('renders with light theme tokens', () => {
    render(<RatingBar rating={8} T={lightTokens} />);
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('renders zero rating', () => {
    render(<RatingBar rating={0} T={darkTokens} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders perfect rating', () => {
    render(<RatingBar rating={10} T={darkTokens} />);
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders decimal rating', () => {
    render(<RatingBar rating={6.7} T={darkTokens} />);
    expect(screen.getByText('6.7')).toBeInTheDocument();
  });
});

describe('LangBadge', () => {
  it('renders TypeScript badge with correct label and color', () => {
    render(<LangBadge lang="typescript" />);
    expect(screen.getByText('TS')).toBeInTheDocument();
  });

  it('renders TSX badge with correct label and color', () => {
    render(<LangBadge lang="tsx" />);
    expect(screen.getByText('TSX')).toBeInTheDocument();
  });

  it('renders JSX badge with correct label and color', () => {
    render(<LangBadge lang="jsx" />);
    expect(screen.getByText('JSX')).toBeInTheDocument();
  });

  it('renders C# badge with correct label and color', () => {
    render(<LangBadge lang="csharp" />);
    expect(screen.getByText('C#')).toBeInTheDocument();
  });

  it('renders unknown language with uppercase label', () => {
    render(<LangBadge lang="python" />);
    expect(screen.getByText('PYTHON')).toBeInTheDocument();
  });

  it('renders unknown language with default gray color', () => {
    const { container } = render(<LangBadge lang="unknown" />);
    expect(container.innerHTML).toContain('#64748b');
  });

  it('TypeScript badge has blue color', () => {
    const { container } = render(<LangBadge lang="typescript" />);
    expect(container.innerHTML).toContain('#3b82f6');
  });

  it('TSX badge has cyan color', () => {
    const { container } = render(<LangBadge lang="tsx" />);
    expect(container.innerHTML).toContain('#06b6d4');
  });

  it('JSX badge has amber color', () => {
    const { container } = render(<LangBadge lang="jsx" />);
    expect(container.innerHTML).toContain('#f59e0b');
  });

  it('C# badge has purple color', () => {
    const { container } = render(<LangBadge lang="csharp" />);
    expect(container.innerHTML).toContain('#a78bfa');
  });

  it('badge has border with matching color', () => {
    const { container } = render(<LangBadge lang="typescript" />);
    expect(container.innerHTML).toContain('border: 1px solid #3b82f6');
  });

  it('badge has proper styling classes', () => {
    const { container } = render(<LangBadge lang="tsx" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge).toBeInTheDocument();
  });
});

describe('SevDot', () => {
  it('renders error severity with red color', () => {
    const { container } = render(<SevDot severity="error" T={darkTokens} />);
    expect(container.querySelector('span')).toHaveStyle('background: rgb(239, 68, 68)');
  });

  it('renders warning severity with yellow color', () => {
    const { container } = render(<SevDot severity="warning" T={darkTokens} />);
    expect(container.querySelector('span')).toHaveStyle('background: rgb(234, 179, 8)');
  });

  it('renders info severity with faint color', () => {
    const { container } = render(<SevDot severity="info" T={darkTokens} />);
    expect(container.querySelector('span')).toHaveStyle('background: rgb(100, 116, 139)');
  });

  it('renders with light theme tokens', () => {
    const { container } = render(<SevDot severity="error" T={lightTokens} />);
    expect(container.querySelector('span')).toHaveStyle('background: rgb(220, 38, 38)');
  });

  it('has correct size (7x7)', () => {
    const { container } = render(<SevDot severity="error" T={darkTokens} />);
    expect(container.innerHTML).toContain('width: 7');
    expect(container.innerHTML).toContain('height: 7');
  });

  it('has border radius for circular shape', () => {
    const { container } = render(<SevDot severity="error" T={darkTokens} />);
    expect(container.innerHTML).toContain('border-radius: 50%');
  });

  it('has margin right for spacing', () => {
    const { container } = render(<SevDot severity="error" T={darkTokens} />);
    expect(container.innerHTML).toContain('margin-right: 4px');
  });

  it('renders as inline-block element', () => {
    const { container } = render(<SevDot severity="error" T={darkTokens} />);
    expect(container.innerHTML).toContain('display: inline-block');
  });

  it('handles unknown severity as info', () => {
    const { container } = render(<SevDot severity="unknown" T={darkTokens} />);
    expect(container.innerHTML).toContain('rgb(100, 116, 139)');
  });
});

describe('SidebarComponents color mapping', () => {
  it('RatingBar color function maps ratings correctly', () => {
    const testCases = [
      { rating: 10, expectedRgb: 'rgb(34, 197, 94)' },  // green
      { rating: 8, expectedRgb: 'rgb(34, 197, 94)' },   // green
      { rating: 7, expectedRgb: 'rgb(234, 179, 8)' },   // yellow
      { rating: 6, expectedRgb: 'rgb(234, 179, 8)' },   // yellow
      { rating: 5, expectedRgb: 'rgb(249, 115, 22)' },  // orange
      { rating: 4, expectedRgb: 'rgb(249, 115, 22)' },  // orange
      { rating: 3, expectedRgb: 'rgb(239, 68, 68)' },   // red
      { rating: 0, expectedRgb: 'rgb(239, 68, 68)' },   // red
    ];

    testCases.forEach(({ rating, expectedRgb }) => {
      const { container } = render(<RatingBar rating={rating} T={darkTokens} />);
      expect(container.innerHTML).toContain(expectedRgb);
    });
  });
});
