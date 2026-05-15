import React from 'react';
import { act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Setup DOM ───────────────────────────────────────────────────────────────

beforeAll(() => {
  // Create root element in jsdom
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
});

afterAll(() => {
  const root = document.getElementById('root');
  if (root) document.body.removeChild(root);
});

// ── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('./styles.css', () => ({}), { virtual: true });

jest.mock('./App', () => () => <div data-testid="app-component">App Component</div>);

jest.mock('./ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="theme-provider">{children}</div>,
  useTheme: () => ({ T: {}, mode: 'dark', toggleTheme: jest.fn() }),
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Main Dashboard entry point', () => {
  it('renders the App into the DOM without crashing', async () => {
    // Dynamic import triggers createRoot().render()
    await act(async () => {
      await import('./main');
    });

    // After the import runs, createRoot should have rendered into #root
    const rootEl = document.getElementById('root');
    expect(rootEl).toBeInTheDocument();
    expect(rootEl).not.toBeEmptyDOMElement();
  });

  it('finds the root div in the DOM', () => {
    const root = document.getElementById('root');
    expect(root).not.toBeNull();
    expect(root!.tagName).toBe('DIV');
  });

  it('root is child of body', () => {
    const root = document.getElementById('root');
    expect(root?.parentElement).toBe(document.body);
  });
});
