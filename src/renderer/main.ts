import { mountTerminal } from './Terminal.js';

// Step 1: full-window single terminal.
const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.style.cssText = 'width:100vw;height:100vh;background:#1a1a1a';
  void mountTerminal(app);
}
