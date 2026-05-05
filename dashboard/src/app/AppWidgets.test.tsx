import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  ResizableWrapper,
  LogsPanel,
  RepoLoadingOverlay,
  SearchResultItem,
  Divider,
  HeaderStat,
  ScanProgressIndicator,
  HeaderButton,
} from './AppWidgets';
import { ThemeTokens } from '../ThemeContext';
import { GraphNode, ScanLogEntry } from '../types';
import { ratingColor } from '../ThemeContext';

// Mock ratingColor to return a predictable value for testing
jest.mock('../ThemeContext', () => ({
  ...jest.requireActual('../ThemeContext'),
  ratingColor: jest.fn((rating: number) => `rating-color-${rating}`),
}));

// Minimal ThemeTokens object for rendering
const T: ThemeTokens = {
  backdrop: 'rgba(0,0,0,0.5)',
  borderBright: '#e0e0e0',
  panel: '#ffffff',
  border: '#cccccc',
  text: '#111111',
  textFaint: '#999999',
  textDim: '#666666',
  textMuted: '#444444',
  red: '#ff0000',
  yellow: '#ffcc00',
  accent: '#1976d2',
  accentDim: '#bbdefb',
  bg: '#f5f5f5',
};

beforeEach(() => {
  jest.clearAllMocks();
  // jsdom does not implement scrollIntoView, so we mock it globally for all tests
  HTMLElement.prototype.scrollIntoView = jest.fn();
});

describe('ResizableWrapper', () => {
  const onResizeStart = jest.fn();
  const onBackdropClick = jest.fn();

  it('renders children and resize handle', () => {
    render(
      <ResizableWrapper width={300} onResizeStart={onResizeStart} T={T}>
        <div data-testid="child">Content</div>
      </ResizableWrapper>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    // the resize handle is a div with onMouseDown, we can test its existence via the inner visual div
    const handle = document.querySelector('[style*="cursor: col-resize"]');
    expect(handle).toBeInTheDocument();
  });

  it('calls onResizeStart when resize handle is mouse down', () => {
    render(
      <ResizableWrapper width={300} onResizeStart={onResizeStart} T={T}>
        <div>Content</div>
      </ResizableWrapper>
    );
    const handle = document.querySelector('[style*="cursor: col-resize"]') as HTMLElement;
    fireEvent.mouseDown(handle);
    expect(onResizeStart).toHaveBeenCalledTimes(1);
  });

  it('renders backdrop when withBackdrop is true and calls onBackdropClick', () => {
    render(
      <ResizableWrapper
        width={300}
        onResizeStart={onResizeStart}
        T={T}
        withBackdrop
        onBackdropClick={onBackdropClick}
      >
        <div>Content</div>
      </ResizableWrapper>
    );
    const backdrop = document.querySelector('.fade-in');
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop!);
    expect(onBackdropClick).toHaveBeenCalledTimes(1);
  });

  it('does not render backdrop when withBackdrop is false', () => {
    render(
      <ResizableWrapper width={300} onResizeStart={onResizeStart} T={T}>
        <div>Content</div>
      </ResizableWrapper>
    );
    expect(document.querySelector('.fade-in')).toBeNull();
  });
});

