import * as hooks from './index';

describe('hooks index exports', () => {
  it('exports all expected hooks', () => {
    const expectedExports = [
      'useWebSocketConnection',
      'useRepoSelection',
      'useNodeHandlers',
      'useExcludePatterns',
      'useSearchUI',
      'usePanelActions',
      'useClearData',
      'useGraphData',
      'useAppMetrics',
      'useAppState',
    ];

    for (const name of expectedExports) {
      expect(hooks).toHaveProperty(name);
      expect(typeof (hooks as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('exports the correct number of hooks', () => {
    // 10 hooks total — if new ones are added, update this test
    const hookNames = Object.keys(hooks).filter(
      key => key.startsWith('use') && typeof (hooks as Record<string, unknown>)[key] === 'function',
    );
    expect(hookNames.length).toBe(10);
  });
});
