# Findings & Decisions

## Requirements
- MCP 工具需要支持用户登录/注册
- 用户认证使用环境变量 USER_PASSWD
- 需要配合 ExoMind 同步服务器
- 登录后自动同步用户数据

## Research Findings

### 1. 现有用户认证逻辑

**存储结构（localStorage）**：
```
exomind:users = [
  { "username": "alice", "passwordHash": "salt:hash...", "createdAt": "..." }
]
exomind:currentUser = { "username": "alice", "deviceId": "...", "lastLogin": ... }
```

**密码哈希实现** (`src/adapters/crypto-adapter.ts`):
- 使用 salt + SHA256 哈希
- 格式：`salt:hash`

**认证流程** (`src/ui/stores/sync-store.ts`):
- `register(username, password)` - 注册，检查用户名唯一性，密码哈希存储
- `login(username, password)` - 登录，验证密码，创建会话
- `logout()` - 清除会话

**WebSocket 认证** (`src/lib/ws/auth.ts`):
- Challenge-Response 握手协议
- `createAuthServer(password)` / `createAuthClient(password)`

### 2. 同步服务器实现

**PouchDB Sync Server** (`server/pouchdb-server.js`):
- 基于官方 pouchdb-server
- 端口：6984（可配置 `EXOMIND_POUCHDB_PORT`）
- 数据库路径：`http://localhost:6984/{username}`
- 支持 Basic Auth（通过 `EXOMIND_SYNC_AUTH_MODE=enabled` 开启）

**数据同步** (`src/adapters/pouch-sync.ts`):
- PouchDB 双向实时复制
- 本地 IndexedDB → 远程 PouchDB
- 自动冲突检测和处理

### 3. MCP 现有实现

**环境变量配置** (`packages/mcp/src/utils/mcp-environment.ts`):
- `EXOMIND_MCP_USER_ID` - 用户ID，用于远程连接
- `EXOMIND_MCP_EVENTLOG_MODE` - 存储模式：auto/local/remote
- `EXOMIND_MCP_SYNC_SERVER_URL` - 远程服务器地址

**问题**：
1. **无用户认证** - 仅通过 userId 区分用户，无密码验证
2. **无注册功能** - MCP 无法创建新用户
3. **无登录流程** - 无法交互式输入密码

### 4. MCP 需要的认证流程

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Claude Code    │ ──► │  MCP Tools       │ ──► │  ExoMind Server │
│                 │     │                  │     │                 │
│  用户输入密码   │     │ login/register   │     │  验证密码       │
│                 │     │                  │     │  返回会话       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**需要的 MCP 工具**：
1. `exomind_login(username, password)` - 登录
2. `exomind_register(username, password)` - 注册
3. `exomind_logout()` - 登出

### 5. 认证后的同步流程

登录成功后需要：
1. 获取用户密码哈希
2. 初始化 PouchSyncAdapter
3. 连接到远程数据库：`http://server/{username}`
4. 启动双向同步

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 复用现有 UserService | 减少重复代码，保持一致性 |
| MCP 调用主应用 Service | 需要解决 Node.js 访问浏览器 localStorage 的问题 |
| 使用环境变量存储密码 | USER_PASSWD 用于 MCP 启动时认证 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Node.js 无法访问浏览器 localStorage | 需要创建独立的用户数据存储，或通过 IPC 与主应用通信 |

## Resources
- `src/ui/stores/sync-store.ts` - 现有登录/注册逻辑
- `src/adapters/crypto-adapter.ts` - 密码哈希实现
- `src/adapters/pouch-sync.ts` - PouchDB 同步适配器
- `packages/mcp/src/utils/mcp-environment.ts` - MCP 环境配置
- `server/pouchdb-server.js` - 同步服务器
- `docs/specs/SPEC-304-用户认证模块重构.md` - 用户认证规格
