# Agent Framework - TypeScript 迁移项目

## 快速开始

### 1. 安装依赖

```bash
cd agents
npm install  # 或 pnpm install
```

### 2. 运行测试

```bash
# 运行所有测试
pnpm test

# 运行单个模块测试
pnpm test:util        # util 模块
pnpm test:core        # core 模块
pnpm test:messenger   # messenger 模块
pnpm test:sse         # sse 模块

# 运行单个测试文件（无需配置文件）
pnpm test:one -- test/util/extract.test.ts
```

### 3. 开发模式

```bash
# 监视模式运行测试
pnpm dev
```

---

## 单文件测试与调试

### 方法 1：使用命令行

```bash
# 测试单个文件
pnpm test:one -- test/util/extract.test.ts

# 调试单个文件
node scripts/debug.mjs test test/util/extract.test.ts
```

### 方法 2：VS Code 调试

1. 打开 `test/util/extract.test.ts`
2. 按 `F5` 或在运行面板选择 **"Test: Extract"**
3. 设置断点，直接调试

### 方法 3：直接运行 TypeScript

```bash
# 直接运行模块（不带测试）
node scripts/debug.mjs run src/util/extract.ts
```

---

## 项目结构

```
agents/
├── src/                    # 源代码
│   ├── index.ts            # 主入口
│   ├── core/               # 核心类型
│   │   ├── types.ts
│   │   ├── ClaudeEvent.ts
│   │   └── ClaudeHealth.ts
│   ├── util/               # 工具函数
│   │   ├── extract.ts      # ⭐ Generator 提取工具
│   │   └── JsonData.ts
│   ├── messenger/          # 消息处理
│   ├── sse/                # SSE 通信
│   └── cli/                # 命令行工具
│
├── test/                   # 测试文件（与 src 一一对应）
│   ├── util/
│   │   └── extract.test.ts
│   └── ...
│
├── scripts/
│   └── debug.mjs           # 调试脚本
│
├── package.json            # npm 配置
├── vite.config.ts          # Vite 构建/测试配置
├── tsconfig.json           # TypeScript 配置
└── .vscode/
    └── launch.json         # VS Code 调试配置
```

---

## 核心模块说明

### Extract 工具

从 Generator 提取返回值（Python `extract` 的 TypeScript 实现）：

```typescript
import { Extract, extract } from '@util/extract.js';

function* gen(): Generator<number, string, unknown> {
  yield 1;
  yield 2;
  return 'done';
}

// 收集所有 yield 的值和 return 值
const result = new Extract(gen()).collect();
console.log(result.generated); // [1, 2]
console.log(result.returns);   // 'done'
```

---

## 添加新模块

### 1. 创建源文件

```typescript
// src/util/myModule.ts

export class MyClass {
  // 你的代码
}
```

### 2. 创建测试文件

```typescript
// test/util/myModule.test.ts

import { describe, it, expect } from 'vitest';
import { MyClass } from '../../src/util/myModule.js';

describe('MyClass', () => {
  it('should work', () => {
    expect(new MyClass()).toBeDefined();
  });
});
```

### 3. 更新导出

```typescript
// src/util/index.ts
export { MyClass } from './myModule.js';
```

### 4. 运行测试

```bash
pnpm test:one -- test/util/myModule.test.ts
```

---

## 命令速查表

| 命令 | 说明 |
|------|------|
| `pnpm test` | 运行所有测试 |
| `pnpm test:ui` | 带 UI 的测试界面 |
| `pnpm test:one -- <file>` | 运行单个测试文件 |
| `pnpm coverage` | 生成覆盖率报告 |
| `pnpm typecheck` | 类型检查 |
| `pnpm build` | 构建发布版本 |

---

## VS Code 调试配置

可用的调试配置：

- **Vitest: Run Current File** - 运行当前文件测试
- **Vitest: Debug Current File** - 调试当前文件测试
- **Vitest: Watch Mode** - 监视模式
- **Run TypeScript** - 直接运行 TypeScript
- **Test: Extract** - 快速测试 extract 模块
- **Test: ClaudeEvent** - 快速测试 ClaudeEvent 模块

---

## 下一步

1. 查看 [TS_STRUCTURE.md](./TS_STRUCTURE.md) 了解完整架构
2. 查看 [TECHNICAL_ANALYSIS.md](./TECHNICAL_ANALYSIS.md) 了解技术迁移方案
3. 从 `extract.ts` 开始迁移核心工具
