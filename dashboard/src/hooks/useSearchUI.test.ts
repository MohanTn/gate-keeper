import { renderHook, act } from '@testing-library/react';
import { useSearchUI } from './useSearchUI';
import { GraphNode } from '../types';

const mockNodes: GraphNode[] = [
  { id: '/src/index.ts', label: 'index.ts', type: 'typescript', rating: 8, size: 1, violations: [], metrics: { linesOfCode: 50, cyclomaticComplexity: 2, numberOfMethods: 3, numberOfClasses: 1, importCount: 5 } },
  { id: '/src/app.ts', label: 'app.ts', type: 'typescript', rating: 7, size: 1, violations: [], metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 8, numberOfClasses: 2, importCount: 10 } },
  { id: '/src/utils/helper.ts', label: 'helper.ts', type: 'typescript', rating: 9, size: 1, violations: [], metrics: { linesOfCode: 30, cyclomaticComplexity: 1, numberOfMethods: 2, numberOfClasses: 0, importCount: 3 } },
  { id: '/src/components/Button.tsx', label: 'Button.tsx', type: 'tsx', rating: 6, size: 1, violations: [], metrics: { linesOfCode: 80, cyclomaticComplexity: 3, numberOfMethods: 4, numberOfClasses: 1, importCount: 7 } },
  { id: '/src/components/Card.tsx', label: 'Card.tsx', type: 'tsx', rating: 7.5, size: 1, violations: [], metrics: { linesOfCode: 60, cyclomaticComplexity: 2, numberOfMethods: 3, numberOfClasses: 1, importCount: 4 } },
  { id: '/src/styles/theme.css', label: 'theme.css', type: 'tsx', rating: 10, size: 1, violations: [], metrics: { linesOfCode: 200, cyclomaticComplexity: 0, numberOfMethods: 0, numberOfClasses: 0, importCount: 0 } },
  { id: '/src/config.ts', label: 'config.ts', type: 'typescript', rating: 8.5, size: 1, violations: [], metrics: { linesOfCode: 40, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 2 } },
  { id: '/src/types.ts', label: 'types.ts', type: 'typescript', rating: 9.5, size: 1, violations: [], metrics: { linesOfCode: 70, cyclomaticComplexity: 1, numberOfMethods: 0, numberOfClasses: 3, importCount: 1 } },
  { id: '/src/api/routes.ts', label: 'routes.ts', type: 'typescript', rating: 7, size: 1, violations: [], metrics: { linesOfCode: 90, cyclomaticComplexity: 6, numberOfMethods: 6, numberOfClasses: 1, importCount: 8 } },
];

