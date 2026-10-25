import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Dev serves modules and the HMR socket inline/localhost, which the strict
// production policy in index.html forbids; relax it only in `vite serve`.
const DEV_CSP =
  "default-src 'self' 'unsafe-inline' ws://localhost:* http://localhost:*; img-src 'self' data:";

function devCsp(): Plugin {
  return {
    name: 'tian-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      const meta =
        /http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]*)"/.exec(
          html,
        );
      if (!meta) throw new Error('Content-Security-Policy meta tag not found');
      return html.replace(meta[1], DEV_CSP);
    },
  };
}

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), tailwindcss(), devCsp()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
