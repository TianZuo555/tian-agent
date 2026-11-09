import { defineConfig } from 'react-doctor/api';

/**
 * React Doctor settings for this repo.
 *
 * `use-lazy-motion` stays off: the app ships inside Electron and loads from
 * disk, so deferring a 30 kB motion feature bundle buys nothing, while
 * `LazyMotion` + async features would flash unanimated UI on first paint.
 * Every other rule runs at its recommended severity.
 */
export default defineConfig({
  ignore: {
    // Build output, not source: the renderer bundle and the service payload.
    // The NSH demo is a design mockup with its own compiler and globals, not
    // part of the Electron renderer (docs/design/nsh-demo/README.md).
    files: ['.vite/**', 'dist/**', 'out/**', 'docs/design/nsh-demo/**'],
  },
  rules: {
    'react-doctor/use-lazy-motion': 'off',
  },
});
