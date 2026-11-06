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
    // NSH uses signals and compiler-provided If/Each, not the React runtime.
    // Its components are checked by nsh check and the native interaction tests.
    files: ['.vite/**', 'dist/**', 'out/**', 'crates/tian-nsh/**'],
  },
  rules: {
    'react-doctor/use-lazy-motion': 'off',
  },
});
