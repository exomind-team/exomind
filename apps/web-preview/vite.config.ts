import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['events'],
      globals: {
        global: true,
      },
    }),
  ],
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
});
