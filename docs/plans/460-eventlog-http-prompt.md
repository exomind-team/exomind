# Task: RT 新增 EventLog HTTP 端点 + MCP 迁移至 RT 数据源

GitHub Issue: #460
Branch: `ex/rtev-460-eventlog-http`

## 背景

MCP 通过 PouchDB 连 CouchDB (`localhost:6984`) 读写 EventLog，CouchDB 已停止，MCP 全部失败。
需要在 RT (exomind-runtime) 新增 EventLog HTTP CRUD 端点，然后更新 MCP 连接 RT。

## 现有代码参考

### 1. Tauri EventLog 持久化（已有完整实现，可复用逻辑）
- **文件**: `src-tauri/src/commands/eventlog_commands.rs`
- **数据结构**: `EventRecord { id, timestamp, content, tags }`
- **持久化**: JSON 文件 `{data_dir}/eventlog/{user_id}.json`
- **镜像**: Markdown 文件 `{data_dir}/eventlog/{user_id}.md`
- **Checkpoint**: `{data_dir}/eventlog/{user_id}.checkpoint.json`
- **已实现的函数**: `read_events()`, `write_events()`, `sort_events_desc()`, `sync_markdown_mirror()`, `rebuild_markdown()`

### 2. RT 路由结构（Axum）
- **路由注册**: `crates/exomind-runtime/src/routes/mod.rs`
- **AppState**: `crates/exomind-runtime/src/lib.rs` 中的 `AppState` struct
- **参考路由**: `routes/signals.rs`（最完整的参考，含 CRUD + SSE + 测试）
- **参考路由**: `routes/tasks.rs`、`routes/agents.rs`

### 3. MCP 代码
- **当前 EventLog port**: `packages/mcp/src/ports/remote-eventlog-port.ts`（PouchDB，需替换）
- **EventLog 工具**: `packages/mcp/src/tools/tools-event.ts`
- **环境配置**: `packages/mcp/src/utils/mcp-environment.ts`
- **IEventLogPort 接口**: `src/lib/environment/interfaces/eventlog.port.ts`

### 4. EventLog 数据类型（TS 侧）
- **文件**: `src/lib/types/event.ts`
- **EventData**: `{ id: string, timestamp: number, content: string, tags: string[] }`

---

## 实现步骤（按顺序执行）

### Step 1: 在 exomind-runtime crate 新增 EventLog 持久化模块

**新建文件**: `crates/exomind-runtime/src/eventlog.rs`

从 `src-tauri/src/commands/eventlog_commands.rs` 提取核心逻辑：
- `EventRecord` struct（同样的字段：id, timestamp, content, tags）
- `EventLogStore` struct，包含 data_dir: PathBuf
- `read_events(user_id)` / `write_events(user_id, events)` 方法
- `sync_markdown_mirror()` 方法
- `sanitize_user_id()` 函数

注意：不要直接依赖 Tauri 的 `AppHandle`，而是用纯 `PathBuf` 参数。

在 `crates/exomind-runtime/src/lib.rs` 中 `pub mod eventlog;`

### Step 2: AppState 扩展

**修改文件**: `crates/exomind-runtime/src/lib.rs`

在 `AppState` 中新增：
```rust
pub eventlog_store: Arc<EventLogStore>,
```

在 `RuntimeStartOptions` 或启动逻辑中初始化 `EventLogStore`，data_dir 使用：
- 环境变量 `EXOMIND_RT_DATA_DIR`，默认 `./runtime-data`

### Step 3: 新增 EventLog HTTP 路由

**新建文件**: `crates/exomind-runtime/src/routes/eventlog.rs`

端点：

```
GET    /eventlog                → list_events(Query { limit?, since_id?, user_id? })
POST   /eventlog                → append_event(Json<EventRecord>, Query { user_id? })
GET    /eventlog/:id            → get_event(Path<id>, Query { user_id? })
DELETE /eventlog                → clear_events(Query { user_id? })  // 需 auth
GET    /eventlog/mirror-status  → mirror_status(Query { user_id? })
POST   /eventlog/rebuild        → rebuild_markdown(Query { user_id? })
```

参考 `routes/signals.rs` 的代码风格和测试写法。
user_id 参数默认值为 "anonymous"。

