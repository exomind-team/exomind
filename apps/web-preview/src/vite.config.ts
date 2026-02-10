import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@exomind/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@exomind/core': path.resolve(__dirname, '../../packages/core/src'),
      '@exomind/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  optimizeDeps: {
    include: ['@exomind/shared', '@exomind/core', '@exomind/ui'],
  },
});
