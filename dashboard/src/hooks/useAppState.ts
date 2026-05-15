import { useState } from 'react';
import { useRepoSelection } from './useRepoSelection';
import { useNodeHandlers } from './useNodeHandlers';
import { useSearchUI } from './useSearchUI';
import { usePanelActions } from './usePanelActions';
import { useGraphData } from './useGraphData';
import { useAppMetrics } from './useAppMetrics';
import { GraphNode, RepoInfo } from '../types';

interface UseAppStateReturn {
  view: 'graph' | 'quality';
  setView: (v: 'graph' | 'quality') => void;
  repos: RepoInfo[];
  selectedRepo: string | null;
  showRepoSelector: boolean;
  setShowRepoSelector: React.Dispatch<React.SetStateAction<boolean>>;
  handleRepoSelect: (repo: string) => void;
  handleRepoDelete: (repoRoot: string) => void;
  refreshRepos: () => void;
  graphData: ReturnType<typeof useGraphData>['graphData'];
  filteredGraphData: ReturnType<typeof useGraphData>['filteredGraphData'];
  patterns: ReturnType<typeof useGraphData>['patterns'];
  addPattern: ReturnType<typeof useGraphData>['addPattern'];
  removePattern: ReturnType<typeof useGraphData>['removePattern'];
  scanExcludePatterns: ReturnType<typeof useGraphData>['scanExcludePatterns'];
  wsStatus: ReturnType<typeof useGraphData>['wsStatus'];
  scanProgress: ReturnType<typeof useGraphData>['scanProgress'];
  scanning: ReturnType<typeof useGraphData>['scanning'];
  setScanning: ReturnType<typeof useGraphData>['setScanning'];
  lastScan: ReturnType<typeof useGraphData>['lastScan'];
  setLastScan: ReturnType<typeof useGraphData>['setLastScan'];
  handleScanAll: ReturnType<typeof useGraphData>['handleScanAll'];
  repoLoading: ReturnType<typeof useGraphData>['repoLoading'];
  selectedNode: GraphNode | null;
  handleClearSelection: () => void;
  handleNodeSelect: (node: GraphNode) => void;
  searchQuery: string;
  searchRef: React.RefObject<HTMLInputElement>;
  searchResults: GraphNode[];
  showSearchDropdown: boolean;
  handleSearchSelect: (node: GraphNode) => void;
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSearchFocus: () => void;
  handleSearchBlur: () => void;
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  showFileList: boolean;
  showFilterPanel: boolean;
  showViolationsPanel: boolean;
  handleShowRepoSelector: () => void;
  handleFileListOpen: () => void;
  handleFileListSelect: (node: GraphNode) => void;
  handleFileListClose: () => void;
  handleToggleFilterPanel: () => void;
  handleCloseFilterPanel: () => void;
  handleToggleViolationsPanel: () => void;
  handleCloseViolationsPanel: () => void;
  handleClear: () => Promise<void>;
  totalViolations: number;
  overallRating: number | null;
  currentRepoLabel: string | null;
  scanPct: number | null;
}

export function useAppState(): UseAppStateReturn {
  const [view, setView] = useState<'graph' | 'quality'>('graph');

  const { repos, selectedRepo, showRepoSelector, setShowRepoSelector, handleRepoSelect, handleRepoDelete, refreshRepos } = useRepoSelection();
  const {
    graphData, filteredGraphData, patterns, addPattern, removePattern, scanExcludePatterns,
    wsStatus, scanProgress, scanning, setScanning, lastScan, setLastScan, handleScanAll, repoLoading,
  } = useGraphData(selectedRepo, refreshRepos);
  const { selectedNode, handleClearSelection, handleNodeSelect } = useNodeHandlers(filteredGraphData);
  const searchUI = useSearchUI(filteredGraphData.nodes, handleNodeSelect);
  const panelActions = usePanelActions(handleClearSelection, handleNodeSelect, setShowRepoSelector, filteredGraphData, setScanning, setLastScan, selectedRepo, repos);
  const { totalViolations, overallRating, currentRepoLabel, scanPct } = useAppMetrics(filteredGraphData, selectedRepo, repos, scanProgress);

  return {
    view, setView,
    repos, selectedRepo, showRepoSelector, setShowRepoSelector, handleRepoSelect, handleRepoDelete, refreshRepos,
    graphData, filteredGraphData, patterns, addPattern, removePattern, scanExcludePatterns,
    wsStatus, scanProgress, scanning, setScanning, lastScan, setLastScan, handleScanAll, repoLoading,
    selectedNode, handleClearSelection, handleNodeSelect,
    ...searchUI,
    ...panelActions,
    totalViolations, overallRating, currentRepoLabel, scanPct,
  };
}
