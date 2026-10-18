import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    target: 'node24',
    outDir: 'dist/updater',
    emptyOutDir: true,
    lib: {
      entry: 'src/desktop/update-entry.ts',
      fileName: () => 'updater.cjs',
      formats: ['cjs'],
    },
    rolldownOptions: {
      platform: 'node',
      external: [...builtinModules, /^node:/],
    },
  },
});
