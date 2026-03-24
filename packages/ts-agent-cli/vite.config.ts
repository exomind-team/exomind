// vite.config.ts - 构建 + 测试配置
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    // TypeScript 路径别名支持（如 @/util -> src/util）
    tsconfigPaths({
      root: __dirname,
    }),
  ],

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@util': resolve(__dirname, 'src/util'),
      '@messenger': resolve(__dirname, 'src/messenger'),
      '@sse': resolve(__dirname, 'src/sse'),
      '@cli': resolve(__dirname, 'src/cli'),
    },
  },

  // 测试配置
  test: {
    // 全局 API（不用每次 import）
    globals: true,

    // 测试环境
    environment: 'node',

    // 测试文件匹配模式
    include: [
      'test/**/*.test.ts',
    ],

    // 排除目录
    exclude: [
      'node_modules',
      'dist',
      '.git',
    ],

    // Coverage 配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/index.ts',  // 主入口不单独覆盖
      ],
    },

    // 测试超时
    testTimeout: 10000,

    // 线程数
    threads: true,

    // 安静模式（CI 环境）
    silent: false,

    // 输出格式
    reporter: 'verbose',

    // 源文件映射
    sourceMap: true,
  },

  // 构建配置
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'AgentFramework',
      fileName: (format) => `index.${format}.js`,
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      // 外部依赖（不打包）
      external: [
        'fs',
        'path',
        'child_process',
        'events',
        'stream',
        'readline',
        'http',
        'https',
      ],
      output: {
        // 确保外部依赖的格式
        globals: {
          fs: 'fs',
          path: 'path',
          child_process: 'child_process',
          events: 'events',
        },
      },
    },
    minify: false,  // 开发时关闭压缩
  },

  // 开发服务器
  server: {
    port: 3000,
    open: false,
  },
});
