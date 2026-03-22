# 批次 L：RT 基础能力（Rust 小改）

> **状态**：待执行
> **分支**：直接在 `dev` 上开发
> **关联 Issue**：#668, #669, #671, #667
> **执行顺序**：#668 → #669 → #671 → #667

---

## Context

RT-first 架构方向已确定（#666 设计契约）。本批次实现 4 个独立的 Rust RT 基础能力改造，为后续 Agent 接入和 UI 迁移打基础。每个 issue 改动集中在 `crates/exomind-runtime/src/routes/` 下，互不依赖。

1. **#668**（P1）：POST /eventlog 的 id 由 RT 统一生成，拒绝客户端传入
2. **#669**（P2）：eventlog 支持按时间范围和 tag 过滤查询
3. **#671**（P2）：eventlog 提供 watch/长轮询端点
4. **#667**（P1）：提供本地档案列表接口

---

## 步骤 1：#668 POST /eventlog id 由 RT 生成

### 1.1 改动

**文件**：`crates/exomind-runtime/src/routes/eventlog.rs`

**当前**：`POST /eventlog` 要求客户端在 body 中提供 `id` 字段。

**改为**：
1. 请求体中的 `id` 字段变为可选
2. 如果客户端传了 `id`，RT 返回 `400 Bad Request`：`{"error": "id 字段已弃用，RT 会自动生成事件 ID"}`
3. RT 在写入前自动生成 UUID v4 作为事件 ID
4. 响应体返回生成的完整事件（含 RT 分配的 id）

```rust
// 伪代码
async fn append_event(body: Json<EventInput>) -> Result<Json<Event>, StatusCode> {
    if body.id.is_some() {
        return Err((StatusCode::BAD_REQUEST, "id field is deprecated; RT generates event IDs automatically"));
    }
    let id = Uuid::new_v4().to_string();
    let event = Event { id, ..body.into_event() };
    store.append(event.clone()).await?;
    Ok(Json(event))
}
```

### 1.2 前端适配

**文件**：`src/lib/services/ecs-eventlog-replication.service.ts`（或 `eventlog-rt-adapter.ts`）

前端 POST 请求不再传 `id` 字段。检查 `appendEventWithEcsReplication` 和 `task-event-emitter.ts` 中是否硬编码了 `id: createUuidV4()`，如果有则移除。

**注意**：`task-event-emitter.ts` 的 `tryEmit` 当前生成 `id: createUuidV4()`。改为不传 id，或传了后 RT 会拒绝。建议移除 id 字段。

### 1.3 验证

```bash
cargo test -p exomind-runtime -- eventlog
```

**curl 验证**：

```bash
# 正确用法：不传 id
curl -sS -X POST "http://127.0.0.1:9124/eventlog?user_id=profile-argon" \
  -H 'Content-Type: application/json' \
  -d '{"timestamp": 1742659200000, "content": "test", "tags": ["note"]}'
# 期望：200，返回体含 RT 生成的 id

# 错误用法：传了 id
curl -sS -X POST "http://127.0.0.1:9124/eventlog?user_id=profile-argon" \
  -H 'Content-Type: application/json' \
  -d '{"id": "abc", "timestamp": 1742659200000, "content": "test", "tags": ["note"]}'
# 期望：400，"id 字段已弃用"
```

---

## 步骤 2：#669 eventlog 过滤查询

### 2.1 改动

**文件**：`crates/exomind-runtime/src/routes/eventlog.rs`

`GET /eventlog` 新增查询参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| `since_timestamp` | i64（毫秒） | 只返回该时间戳之后的事件 |
| `until_timestamp` | i64（毫秒） | 只返回该时间戳之前的事件 |
| `tags` | 逗号分隔字符串 | 只返回包含指定 tag 的事件（AND 语义） |

