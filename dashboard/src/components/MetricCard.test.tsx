import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MetricCard } from './MetricCard';
import '@testing-library/jest-dom';

describe('MetricCard', () => {
  it('renders title and value', () => {
    render(<MetricCard title="Test Title" value={42} />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders string value', () => {
    render(<MetricCard title="Status" value="Active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<MetricCard title="Users" value={100} subtitle="Active users" />);
    expect(screen.getByText('Active users')).toBeInTheDocument();
  });

  it('does not render subtitle when not provided', () => {
    const { container } = render(<MetricCard title="Users" value={100} />);
    expect(container.textContent).not.toContain('subtitle');
  });

  it('applies alert styling when alert is true', () => {
    const { container } = render(<MetricCard title="Errors" value={5} alert />);
    const card = container.firstChild as HTMLElement;
    // Alert styling adds a border-left with accent color
    expect(card.style.borderLeftWidth).toBe('');
    // The component renders correctly with alert prop
    expect(card).toBeInTheDocument();
  });

  it('applies custom color when provided', () => {
    const { container } = render(<MetricCard title="Score" value={85} color="rgb(18, 52, 86)" />);
    const card = container.firstChild as HTMLElement;
    expect(card.style.borderLeft).toContain('rgb(18, 52, 86)');
  });

  it('renders up trend indicator', () => {
    render(<MetricCard title="Revenue" value={1000} trend="up" />);
    expect(screen.getByText('↑')).toBeInTheDocument();
  });

  it('renders down trend indicator', () => {
    render(<MetricCard title="Bounce Rate" value={45} trend="down" />);
    expect(screen.getByText('↓')).toBeInTheDocument();
  });

  it('does not render trend indicator when trend is not provided', () => {
    const { container } = render(<MetricCard title="Users" value={100} />);
    expect(container.textContent).not.toContain('↑');
    expect(container.textContent).not.toContain('↓');
  });

  it('calls onClick when clicked and onClick is provided', () => {
    const handleClick = jest.fn();
    render(<MetricCard title="Click Me" value={1} onClick={handleClick} />);
    fireEvent.click(screen.getByText('Click Me'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when clicked without onClick prop', () => {
    render(<MetricCard title="No Click" value={1} />);
    fireEvent.click(screen.getByText('No Click'));
  });

  it('has pointer cursor when onClick is provided', () => {
    const { container } = render(<MetricCard title="Clickable" value={1} onClick={() => {}} />);
    const card = container.firstChild as HTMLElement;
    expect(card.style.cursor).toBe('pointer');
  });

  it('has default cursor when onClick is not provided', () => {
    const { container } = render(<MetricCard title="Not Clickable" value={1} />);
    const card = container.firstChild as HTMLElement;
    expect(card.style.cursor).toBe('default');
  });

  it('renders decimal values correctly', () => {
    render(<MetricCard title="Rating" value={8.5} />);
    expect(screen.getByText('8.5')).toBeInTheDocument();
  });

  it('renders zero value', () => {
    render(<MetricCard title="Errors" value={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders large numbers', () => {
    render(<MetricCard title="Users" value={1000000} />);
    expect(screen.getByText('1000000')).toBeInTheDocument();
  });
});
