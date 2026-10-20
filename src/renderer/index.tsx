import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { reportClientError } from './report-error';
import { initTheme } from './theme';
import '../index.css';

// Resolve the stored appearance before the first paint so neither the boot
// screen nor the shell flashes the wrong theme.
initTheme();

// Window-level failures happen outside React's tree; record them before the
// default console noise disappears with the window.
window.addEventListener('error', (event) => {
  reportClientError('renderer.window', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  reportClientError('renderer.promise', event.reason);
});

const root = createRoot(document.getElementById('root')!);
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
