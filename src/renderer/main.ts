// Step 0 placeholder renderer. Step 1 mounts the first xterm.js pane here.
const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.textContent = 'Cerberus';
  app.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'height:100vh',
    'margin:0',
    'font-family:system-ui,sans-serif',
    'font-size:2rem',
    'color:#e0e0e0',
    'background:#1a1a1a'
  ].join(';');
}
