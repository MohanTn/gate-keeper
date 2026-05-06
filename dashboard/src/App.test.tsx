import React from 'react';
import { render } from '@testing-library/react';
import App from './App';

jest.mock('./components/VisGraphView', () => ({ VisGraphView: () => <div data-testid="vis-graph" /> }));
jest.mock('./components/DetailPanel', () => ({ DetailPanel: () => <div data-testid="detail-panel" /> }));
jest.mock('./components/FileListDrawer', () => ({ FileListDrawer: () => <div data-testid="file-list" /> }));
jest.mock('./components/ViolationsPanel', () => ({ ViolationsPanel: () => <div data-testid="violations" /> }));
jest.mock('./components/FilterPanel', () => ({ FilterPanel: () => <div data-testid="filter-panel" /> }));
jest.mock('./components/AppHeader', () => ({ AppHeader: () => <header data-testid="app-header" /> }));
jest.mock('./components/HeaderWidgets', () => ({ RepoLoadingOverlay: () => <div data-testid="loading" />, ScanProgressBar: () => <div data-testid="scan-bar" /> }));
jest.mock('./components/AppContent', () => ({ AppContent: () => <div data-testid="app-content" />, RepoOverlay: () => <div data-testid="repo-overlay" /> }));
jest.mock('./hooks', () => ({
    useWebSocketConnection: () => ({ graphData: { nodes: [], edges: [] }, wsStatus: 'connected', scanProgress: null, scanning: false, setScanning: jest.fn(), lastScan: null, setLastScan: jest.fn(), handleScanAll: jest.fn(), repoLoading: false }),
    useRepoSelection: () => ({ repos: [], selectedRepo: null, showRepoSelector: false, setShowRepoSelector: jest.fn(), handleRepoSelect: jest.fn(), refreshRepos: jest.fn() }),
    useNodeHandlers: () => ({ selectedNode: null, handleClearSelection: jest.fn(), handleNodeSelect: jest.fn() }),
    useExcludePatterns: () => ({ filteredGraphData: { nodes: [], edges: [] }, graphData: { nodes: [], edges: [] }, patterns: [], addPattern: jest.fn(), removePattern: jest.fn(), scanExcludePatterns: null }),
    useSearchUI: () => ({ searchQuery: '', searchRef: { current: null }, searchResults: [], showSearchDropdown: false, handleSearchSelect: jest.fn(), handleSearchChange: jest.fn(), handleSearchFocus: jest.fn(), handleSearchBlur: jest.fn(), handleSearchKeyDown: jest.fn() }),
    usePanelActions: () => ({ showFileList: false, showFilterPanel: false, showViolationsPanel: false, handleShowRepoSelector: jest.fn(), handleFileListOpen: jest.fn(), handleFileListSelect: jest.fn(), handleFileListClose: jest.fn(), handleToggleFilterPanel: jest.fn(), handleCloseFilterPanel: jest.fn(), handleToggleViolationsPanel: jest.fn(), handleCloseViolationsPanel: jest.fn() }),
}));
jest.mock('./ThemeContext', () => ({
    useTheme: () => ({ T: { bg: '#0B1120', border: '#1E293B', borderBright: '#334155', panel: '#1E293B', text: '#F1F5F9', textMuted: '#94A3B8', textDim: '#64748B', textFaint: '#475569', accent: '#3B82F6', accentDim: '#1E3A5F', red: '#EF4444', green: '#22C55E', elevated: '#1E293B' }, mode: 'dark', toggleTheme: jest.fn() }),
}));

describe('App', () => {
    it('renders the app without crashing', () => {
        const { getByTestId } = render(<App />);
        expect(getByTestId('app-header')).toBeInTheDocument();
        expect(getByTestId('app-content')).toBeInTheDocument();
    });
});
