# Issue #79 Port Env Config Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 ExoMind 在同一台机器的多个 worktree 中可通过环境变量配置端口，避免 Vite/PouchDB/ASR 端口冲突。

**Architecture:** 新增统一端口解析模块，所有开发入口（Vite 配置、PowerShell 启动脚本、前端默认同步地址、ASR 默认地址、PouchDB 服务配置）都从同一组环境变量读取。默认值保持向后兼容，且支持无效值回退。

**Tech Stack:** Vite 6, React 18, Bun, Node.js ESM, PowerShell, Vitest, GitHub CLI

---

### Task 1: 端口解析模块与失败测试（TDD Red）

**Files:**
- Create: `src/config/port-env.ts`
- Create: `tests/config/port-env.test.ts`

**Step 1: 写失败测试（端口解析规则）**

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PORTS,
  parsePort,
  resolveDevPorts,
  resolveSyncServerUrl,
  resolveAsrServerUrl,
} from '@/config/port-env';

describe('port env', () => {
  it('parsePort: 非法值回退默认值', () => {
    expect(parsePort(undefined, 1420)).toBe(1420);
    expect(parsePort('abc', 1420)).toBe(1420);
    expect(parsePort('70000', 1420)).toBe(1420);
  });
});
```

**Step 2: 运行测试确认失败**

Run: `bun run test tests/config/port-env.test.ts --run`  
Expected: FAIL，报 `Cannot find module '@/config/port-env'`

**Step 3: 最小实现让测试可通过**

在 `src/config/port-env.ts` 实现：
- `DEFAULT_PORTS`：`web=1420`、`hmr=1421`、`pouchdb=6984`、`asr=1949`
- `parsePort(value, fallback)`：只接受 `1..65535` 整数
- `resolveDevPorts(env)`：读取 `EXOMIND_WEB_PORT` / `EXOMIND_HMR_PORT`
- `resolveSyncServerUrl(env)`：优先 `VITE_SYNC_SERVER_URL`，否则用 `EXOMIND_POUCHDB_PORT` 组装
- `resolveAsrServerUrl(env)`：优先 `VITE_ASR_SERVER_URL`，否则用 `EXOMIND_ASR_PORT` 组装

**Step 4: 运行测试确认通过**

Run: `bun run test tests/config/port-env.test.ts --run`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/port-env.ts tests/config/port-env.test.ts
git commit -m "test+feat: add shared port env resolver"
```

### Task 2: 接入 Vite/服务端/前端默认地址（TDD Green）

**Files:**
- Modify: `vite.config.ts`
- Modify: `server/config.js`
- Modify: `src/components/Chat/ChatPage.tsx`
- Modify: `src/ui/pages/SyncTestPage.tsx`
- Modify: `src/lib/adapters/asr/volcano-http-asr.ts`
- Modify: `src/backend/server.ts`

**Step 1: 写集成测试（先失败）**

在 `tests/config/port-env.test.ts` 新增案例：
- `resolveDevPorts` 正确读取 `EXOMIND_WEB_PORT=1919`、`EXOMIND_HMR_PORT=1929`
- `resolveSyncServerUrl` 在无 `VITE_SYNC_SERVER_URL` 时读取 `EXOMIND_POUCHDB_PORT=1930`
- `resolveAsrServerUrl` 在无 `VITE_ASR_SERVER_URL` 时读取 `EXOMIND_ASR_PORT=1931`

**Step 2: 运行测试确认失败**

Run: `bun run test tests/config/port-env.test.ts --run`  
Expected: FAIL（函数行为尚未完整实现）

**Step 3: 最小实现修改**

- `vite.config.ts`：
  - 使用 `loadEnv(mode, process.cwd(), '')`
  - `server.port` 读取 `resolveDevPorts(env).web`
  - `server.hmr.port` 读取 `resolveDevPorts(env).hmr`
- `server/config.js`：
  - `port` 从 `process.env.EXOMIND_POUCHDB_PORT` 解析，默认 6984
- `src/components/Chat/ChatPage.tsx`：
  - 用 `resolveSyncServerUrl(import.meta.env)` 拼接 `database/${currentUser}`
- `src/ui/pages/SyncTestPage.tsx`：
  - 默认 `serverUrl` 改为 `resolveSyncServerUrl(import.meta.env)`
- `src/lib/adapters/asr/volcano-http-asr.ts`：
  - 默认地址改为 `resolveAsrServerUrl(import.meta.env)`
- `src/backend/server.ts`：
  - `PORT` 优先级增加 `EXOMIND_ASR_PORT`

**Step 4: 运行测试确认通过**

Run: `bun run test tests/config/port-env.test.ts --run`  
Expected: PASS

**Step 5: Commit**

```bash
git add vite.config.ts server/config.js src/components/Chat/ChatPage.tsx src/ui/pages/SyncTestPage.tsx src/lib/adapters/asr/volcano-http-asr.ts src/backend/server.ts
git commit -m "fix: wire all dev ports to environment variables"
```

### Task 3: 启动脚本与文档

**Files:**
- Modify: `dev.ps1`
- Modify: `.env.example`
- Create: `docs/development/port-env-configuration.md`

**Step 1: 写脚本行为测试（轻量手工验证步骤）**

验证清单：
- 无环境变量时打印默认地址（1420 / 6984 / 1949）
- 设置 `EXOMIND_WEB_PORT` 后打开浏览器 URL 改为新端口
- 设置 `EXOMIND_POUCHDB_PORT` 后日志与实际服务端口一致

**Step 2: 实现脚本与文档**

- `dev.ps1`：
  - 读取 `EXOMIND_WEB_PORT`、`EXOMIND_POUCHDB_PORT`、`EXOMIND_ASR_PORT`
  - 将 `VITE_SYNC_SERVER_URL`、`VITE_ASR_SERVER_URL` 在运行时默认导出为对应 localhost URL
  - 打印动态端口，不再写死 `5173/6984`
- `.env.example`：
  - 添加三类端口变量和说明
- `docs/development/port-env-configuration.md`：
  - 说明单 worktree 与多 worktree 的端口配置示例
  - 给出 PowerShell 与 Bun 启动示例

**Step 3: Commit**

```bash
git add dev.ps1 .env.example docs/development/port-env-configuration.md
git commit -m "docs+chore: add multi-worktree port configuration guide"
```

### Task 4: 验证、推送与 PR

**Files:**
- Modify: `docs/plans/2026-02-11-issue-79-port-env-config.md`（如需补充验证记录）

**Step 1: 自动化验证**

Run:
- `bun run test tests/config/port-env.test.ts --run`
- `node -e "process.env.EXOMIND_POUCHDB_PORT='1920'; import('./server/config.js').then(m=>console.log(m.default.port))"`

Expected:
- 测试全绿
- 输出 `1920`

**Step 2: 手工验证（命令级）**

Run:
- `$env:EXOMIND_WEB_PORT='1919'; bun run dev -- --strictPort`

Expected:
- Vite Local 地址为 `http://localhost:1919/`

**Step 3: 分支推送与 PR**

Run:
- `git push -u origin fix/issue-79-port-env`
- `gh pr create --base dev --head fix/issue-79-port-env --title "fix: issue #79 support env-based ports for multi-worktree dev" --body "<PR说明>"`

PR body 包含：
- 问题复现证据
- 变更清单
- 验证命令与结果
- 关联 `Closes #79`