**修改文件**: `crates/exomind-runtime/src/routes/mod.rs`
- 添加 `pub mod eventlog;`
- 在 `router()` 中 `.merge(eventlog::router())`

### Step 4: 单元测试（RT 侧）

在 `routes/eventlog.rs` 底部添加 `#[cfg(test)] mod tests`，参考 `routes/signals.rs` 的测试风格：
- `append_and_list` — 写入后能读到
- `get_by_id` — 按 ID 查询
- `get_nonexistent_returns_404`
- `clear_removes_all`
- `list_with_limit`
- 使用 `tempdir` 作为 data_dir 避免污染

### Step 5: MCP 新增 RT EventLog Port

**新建文件**: `packages/mcp/src/ports/rt-eventlog-port.ts`

```typescript
export class RtEventLogPort implements IEventLogPort {
  private baseUrl: string;
  private userId: string;

  constructor(rtUrl: string, userId: string) {
    this.baseUrl = rtUrl;
    this.userId = userId;
  }

  async listEvents(): Promise<EventData[]> {
    const res = await fetch(`${this.baseUrl}/eventlog?user_id=${this.userId}`);
    return res.json();
  }

  async appendEvent(event: EventData): Promise<void> {
    await fetch(`${this.baseUrl}/eventlog?user_id=${this.userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  }

  async getEvent(id: string): Promise<EventData | null> {
    const res = await fetch(`${this.baseUrl}/eventlog/${id}?user_id=${this.userId}`);
    if (res.status === 404) return null;
    return res.json();
  }

  async clearEvents(): Promise<void> {
    await fetch(`${this.baseUrl}/eventlog?user_id=${this.userId}`, { method: 'DELETE' });
  }
}
```

### Step 6: MCP 环境配置更新

**修改文件**: `packages/mcp/src/utils/mcp-environment.ts`

- 新增环境变量 `EXOMIND_MCP_RT_URL`（默认 `http://localhost:1949`）
- `EventLogMode` 新增 `'rt'` 选项
- 当 mode 为 `'rt'` 时，使用 `RtEventLogPort(rtUrl, userId)`
- 当 mode 为 `'auto'` 时，优先尝试 RT（检测 RT 是否可达），不可达则 fallback 到 local

### Step 7: 提交

按逻辑分多个 commit：
1. `feat(rt): add EventLogStore persistence module` — Step 1+2
2. `feat(rt): add /eventlog HTTP CRUD routes with tests` — Step 3+4
3. `feat(mcp): add RtEventLogPort + rt mode support` — Step 5+6

每个 commit 都要 `cargo test` / `cargo check` 通过。

---

## 验收标准

- [ ] `crates/exomind-runtime/src/eventlog.rs` 存在，包含 EventLogStore
- [ ] `crates/exomind-runtime/src/routes/eventlog.rs` 存在，包含 6 个 HTTP handler
- [ ] `GET /eventlog` 返回 JSON 数组
- [ ] `POST /eventlog` 写入后 `GET /eventlog` 能看到新事件
- [ ] `GET /eventlog/:id` 返回单条事件或 404
- [ ] EventLog 数据持久化到 `{data_dir}/eventlog/{user_id}.json`
- [ ] 写入后 Markdown 镜像文件自动更新
- [ ] `packages/mcp/src/ports/rt-eventlog-port.ts` 存在并实现 IEventLogPort
- [ ] `mcp-environment.ts` 支持 `EXOMIND_MCP_EVENTLOG_MODE=rt`
- [ ] `cargo test` 全部通过（RT 侧 EventLog 路由测试）
- [ ] 每个 commit message 包含 `Co-Authored-By: Claude <noreply@anthropic.com>`

## 重要约束

- 不要修改 `src-tauri/src/commands/eventlog_commands.rs`（保持 Tauri IPC 不变）
- 不要修改前端代码（`src/` 目录下的 TS/TSX 文件）
- RT 的 EventLogStore 是独立实现，不依赖 Tauri crate
- JSON 文件格式必须与 `eventlog_commands.rs` 兼容（相同的 EventRecord 字段名和 camelCase 序列化）
- `cargo check` 和 `cargo test` 必须通过后才提交
