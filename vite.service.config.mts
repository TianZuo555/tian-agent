import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig((environment) => {
  const forge = 'forgeConfig' in environment;
  return {
    resolve: { conditions: ['node'], mainFields: ['module', 'main'] },
    build: {
      target: 'node24',
      outDir: forge ? '.vite/build' : 'dist/service',
      emptyOutDir: !forge,
      lib: {
        entry: 'src/service/entry.ts',
        fileName: () => 'service.cjs',
        formats: ['cjs'],
      },
      rolldownOptions: {
        platform: 'node',
        external: [...builtinModules, /^node:/],
      },
    },
  };
});
