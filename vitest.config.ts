import { defineConfig } from 'vitest/config';

// Unit tests only, over the DOM-free / Electron-free logic in src/core and the
// pure renderer modules. Nothing here needs a browser or an Electron runtime;
// the two renderer suites stub the one global they touch (localStorage).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
});
