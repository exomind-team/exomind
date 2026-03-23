/**
 * 调试脚本 - 支持单文件独立调试
 *
 * 使用方法:
 *   # 调试单个测试文件
 *   pnpm debug:test test/util/extract.test.ts
 *
 *   # 调试单个模块（不带测试）
 *   pnpm debug:run src/util/extract.ts
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { argv } from 'process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(msg: string, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

async function main() {
  const args = argv.slice(2);
  const mode = args[0];  // 'test' | 'run'

  if (!mode) {
    printHelp();
    return;
  }

  const targetPath = args[1];
  if (!targetPath) {
    console.error('请指定目标文件路径');
    printHelp();
    return;
  }

  // 解析绝对路径
  const absolutePath = resolve(process.cwd(), targetPath);
  log(`\n🔍 目标文件: ${absolutePath}\n`, colors.blue);

  switch (mode) {
    case 'test':
      await runTest(absolutePath);
      break;
    case 'run':
      await runDirectly(absolutePath);
      break;
    default:
      console.error(`未知模式: ${mode}`);
      printHelp();
  }
}

async function runTest(filePath: string) {
  log('📋 运行测试...\n', colors.yellow);

  const vitest = spawn('npx', [
    'vitest',
    'run',
    filePath,
    '--reporter=verbose',
    '--no-color',  // CI 环境
  ], {
    stdio: 'inherit',
    cwd: __dirname,
  });

  vitest.on('exit', (code) => {
    process.exit(code || 0);
  });
}

async function runDirectly(filePath: string) {
  log('🚀 直接运行 TypeScript...\n', colors.yellow);

  // 使用 tsx 直接运行（比 ts-node 快）
  const child = spawn('npx', ['tsx', filePath], {
    stdio: 'inherit',
    cwd: __dirname,
    env: {
      ...process.env,
      TS_NODE_ESM: 'true',
      NODE_OPTIONS: '--loader ts-node/esm --experimental-specifier-resolution=node',
    },
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

function printHelp() {
  console.log(`
用法:
  pnpm debug <模式> <文件路径>

模式:
  test    运行单个测试文件（*.test.ts）
  run     直接运行 TypeScript 文件

示例:
  pnpm debug test test/util/extract.test.ts
  pnpm debug run src/util/extract.ts

选项:
  --help  显示帮助信息
`);
}

main().catch(console.error);