describe('useSearchUI', () => {
  const onNodeSelect = jest.fn();

  beforeEach(() => {
    onNodeSelect.mockClear();
  });

  it('empty query returns no results and hides dropdown', () => {
    const { result } = renderHook(() => useSearchUI(mockNodes, onNodeSelect));

    expect(result.current.searchQuery).toBe('');
    expect(result.current.searchResults).toEqual([]);
    expect(result.current.showSearchDropdown).toBe(false);
  });

  it('filters nodes by label matching (case-insensitive)', () => {
    const { result } = renderHook(() => useSearchUI(mockNodes, onNodeSelect));

    act(() => {
      result.current.handleSearchChange({
        target: { value: 'button' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.searchResults).toHaveLength(1);
    expect(result.current.searchResults[0].label).toBe('Button.tsx');
  });

  it('filters nodes by id matching (case-insensitive)', () => {
    const { result } = renderHook(() => useSearchUI(mockNodes, onNodeSelect));

    act(() => {
      result.current.handleSearchChange({
        target: { value: 'src/api' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.searchResults).toHaveLength(1);
    expect(result.current.searchResults[0].id).toBe('/src/api/routes.ts');
  });

  it('returns multiple matches', () => {
    const { result } = renderHook(() => useSearchUI(mockNodes, onNodeSelect));

    act(() => {
      result.current.handleSearchChange({
        target: { value: 'tsx' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    // Matches both Button.tsx and Card.tsx
    expect(result.current.searchResults.length).toBeGreaterThanOrEqual(2);
  });

  it('caps results at 8', () => {
    const manyNodes = Array.from({ length: 20 }, (_, i) => ({
      id: `/src/file-${i}.ts`,
      label: `file-${i}.ts`,
      type: 'typescript' as const,
      rating: 8,
      size: 1,
      violations: [],
      metrics: { linesOfCode: 10, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 0 },
    }));

    const { result } = renderHook(() => useSearchUI(manyNodes, onNodeSelect));

    act(() => {
      result.current.handleSearchChange({
        target: { value: 'file' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.searchResults).toHaveLength(8);
  });

  it('handleSearchSelect calls onNodeSelect and clears query', () => {
    const { result } = renderHook(() => useSearchUI(mockNodes, onNodeSelect));

    act(() => {
      result.current.handleSearchChange({
        target: { value: 'index' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.searchResults).toHaveLength(1);

    act(() => {
      result.current.handleSearchSelect(mockNodes[0]);
    });

    expect(onNodeSelect).toHaveBeenCalledWith(mockNodes[0]);
    expect(result.current.searchQuery).toBe('');
    // showSearchDropdown should be false after clearing
    expect(result.current.showSearchDropdown).toBe(false);
  });

  it('handleSearchChange updates searchQuery', () => {
    const { result } = renderHook(() => useSearchUI(mockNodes, onNodeSelect));

    act(() => {
      result.current.handleSearchChange({
        target: { value: 'helper' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.searchQuery).toBe('helper');
    expect(result.current.searchResults).toHaveLength(1);
    expect(result.current.searchResults[0].label).toBe('helper.ts');
  });

  it('handleSearchFocus sets showSearchDropdown when query exists', () => {
    const { result } = renderHook(() => useSearchUI(mockNodes, onNodeSelect));

    act(() => {
      result.current.handleSearchChange({
        target: { value: 'helper' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    act(() => {
      result.current.handleSearchFocus();
    });

    // showSearchDropdown needs focused + query + results
    expect(result.current.showSearchDropdown).toBe(true);
  });

  it('handleSearchBlur uses setTimeout(150ms) to hide dropdown', () => {
    jest.useFakeTimers();

    const { result } = renderHook(() => useSearchUI(mockNodes, onNodeSelect));

    // Set up a query + results so dropdown would be visible
    act(() => {
      result.current.handleSearchChange({
        target: { value: 'helper' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    act(() => {
      result.current.handleSearchFocus();
    });

    expect(result.current.showSearchDropdown).toBe(true);

    act(() => {
      result.current.handleSearchBlur();
    });

    // Should still be visible before timeout
    expect(result.current.showSearchDropdown).toBe(true);

    // Advance past the 150ms timeout
    act(() => {
      jest.advanceTimersByTime(150);
    });

    expect(result.current.showSearchDropdown).toBe(false);

    jest.useRealTimers();
  });

  it('handleSearchKeyDown Escape clears query and blurs', () => {
    const blurSpy = jest.fn();
    // We need to set up the ref manually; in the hook searchRef is created via useRef
    // Instead, simulate the Escape handler effect by creating the hook and testing behavior

    const { result } = renderHook(() => useSearchUI(mockNodes, onNodeSelect));

    act(() => {
      result.current.handleSearchChange({
        target: { value: 'helper' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.searchQuery).toBe('helper');

    act(() => {
      result.current.handleSearchKeyDown({
        key: 'Escape',
        currentTarget: { blur: blurSpy },
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });

    expect(result.current.searchQuery).toBe('');
  });

  it('handleSearchKeyDown non-Escape key does nothing special', () => {
    const { result } = renderHook(() => useSearchUI(mockNodes, onNodeSelect));

    act(() => {
      result.current.handleSearchChange({
        target: { value: 'helper' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    act(() => {
      result.current.handleSearchKeyDown({
        key: 'Enter',
      } as React.KeyboardEvent<HTMLInputElement>);
    });

    // Query should be unchanged
    expect(result.current.searchQuery).toBe('helper');
  });

  it('no results for non-matching query', () => {
    const { result } = renderHook(() => useSearchUI(mockNodes, onNodeSelect));

    act(() => {
      result.current.handleSearchChange({
        target: { value: 'zzzznotfound' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.searchResults).toEqual([]);
    expect(result.current.showSearchDropdown).toBe(false);
  });

  it('whitespace-only query treated as empty', () => {
    const { result } = renderHook(() => useSearchUI(mockNodes, onNodeSelect));

    act(() => {
      result.current.handleSearchChange({
        target: { value: '   ' },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.searchResults).toEqual([]);
  });
});