```rust
#[derive(Deserialize)]
struct EventLogQuery {
    user_id: String,
    limit: Option<usize>,
    since_id: Option<String>,
    since_timestamp: Option<i64>,   // ★ 新增
    until_timestamp: Option<i64>,   // ★ 新增
    tags: Option<String>,            // ★ 新增，逗号分隔
}

// SQL 查询追加 WHERE 条件
if let Some(since) = query.since_timestamp {
    sql.push_str(" AND timestamp > ?");
    params.push(since);
}
if let Some(until) = query.until_timestamp {
    sql.push_str(" AND timestamp < ?");
    params.push(until);
}
if let Some(tags_str) = &query.tags {
    for tag in tags_str.split(',') {
        // 假设 tags 存储为 JSON 数组，用 JSON_EACH 或 LIKE 匹配
        sql.push_str(" AND tags LIKE ?");
        params.push(format!("%\"{}\"%", tag.trim()));
    }
}
```

**注意**：检查当前 tags 在 SQLite 中的存储格式（JSON 数组字符串还是单独表），SQL 匹配方式需要适配。

### 2.2 验证

```bash
cargo test -p exomind-runtime -- eventlog
```

**curl 验证**：

```bash
# 时间范围过滤
curl -sS "http://127.0.0.1:9124/eventlog?user_id=profile-argon&since_timestamp=1742659200000&limit=5"

# tag 过滤
curl -sS "http://127.0.0.1:9124/eventlog?user_id=profile-argon&tags=agent_feedback"

# 组合
curl -sS "http://127.0.0.1:9124/eventlog?user_id=profile-argon&since_timestamp=1742659200000&tags=note&limit=10"
```

---

## 步骤 3：#671 eventlog watch/长轮询

### 3.1 改动

**文件**：`crates/exomind-runtime/src/routes/eventlog.rs`（新增端点）

**新增端点**：`GET /eventlog/watch`

**行为**：
- 接受 `user_id`、`since_id`（可选）、`timeout`（可选，秒，默认 60，上限 300）参数
- 如果有新事件（since_id 之后），立即返回
- 如果没有新事件，阻塞等待最多 `timeout` 秒
- 超时后返回空数组 `[]`
- 客户端循环调用实现持续监听

```rust
#[derive(Deserialize)]
struct WatchQuery {
    user_id: String,
    since_id: Option<String>,
    timeout: Option<u64>,  // 秒，默认 60，上限 300
}

async fn watch_events(
    Query(query): Query<WatchQuery>,
    state: State<AppState>,
) -> Json<Vec<Event>> {
    let timeout_secs = query.timeout.unwrap_or(60).min(300);
    let timeout = Duration::from_secs(timeout_secs);
    let start = Instant::now();

    loop {
        let events = state.eventlog.get_events_since(&query.user_id, query.since_id.as_deref()).await;
        if !events.is_empty() {
            return Json(events);
        }
        if start.elapsed() > timeout {
            return Json(vec![]);
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}
```

**注意**：检查 RT 是否已有 SSE 基础设施（如 signal stream），如果有可以复用 channel/notify 机制而非轮询 sleep。

### 3.2 验证

```bash
cargo test -p exomind-runtime -- eventlog
```

**curl 验证**：

```bash
# 终端 1：watch（会阻塞）
curl -sS "http://127.0.0.1:9124/eventlog/watch?user_id=profile-argon"

# 终端 2：写入新事件
curl -sS -X POST "http://127.0.0.1:9124/eventlog?user_id=profile-argon" \
  -H 'Content-Type: application/json' \
  -d '{"timestamp": ..., "content": "watch test", "tags": ["note"]}'

# 终端 1 应立即返回新事件
```

---

## 步骤 4：#667 本地档案列表接口

### 4.1 改动

**文件**：`crates/exomind-runtime/src/routes/` 下新增端点

**新增端点**：`GET /profiles`

**返回**：当前 RT 可访问的本地档案列表。