describe('LogsPanel', () => {
  const onClose = jest.fn();
  const baseLog: ScanLogEntry = {
    timestamp: Date.now(),
    level: 'info',
    message: 'Test message',
  };

  it('renders header and close button', () => {
    render(<LogsPanel logs={[]} onClose={onClose} T={T} />);
    expect(screen.getByText('Scan Logs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'x' })).toBeInTheDocument();
  });

  it('displays empty message when logs array is empty', () => {
    render(<LogsPanel logs={[]} onClose={onClose} T={T} />);
    expect(screen.getByText(/No scan logs yet/)).toBeInTheDocument();
  });

  it('renders log entries with correct colors based on level', () => {
    const logs: ScanLogEntry[] = [
      { timestamp: 1000, level: 'info', message: 'Info log' },
      { timestamp: 2000, level: 'warn', message: 'Warn log' },
      { timestamp: 3000, level: 'error', message: 'Error log' },
    ];
    render(<LogsPanel logs={logs} onClose={onClose} T={T} />);
    // check that each message appears
    expect(screen.getByText(/Info log/)).toBeInTheDocument();
    expect(screen.getByText(/Warn log/)).toBeInTheDocument();
    expect(screen.getByText(/Error log/)).toBeInTheDocument();
    // verify styling via inline colors
    const infoDiv = screen.getByText(/Info log/).closest('div');
    expect(infoDiv).toHaveStyle({ color: T.textMuted });
    const warnDiv = screen.getByText(/Warn log/).closest('div');
    expect(warnDiv).toHaveStyle({ color: T.yellow });
    const errorDiv = screen.getByText(/Error log/).closest('div');
    expect(errorDiv).toHaveStyle({ color: T.red });
  });

  it('displays timestamp formatted as locale time', () => {
    const log: ScanLogEntry = { timestamp: 1620000000000, level: 'info', message: 'Time test' };
    render(<LogsPanel logs={[log]} onClose={onClose} T={T} />);
    // The exact time string depends on locale; we can just check that a <span> with the time text exists
    // We'll rely on the fact that the timestamp is rendered before the message in the same line.
    const timeSpan = screen.getByText(new Date(log.timestamp).toLocaleTimeString());
    expect(timeSpan).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    render(<LogsPanel logs={[]} onClose={onClose} T={T} />);
    fireEvent.click(screen.getByRole('button', { name: 'x' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('scrolls to bottom when logs update', () => {
    const logs: ScanLogEntry[] = [baseLog];
    render(<LogsPanel logs={logs} onClose={onClose} T={T} />);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
  });
});

describe('RepoLoadingOverlay', () => {
  it('renders loading spinner and message', () => {
    render(<RepoLoadingOverlay T={T} />);
    expect(screen.getByText('Loading repository...')).toBeInTheDocument();
    const spinner = document.querySelector('[style*="border-radius: 50%"]');
    expect(spinner).toBeInTheDocument();
  });
});

describe('SearchResultItem', () => {
  const node: GraphNode = {
    id: '1',
    label: 'Test Node',
    rating: 5,
    // other fields if required
  } as GraphNode;
  const onSelect = jest.fn();

  it('renders node label and rating', () => {
    render(<SearchResultItem node={node} onSelect={onSelect} T={T} />);
    expect(screen.getByText('Test Node')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('calls onSelect with node on mouse down', () => {
    render(<SearchResultItem node={node} onSelect={onSelect} T={T} />);
    const container = document.querySelector('.search-result-item');
    fireEvent.mouseDown(container!);
    expect(onSelect).toHaveBeenCalledWith(node);
  });

  it('applies rating color via ratingColor function', () => {
    (ratingColor as jest.Mock).mockReturnValue('mock-rating-color');
    render(<SearchResultItem node={node} onSelect={onSelect} T={T} />);
    const ratingSpan = screen.getByText('5');
    expect(ratingSpan).toHaveStyle({ color: 'mock-rating-color' });
    expect(ratingColor).toHaveBeenCalledWith(5, T);
  });
});

describe('Divider', () => {
  it('renders a thin vertical line', () => {
    render(<Divider T={T} />);
    const div = document.querySelector('[style*="width: 1px"]');
    expect(div).toHaveStyle({ background: T.border, height: '22px' });
  });
});

describe('HeaderStat', () => {
  const onClick = jest.fn();

  it('renders label and value with given color', () => {
    render(
      <HeaderStat
        label="Total"
        value={42}
        color="blue"
        bold
        onClick={undefined}
        T={T}
      />
    );
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('42')).toHaveStyle({ fontWeight: 700, color: 'blue' });
  });

  it('renders without onClick shows no arrow', () => {
    render(<HeaderStat label="Stars" value={10} color="green" T={T} />);
    expect(screen.getByText('Stars')).toBeInTheDocument();
    expect(screen.queryByText('Stars ->')).toBeNull();
  });

  it('calls onClick when clicked', () => {
    render(
      <HeaderStat label="Files" value={5} color="red" onClick={onClick} T={T} />
    );
    fireEvent.click(screen.getByText('Files ->'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies bold when bold is true', () => {
    render(
      <HeaderStat label="Bold" value={1} color="black" bold T={T} />
    );
    expect(screen.getByText('1')).toHaveStyle({ fontWeight: 700 });
  });
});

describe('ScanProgressIndicator', () => {
  it('shows indeterminate scanning when total is 0', () => {
    render(<ScanProgressIndicator analyzed={0} total={0} T={T} />);
    expect(screen.getByText('Scanning...')).toBeInTheDocument();
    const bar = document.querySelector('[style*="width: 40%"]');
    expect(bar).toBeInTheDocument();
    // check pulse animation
    expect(bar).toHaveStyle({ animation: 'progressPulse 1.5s ease-in-out infinite' });
  });

  it('displays progress when total > 0', () => {
    render(<ScanProgressIndicator analyzed={5} total={10} T={T} />);
    expect(screen.getByText('5 / 10')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    const bar = document.querySelector('[style*="width: 50%"]');
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveStyle({ animation: 'none' });
  });

  it('title attribute shows details when total > 0', () => {
    render(<ScanProgressIndicator analyzed={3} total={8} T={T} />);
    const container = document.querySelector('[title]');
    expect(container).toHaveAttribute('title', '3/8 (38%)');
  });

  it('title when total is 0', () => {
    render(<ScanProgressIndicator analyzed={0} total={0} T={T} />);
    const container = document.querySelector('[title]');
    expect(container).toHaveAttribute('title', 'Scanning...');
  });
});

describe('HeaderButton', () => {
  const onClick = jest.fn();

  it('renders button with label', () => {
    render(<HeaderButton label="Click me" onClick={onClick} T={T} />);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('fires onClick when clicked', () => {
    render(<HeaderButton label="Test" onClick={onClick} T={T} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled state prevents click and applies styles', () => {
    render(<HeaderButton label="Disabled" onClick={onClick} disabled T={T} />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveStyle({ cursor: 'not-allowed' });
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('primary style when primary and not disabled', () => {
    render(<HeaderButton label="Primary" onClick={onClick} primary T={T} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveStyle({ backgroundColor: T.accentDim, borderColor: T.accent, color: '#EFF6FF' });
  });

  it('danger style when danger and not disabled', () => {
    render(<HeaderButton label="Danger" onClick={onClick} danger T={T} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveStyle({ backgroundColor: '#7F1D1D', borderColor: '#991B1B', color: '#FEE2E2' });
  });

  it('active style overrides default and applies accent tint', () => {
    render(<HeaderButton label="Active" onClick={onClick} active T={T} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveStyle({ backgroundColor: T.accent + '22', borderColor: T.accent, color: T.accent });
  });

  it('active style not applied if disabled', () => {
    render(<HeaderButton label="Active Disabled" onClick={onClick} active disabled T={T} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveStyle({ backgroundColor: T.panel, borderColor: T.border, color: T.textDim });
  });

  it('title attribute when provided', () => {
    render(<HeaderButton label="Hint" onClick={onClick} title="Tooltip" T={T} />);
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Tooltip');
  });
});