# Playwright E2E Setup

本文档用于全新克隆仓库后的 E2E 初始化。默认路径是 PC（Windows/macOS/Linux），Termux 为可选路径。

## 1) PC 默认流程（推荐）

### 先决条件

- Bun
- Node.js 20+（建议）

### 首次克隆后的最小步骤

```bash
# 1. 安装根依赖
bun install

# 2. 安装 Playwright Chromium（仅首次需要）
bun run test:e2e:setup

# 3. 先跑一条烟测（更快）
bun run test:e2e:smoke

# 4. 跑完整 E2E
bun run test:e2e
```

说明：

- 当前默认使用 Playwright 自带 Chromium，不要求本机预装 Chrome。
- `issue27` 用例会拉起 `server/` 同步服务；如果要跑该用例，先执行：

```bash
bun install --cwd server --omit optional
bun run test:e2e:issue27
```

## 2) Termux 可选流程

### 先决条件

- Termux
- Bun
- Node.js

### 安装系统 Chromium

```bash
pkg install -y x11-repo chromium
```

### 环境变量

```bash
export PLAYWRIGHT_TERMUX=1
export PLAYWRIGHT_BROWSERS_PATH=0
export CHROMIUM_PATH=/data/data/com.termux/files/usr/bin/chromium-browser
```

### 执行测试

```bash
# 首次可先做配置检查
bun run test:e2e -- --list

# 烟测
bun run test:e2e:smoke

# 全量
bun run test:e2e:termux
```

## 3) 常见问题

1. 报错 `Executable doesn't exist`  
先执行 `bun run test:e2e:setup` 安装 Playwright Chromium。

2. 报错 `Unsupported platform: android`  
确认 Termux 场景设置了 `PLAYWRIGHT_BROWSERS_PATH=0`，并使用 `PLAYWRIGHT_TERMUX=1`。

3. `issue27` 启动失败  
确认 `server` 依赖已安装：`bun install --cwd server --omit optional`。