```rust
// 检查 RT 中档案数据的存储方式：
// 1. 如果 RT 维护一个 profiles.json 或 SQLite 表 → 直接读取
// 2. 如果档案信息只在前端 localStorage → 需要新建 RT 端存储

// 返回格式：
#[derive(Serialize)]
struct ProfileInfo {
    id: String,           // "profile-argon"
    slug: String,         // "argon"
    display_name: String, // "Argon"
}

async fn list_profiles(state: State<AppState>) -> Json<Vec<ProfileInfo>> {
    // 实现取决于当前 RT 的档案感知方式
    // 如果 RT 只有 user_id scope 但不维护档案列表，
    // 可以扫描 eventlog 表中出现过的 distinct user_id 作为已知档案
}
```

**注意**：
- 检查 `crates/exomind-runtime/src/` 中是否已有 profile/user 相关模块
- 如果 RT 当前不维护档案元信息，最小方案是扫描 SQLite 中出现过的 `user_id` 值
- 返回的 `display_name` 可能需要从 slug 反推（首字母大写），或返回空让客户端自行查询

### 4.2 验证

```bash
cargo test -p exomind-runtime -- profile
```

**curl 验证**：

```bash
curl -sS "http://127.0.0.1:9124/profiles"
# 期望返回：[{"id": "profile-argon", "slug": "argon", "display_name": "Argon"}]
```

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
|------|---------|-------|
| `crates/exomind-runtime/src/routes/eventlog.rs` | id 生成 + 过滤查询 + watch 端点 | #668 #669 #671 |
| `crates/exomind-runtime/src/routes/mod.rs` | 注册新路由 | #671 #667 |
| `crates/exomind-runtime/src/routes/` 新文件 | profiles 端点 | #667 |
| `src/lib/services/task-event-emitter.ts` | 移除 id 字段 | #668 |
| `src/lib/services/ecs-eventlog-replication.service.ts` | 移除 id 字段 | #668 |

---

## ⚠️ 不要做清单

| 禁止项 | 原因 |
|--------|------|
| **不要改动 eventlog 的读取/存储核心逻辑** | 只改 HTTP 路由层 |
| **不要引入新的 Rust 依赖** | 用已有的 uuid/sqlx/axum |
| **不要改动 signal 系统** | watch 端点独立于信号流 |
| **不要改动前端 EventLogService** | 前端适配仅限移除 id 传参 |

## ⚠️ 容易出错的关键点

1. **#668 向后兼容窗口期**：前端可能还有旧代码传 id。建议先实现"忽略客户端 id"（而非 400 拒绝），等前端全部适配后再切换为拒绝模式
2. **#669 tags 存储格式**：SQLite 中 tags 可能是 JSON 数组字符串 `["note","voice"]`，SQL LIKE 匹配需要包含引号
3. **#671 watch 的并发**：长轮询会占用连接。确保 Axum 的连接池能承受多个 watch 连接
4. **#671 通知机制**：简单方案是 sleep 轮询 SQLite，更好方案是用 tokio broadcast channel 在 append_event 时通知 watch 等待者
5. **#667 档案发现**：RT 可能不维护 profile 元信息。最小方案是 `SELECT DISTINCT user_id FROM events`，但这只能发现"写过事件的档案"

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 不传 id | POST eventlog 无 id | 200，返回含 RT 生成 id | #668 |
| 传 id | POST eventlog 带 id | 400 或忽略 | #668 |
| 时间过滤 | since_timestamp 查询 | 只返回之后的事件 | #669 |
| tag 过滤 | tags=agent_feedback | 只返回含该 tag 的 | #669 |
| watch 有新事件 | watch 后写入新事件 | 立即返回 | #671 |
| watch 超时 | watch 默认 60 秒无新事件 | 返回空数组 | #671 |
| watch 自定义超时 | timeout=10 | 10 秒后返回空数组 | #671 |
| watch 超时上限 | timeout=999 | 实际 cap 到 300 秒 | #671 |
| 档案列表 | GET /profiles | 返回已知档案 | #667 |
| cargo test | `cargo test -p exomind-runtime` | 通过 | 全部 |

---

## 完成回填

（Codex 执行完毕后在此填写）
