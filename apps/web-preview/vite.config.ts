import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@exomind/core': path.resolve(__dirname, '../../packages/core/src'),
      '@exomind/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@exomind/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  build: {
    target: 'esnext',
  },
  // Let Vite handle CommonJS modules through esbuild
  esbuild: {
    // This helps with CommonJS to ESM conversion
    supported: {
      'top-level-await': true,
    },
  },
  // Optimize deps to handle CommonJS
  optimizeDeps: {
    include: ['@exomind/core', '@exomind/ui', '@exomind/shared'],
    esbuildOptions: {
      // Enable ESM output for dependencies
      mainFields: ['module', 'main'],
    },
  },
});
