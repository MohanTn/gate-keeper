// Dashboard-specific jest setup
require('@testing-library/jest-dom');

// JSDOM does not implement ResizeObserver — used by FileListDrawer for auto-sizing
global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
};