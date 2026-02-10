import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@exomind/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@exomind/ui': path.resolve(__dirname, '../../packages/ui/src'),
    },
  },
});
