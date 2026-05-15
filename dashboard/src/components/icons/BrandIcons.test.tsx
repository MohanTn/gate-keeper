import React from 'react';
import { render } from '@testing-library/react';
import { ClaudeIcon, CopilotIcon } from './BrandIcons';
import '@testing-library/jest-dom';

// ── ClaudeIcon Tests ────────────────────────────────────────────────────────

describe('ClaudeIcon', () => {
  it('renders an SVG', () => {
    const { container } = render(<ClaudeIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg!.tagName).toBe('svg');
  });

  it('accepts size prop (default 16)', () => {
    const { container } = render(<ClaudeIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('height', '16');
  });

  it('renders with custom size', () => {
    const { container } = render(<ClaudeIcon size={32} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
  });

  it('has correct viewBox', () => {
    const { container } = render(<ClaudeIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it('contains a path element', () => {
    const { container } = render(<ClaudeIcon />);
    expect(container.querySelector('path')).toBeInTheDocument();
  });

  it('renders as fill="none"', () => {
    const { container } = render(<ClaudeIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('fill', 'none');
  });
});

// ── CopilotIcon Tests ───────────────────────────────────────────────────────

describe('CopilotIcon', () => {
  it('renders an SVG', () => {
    const { container } = render(<CopilotIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg!.tagName).toBe('svg');
  });

  it('accepts size prop (default 16)', () => {
    const { container } = render(<CopilotIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('height', '16');
  });

  it('renders with custom size', () => {
    const { container } = render(<CopilotIcon size={24} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
  });

  it('has correct viewBox', () => {
    const { container } = render(<CopilotIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it('contains path and circle elements', () => {
    const { container } = render(<CopilotIcon />);
    expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(1);
  });

  it('renders as fill="none"', () => {
    const { container } = render(<CopilotIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('fill', 'none');
  });
});
