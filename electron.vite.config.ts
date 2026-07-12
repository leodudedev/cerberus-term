import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

// Flat single-package layout: main / preload / renderer all under src/.
// A future Tauri swap replaces the main+preload backing of TerminalBridge only.
export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    build: {
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
});
