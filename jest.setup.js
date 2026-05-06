// Suppress console output during tests to keep logs clean
// but still allow test failures to surface via console
const originalError = console.error;
const originalLog = console.log;

beforeAll(() => {
  // Suppress console.error and console.log during tests
  console.error = jest.fn();
  console.log = jest.fn();
});

afterAll(() => {
  // Restore original console methods
  console.error = originalError;
  console.log = originalLog;
});
