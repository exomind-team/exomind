import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config';

// This acceptance session serves one production-Beta fixture, not the legacy
// app's other HTML entrypoints and their unrelated dependency graph.
export default defineConfig(async environment => mergeConfig(
  await (typeof base === 'function' ? base(environment) : base),
  { cacheDir: 'node_modules/.vite-beta-workspace', optimizeDeps: { entries: ['tests/e2e/fixtures/beta-workspace.html'] } },
));
