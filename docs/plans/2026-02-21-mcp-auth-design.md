# 2026-02-21 MCP 用户认证与自动同步设计

## 背景

目前 ExoMind MCP 工具已支持 5 个基础工具（事件日志、时间块），但缺乏用户认证机制。

## 现状分析

### MCP 当前配置

```typescript
// packages/mcp/src/utils/mcp-environment.ts
- EXOMIND_MCP_USER_ID        // 用户ID，用于远程连接
- EXOMIND_MCP_EVENTLOG_MODE  // 存储模式：auto/local/remote
- EXOMIND_MCP_SYNC_SERVER_URL // 远程服务器地址
```

### 问题

1. **无密码验证** - 仅用 userId 区分用户，无安全性
2. **无登录流程** - 无法交互式输入密码
3. **无自动同步** - 登录后不会自动连接服务器

---

## 设计方案

### 1. 环境变量配置

| 环境变量 | 必填 | 默认值 | 说明 |
|----------|------|--------|------|
| `EXOMIND_MCP_USER_ID` | 是 | - | 用户ID |
| `EXOMIND_MCP_USER_PASSWD` | 是 | - | 用户密码 |
| `EXOMIND_MCP_SYNC_SERVER_URL` | 否 | `http://localhost:6984` | 远程服务器地址 |
| `EXOMIND_MCP_EVENTLOG_MODE` | 否 | `auto` | 存储模式 |

### 2. 启动时验证流程

```
MCP Server 启动
    │
    ▼
读取环境变量
    │
    ├── USER_ID 不存在 → 警告，继续启动（本地模式）
    │
    ├── USER_PASSWD 不存在 → 启动失败，退出
    │
    ▼
验证用户密码
    │
    ├── 密码错误 → 启动失败，退出
    │
    ▼
连接远程服务器（可选）
    │
    ├── 连接成功 → 启动实时双向同步
    │
    ├── 连接失败 → 启动成功，标记离线模式
    │
    ▼
MCP Server 就绪
```

### 3. 数据同步架构

```
┌─────────────────┐     PouchDB      ┌──────────────────┐
│  MCP 工具调用   │ ◄─── 复制 ────► │  PouchDB Server │
│                 │                  │                  │
│  EventLog       │    双向实时      │  localhost:6984 │
│  TimeBlock      │    同步          │  /{userId}      │
└─────────────────┘                  └──────────────────┘
```

### 4. 关键模块设计

#### 4.1 mcp-environment.ts 改动

```typescript
// 新增：解析用户密码
function resolveUserPassword(): string | undefined {
  return process.env.EXOMIND_MCP_USER_PASSWD?.trim();
}

// 新增：验证用户
async function validateUser(): Promise<ValidationResult> {
  const userId = resolveUserId();
  const password = resolveUserPassword();

  if (!userId) {
    return { valid: false, mode: 'local', reason: 'USER_ID not set' };
  }

  if (!password) {
    return { valid: false, mode: 'error', reason: 'USER_PASSWD required' };
  }

  // TODO: 验证密码（需要实现 Node.js 版本的密码验证）
  const isValid = await verifyPasswordLocally(userId, password);

  if (!isValid) {
    return { valid: false, mode: 'error', reason: 'Invalid password' };
  }

  return { valid: true, mode: 'remote', userId };
}
```

#### 4.2 密码验证方案

由于 Node.js 无法访问浏览器 localStorage，采用以下方案：

**方案：使用共享密钥文件**

```typescript
// 用户首次在主应用注册后，导出密钥到文件
// MCP 启动时读取密钥文件进行验证

// 密钥文件格式: ~/.exomind/mcp-auth.json
{
  "users": {
    "alice": {
      "passwordHash": "salt:hash...",
      "createdAt": "2026-02-21T00:00:00Z"
    }
  }
}
```

**简化方案（本期实现）**：

直接使用环境变量中的密码进行验证，不做用户注册管理：
- MCP 通过 `USER_PASSWD` 直接验证
- 用户在主应用注册一次，记住密码
- MCP 使用相同密码即可访问

### 5. 错误处理

| 场景 | 处理 | 日志 |
|------|------|------|
| USER_ID 未设置 | 警告，继续启动 | `[WARN] USER_ID not set, running in local mode` |
| USER_PASSWD 未设置 | 启动失败 | `[ERROR] USER_PASSWD is required` |
| 密码错误 | 启动失败 | `[ERROR] Invalid password for user: {userId}` |
| 服务器连接失败 | 启动成功，离线模式 | `[WARN] Cannot connect to sync server, running offline` |
| 服务器连接成功 | 正常同步 | `[INFO] Connected to sync server, syncing...` |

---

## 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `packages/mcp/src/utils/mcp-environment.ts` | 修改 | 添加密码验证逻辑 |
| `packages/mcp/src/utils/mcp-dependencies.ts` | 修改 | 初始化 PouchSyncAdapter |
| `packages/mcp/src/tools/tools-auth.ts` | 新增 | 认证状态查询工具（可选） |

---

## 验收标准

- [ ] **TC1**: MCP 启动时验证 `USER_PASSWD` 正确性
- [ ] **TC2**: 密码错误时 MCP 无法启动，输出错误信息
- [ ] **TC3**: 验证通过后自动连接到远程同步服务器
- [ ] **TC4**: 数据自动双向同步
- [ ] **TC5**: 服务器连接失败时，MCP 仍可启动（离线模式）
- [ ] **TC6**: `USER_ID` 未设置时，MCP 以本地模式启动

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 密码明文传输 | 本地运行，风险可控；后续可考虑加密 |
| 多设备同步冲突 | 使用 PouchDB 内置冲突处理 |
| 服务器不可用 | MCP 仍可本地运行 |

---

## 里程碑

1. **Phase 1**: 环境变量解析 + 密码验证（启动时）
2. **Phase 2**: PouchDB 连接 + 自动同步
3. **Phase 3**: 错误处理 + 日志完善

---

*Created: 2026-02-21*
*Related Issue: #180*
