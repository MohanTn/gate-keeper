import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppHeader } from './AppHeader';
import { ThemeProvider, darkTokens } from '../ThemeContext';
import { GraphData, GraphNode } from '../types';

const emptyGraph: GraphData = { nodes: [], edges: [] };

const sampleNode: GraphNode = {
    id: 'src/foo.ts',
    label: 'foo.ts',
    type: 'typescript',
    rating: 8.5,
    size: 10,
    violations: [],
    metrics: {} as GraphNode['metrics'],
};

function makeProps(overrides: Partial<React.ComponentProps<typeof AppHeader>> = {}) {
    return {
        repos: [],
        selectedRepo: 'repo-1',
        currentRepoLabel: 'repo-1',
        wsStatus: 'connected' as const,
        scanning: false,
        scanProgress: null,
        scanPct: null,
        filteredGraphData: { nodes: [sampleNode], edges: [] },
        graphData: { nodes: [sampleNode], edges: [] },
        patterns: { length: 2 },
        totalViolations: 3,
        overallRating: 7.5,
        searchQuery: '',
        searchRef: React.createRef<HTMLInputElement>(),
        searchResults: [],
        showSearchDropdown: false,
        repoLoading: false,
        onShowRepoSelector: jest.fn(),
        onToggleFilterPanel: jest.fn(),
        onFileListOpen: jest.fn(),
        onScanAll: jest.fn(),
        onClearData: jest.fn(),
        onSearchChange: jest.fn(),
        onSearchFocus: jest.fn(),
        onSearchBlur: jest.fn(),
        onSearchKeyDown: jest.fn(),
        onSearchSelect: jest.fn(),
        onToggleViolationsPanel: jest.fn(),
        onStartQualityLoop: jest.fn(),
        qualityLoopRunning: false,
        T: darkTokens,
        ...overrides,
    };
}

function renderWithTheme(ui: React.ReactElement) {
    return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('AppHeader', () => {
    it('renders the title, repo label, and stats', () => {
        renderWithTheme(<AppHeader {...makeProps()} />);
        expect(screen.getByText('Gate Keeper')).toBeInTheDocument();
        expect(screen.getByText('repo-1')).toBeInTheDocument();
        expect(screen.getByText('7.5')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('shows "Select repo" placeholder when no repo is selected', () => {
        renderWithTheme(<AppHeader {...makeProps({ currentRepoLabel: null, selectedRepo: null })} />);
        expect(screen.getByText('Select repo')).toBeInTheDocument();
    });

    it.each([
        ['connecting', 'Connecting'],
        ['connected', 'Connected'],
        ['disconnected', 'Offline'],
    ] as const)('shows ws status badge label for %s', (status, label) => {
        renderWithTheme(<AppHeader {...makeProps({ wsStatus: status as 'connecting' })} />);
        expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('falls back to "Offline" label for an unknown ws status', () => {
        renderWithTheme(
            <AppHeader {...makeProps({ wsStatus: 'something-weird' as unknown as 'connected' })} />,
        );
        expect(screen.getByText('Offline')).toBeInTheDocument();
    });

    it('renders the search dropdown when showSearchDropdown is true', () => {
        renderWithTheme(
            <AppHeader {...makeProps({ showSearchDropdown: true, searchResults: [sampleNode] })} />,
        );
        expect(screen.getByText('foo.ts')).toBeInTheDocument();
    });

    it('fires search and button callbacks', () => {
        const onSearchChange = jest.fn();
        const onShowRepoSelector = jest.fn();
        const onToggleFilterPanel = jest.fn();
        const onFileListOpen = jest.fn();
        const onScanAll = jest.fn();
        const onClearData = jest.fn();
        const onToggleViolationsPanel = jest.fn();
        const onStartQualityLoop = jest.fn();

        renderWithTheme(
            <AppHeader
                {...makeProps({
                    onSearchChange,
                    onShowRepoSelector,
                    onToggleFilterPanel,
                    onFileListOpen,
                    onScanAll,
                    onClearData,
                    onToggleViolationsPanel,
                    onStartQualityLoop,
                })}
            />,
        );

        fireEvent.click(screen.getByText('repo-1'));
        expect(onShowRepoSelector).toHaveBeenCalled();

        fireEvent.change(screen.getByPlaceholderText('Search files…'), { target: { value: 'foo' } });
        expect(onSearchChange).toHaveBeenCalled();

        fireEvent.click(screen.getByText(/Filters/));
        expect(onToggleFilterPanel).toHaveBeenCalled();

        fireEvent.click(screen.getByText(/Files \(/));
        expect(onFileListOpen).toHaveBeenCalled();

        fireEvent.click(screen.getByText('Scan all'));
        expect(onScanAll).toHaveBeenCalled();

        fireEvent.click(screen.getByText('Clear'));
        expect(onClearData).toHaveBeenCalled();

        fireEvent.click(screen.getByText('3'));
        expect(onToggleViolationsPanel).toHaveBeenCalled();

        fireEvent.click(screen.getByText('Quality Loop'));
        expect(onStartQualityLoop).toHaveBeenCalled();
    });

    it('renders the scan progress indicator while scanning', () => {
        renderWithTheme(
            <AppHeader
                {...makeProps({ scanning: true, scanProgress: { analyzed: 4, total: 10 }, scanPct: 40 })}
            />,
        );
        expect(screen.queryByText('Scan all')).not.toBeInTheDocument();
    });

    it('hides Score when overallRating is null', () => {
        renderWithTheme(<AppHeader {...makeProps({ overallRating: null })} />);
        expect(screen.queryByText('Score')).not.toBeInTheDocument();
    });

    it('toggles the theme button label', () => {
        renderWithTheme(<AppHeader {...makeProps()} />);
        const themeButton = screen.getByTitle('Toggle theme');
        const initialLabel = themeButton.textContent;
        fireEvent.click(themeButton);
        expect(themeButton.textContent).not.toBe(initialLabel);
    });
});
