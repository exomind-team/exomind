import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const isTermuxRuntime =
  Boolean(process.env.TERMUX_VERSION)
  || process.platform === 'android'
  || Boolean(process.env.ANDROID_ROOT);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'happy-dom',
    maxWorkers: isTermuxRuntime ? 1 : undefined,
    minWorkers: isTermuxRuntime ? 1 : undefined,
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    setupFiles: ['tests/setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'tests/e2e/**',
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.spec.ts',
        'src/**/*.spec.tsx',
        'src/main.tsx',
        'src/App.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
});
