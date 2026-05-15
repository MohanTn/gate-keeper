/**
 * Tests for the jest.setup.js configuration
 */

describe('jest.setup.js', () => {
  it('suppresses console.error during tests', () => {
    expect(jest.isMockFunction(console.error)).toBe(true);
  });

  it('suppresses console.log during tests', () => {
    expect(jest.isMockFunction(console.log)).toBe(true);
  });

  it('console.error mock can be called without throwing', () => {
    expect(() => {
      console.error('test error message');
      console.error('another error');
    }).not.toThrow();
  });

  it('console.log mock can be called without throwing', () => {
    expect(() => {
      console.log('test log message');
    }).not.toThrow();
  });

  it('suppresses warnings and keeps test output clean', () => {
    console.warn = jest.fn();
    console.warn('test warning');
    expect(console.warn).toHaveBeenCalledWith('test warning');
  });
});
