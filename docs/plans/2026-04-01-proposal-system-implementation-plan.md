# 实施计划：提案系统（Proposal System）

> **状态**：待执行
> **设计文档**：[2026-04-01-agent-api-and-proposal-system-design.md](./2026-04-01-agent-api-and-proposal-system-design.md)
> **关联 Issue**：#677
> **分支**：`feature/proposal-system`
> **验收标准**：外部 Agent 通过 `curl POST /api/proposals` 提交 `create_task` 提案，用户在 UI 中批准后任务实际创建并写入 EventLog

---

## 步骤 0：代码探索（执行前必读）

```bash
# 确认现有路由模式
cat crates/exomind-runtime/src/routes/tasks.rs | grep -n "\.route("
cat crates/exomind-runtime/src/routes/mod.rs

# 确认 AppState 结构（新增 proposal_store 字段参考位置）
grep -A 30 "struct AppState" crates/exomind-runtime/src/lib.rs

# 确认任务创建接口（提案执行时调用）
grep -n "create_task\|CreateTask" crates/exomind-runtime/src/routes/tasks.rs | head -10
grep -n "create_task\|TaskStore" crates/exomind-runtime/src/task/ -r | head -10

# 确认 EventLog 追加接口（提案执行时写入 Agent 操作记录）
grep -n "append_event\|AppendEvent" crates/exomind-runtime/src/routes/eventlog.rs | head -10

# 确认 SQLite 存储模式（参考 eventlog_sqlite.rs）
ls crates/exomind-runtime/src/ | grep sqlite
```

---

## Phase 1：RT 后端（Rust）

### 步骤 1：提案数据模型

**新建文件**：`crates/exomind-runtime/src/proposal/mod.rs`

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 提案（Proposal）——待执行的操作草稿，需人类审批后执行
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proposal {
    pub id: u64,                          // 自增编号，永久唯一
    pub title: String,
    pub body: String,                     // 理由/分析依据
    pub action_type: ActionType,
    pub action_params: serde_json::Value, // 按 action_type 解析
    pub references: Vec<ProposalRef>,
    pub status: ProposalStatus,
    pub publisher: Publisher,
    pub comments: Vec<Comment>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
    CreateTask,
    AppendEvent,
    StartTimeblock,
    ApproveAgentAccess,
}

/// action_params 对应的结构（用于反序列化验证）
#[derive(Debug, Deserialize)]
pub struct CreateTaskParams {
    pub title: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct AppendEventParams {
    pub content: String,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct StartTimeblockParams {
    pub name: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposalRef {
    pub ref_type: RefType,
    pub id: String,
    pub display_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RefType { Event, Timeblock, Task }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProposalStatus {
    Pending,
    InReview,
    Approved,
    Rejected,
    Snoozed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Publisher {
    pub publisher_type: PublisherType,
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublisherType { Agent, Human }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    pub author: Publisher,
    pub content: String,
    pub created_at: DateTime<Utc>,
}
```

#### 1.2 验证

```bash
cargo check -p exomind-runtime
```

---

### 步骤 2：提案存储（SQLite）

**新建文件**：`crates/exomind-runtime/src/proposal/store.rs`

数据表设计（参考 `eventlog_sqlite.rs` 的存储模式）：

```sql
CREATE TABLE IF NOT EXISTS proposals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    action_type TEXT NOT NULL,
    action_params TEXT NOT NULL DEFAULT '{}',
    references  TEXT NOT NULL DEFAULT '[]',
    status      TEXT NOT NULL DEFAULT 'pending',
    publisher   TEXT NOT NULL DEFAULT '{}',
    comments    TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
```

**主要接口**：

```rust
pub struct ProposalStore { /* sqlite connection pool */ }

impl ProposalStore {
    pub async fn create(&self, payload: CreateProposalPayload) -> Result<Proposal, StoreError>;
    pub async fn list(&self, filter: ProposalFilter) -> Result<Vec<Proposal>, StoreError>;
    pub async fn get(&self, id: u64) -> Result<Option<Proposal>, StoreError>;
    pub async fn update_status(&self, id: u64, status: ProposalStatus, snooze_until: Option<DateTime<Utc>>) -> Result<Proposal, StoreError>;
    pub async fn update_action_params(&self, id: u64, params: serde_json::Value) -> Result<Proposal, StoreError>;
    pub async fn add_comment(&self, id: u64, comment: Comment) -> Result<Proposal, StoreError>;
}
```

**注意**：`id` 不可更新，`status` 不允许从终态（`approved`/`rejected`）回退。

#### 2.2 验证

```bash
cargo test -p exomind-runtime proposal
```

---

### 步骤 3：提案执行器

**新建文件**：`crates/exomind-runtime/src/proposal/executor.rs`

当提案状态变为 `Approved` 时触发执行：

```rust
pub struct ProposalExecutor {
    pub task_store: Arc<TaskStore>,
    pub eventlog_store: Arc<EventLogStore>,
    pub timeblock_store: Arc<TimeBlockStore>,
}

impl ProposalExecutor {
    pub async fn execute(&self, proposal: &Proposal) -> Result<(), ExecutionError> {
        match proposal.action_type {
            ActionType::CreateTask => self.execute_create_task(proposal).await,
            ActionType::AppendEvent => self.execute_append_event(proposal).await,
            ActionType::StartTimeblock => self.execute_start_timeblock(proposal).await,
            ActionType::ApproveAgentAccess => {
                // 转交 #677 auth 体系处理
                Err(ExecutionError::NotYetImplemented("ApproveAgentAccess"))
            }
        }
    }

    async fn execute_create_task(&self, proposal: &Proposal) -> Result<(), ExecutionError> {
        let params: CreateTaskParams = serde_json::from_value(proposal.action_params.clone())?;
        self.task_store.create(params.into()).await?;
        // 同时写入 EventLog，记录 Agent 助理操作
        self.eventlog_store.append(EventData {
            content: format!("Agent 助理建议创建了任务：{}", params.title),
            tags: vec!["agent-action".to_string()],
            ..Default::default()
        }).await?;
        Ok(())
    }

    // execute_append_event / execute_start_timeblock 类似
}
```

#### 3.2 验证

```bash
cargo test -p exomind-runtime proposal::executor
```

---

### 步骤 4：HTTP 路由

**新建文件**：`crates/exomind-runtime/src/routes/proposals.rs`

**参考**：`crates/exomind-runtime/src/routes/tasks.rs` 的路由模式

```rust
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/proposals", get(list_proposals).post(create_proposal))
        .route("/proposals/:id", get(get_proposal).patch(update_proposal))
        .route("/proposals/:id/comments", post(add_comment))
}
```

**请求/响应结构**：

```rust
// POST /api/proposals
struct CreateProposalRequest {
    title: String,
    body: Option<String>,
    action_type: ActionType,
    action_params: serde_json::Value,
    references: Option<Vec<ProposalRef>>,
    publisher: Publisher,
}

// PATCH /api/proposals/:id
struct UpdateProposalRequest {
    status: Option<ProposalStatus>,
    action_params: Option<serde_json::Value>,
    snooze_until: Option<DateTime<Utc>>,
}
```

**执行钩子**：`update_proposal` 检测到 `status → Approved` 时调用 `ProposalExecutor::execute`

**在 `routes/mod.rs` 注册**：

```rust
// 现有代码位置：routes/mod.rs 的 router() 函数
pub mod proposals;  // ★ 新增
// ...
.merge(proposals::router())  // ★ 新增
```

**在 `AppState` 新增字段**：

```rust
// 现有代码位置：lib.rs 的 AppState struct
pub proposal_store: Arc<proposal::ProposalStore>,  // ★ 新增
```

#### 4.2 验证

```bash
cargo check -p exomind-runtime
cargo test -p exomind-runtime routes::proposals

# 手动验证（启动 RT 后）
curl -s -X POST http://127.0.0.1:1949/api/proposals \
  -H "Content-Type: application/json" \
  -d '{
    "title": "建议：整理今日会议记录",
    "body": "检测到今天有未记录的会议事件",
    "action_type": "create_task",
    "action_params": {"title": "整理会议记录", "tags": ["工作"]},
    "references": [{"ref_type": "Event", "id": "evt-001", "display_text": "09:32 团队会议"}],
    "publisher": {"publisher_type": "agent", "id": "test-agent", "name": "测试 Agent"}
  }' | jq .

# 验证列表
curl -s http://127.0.0.1:1949/api/proposals | jq .

# 验证批准执行（创建任务）
curl -s -X PATCH http://127.0.0.1:1949/api/proposals/1 \
  -H "Content-Type: application/json" \
  -d '{"status": "approved"}' | jq .

# 验证任务是否创建
curl -s http://127.0.0.1:1949/tasks | jq '.[] | select(.title == "整理会议记录")'
```

---

## Phase 2：前端（TypeScript / React）

### 步骤 5：类型定义与 API 客户端

**新建文件**：`src/lib/types/proposal.ts`

```typescript
export type ProposalStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'snoozed';
export type ActionType = 'create_task' | 'append_event' | 'start_timeblock' | 'approve_agent_access';
export type RefType = 'event' | 'timeblock' | 'task';
export type PublisherType = 'agent' | 'human';

export interface ProposalRef {
  ref_type: RefType;
  id: string;
  display_text: string;
}

export interface Publisher {
  publisher_type: PublisherType;
  id: string;
  name: string;
}

export interface Comment {
  author: Publisher;
  content: string;
  created_at: string;
}

export interface Proposal {
  id: number;
  title: string;
  body: string;
  action_type: ActionType;
  action_params: Record<string, unknown>;
  references: ProposalRef[];
  status: ProposalStatus;
  publisher: Publisher;
  comments: Comment[];
  created_at: string;
  updated_at: string;
}
```

**新建文件**：`src/lib/adapters/proposal-rt-adapter.ts`

```typescript
// 参考 eventlog-rt-adapter.ts 的实现模式
export async function listProposals(filter?: { status?: ProposalStatus }): Promise<Proposal[]>;
export async function createProposal(payload: CreateProposalPayload): Promise<Proposal>;
export async function updateProposal(id: number, patch: UpdateProposalPatch): Promise<Proposal>;
export async function addComment(id: number, content: string, author: Publisher): Promise<Proposal>;
```

#### 5.2 验证

```bash
npx tsc --noEmit
```

---

### 步骤 6：全局通知徽章

**新建文件**：`src/ui/app/components/ProposalNotificationBadge.tsx`

- 轮询 `GET /api/proposals?status=pending` （每 30 秒或通过 WebSocket 推送）
- 显示未处理数量，点击跳转到请求箱页面
- 插入位置：`src/ui/app/layout/AppSidebar.tsx` 导航栏（确认前先 `grep -n "导航\|Sidebar\|nav" src/ui/app/layout/ -r`）

#### 6.2 验证

```bash
npx tsc --noEmit
# 手动验证：curl 添加提案后，徽章显示数量变化
```

---

### 步骤 7：请求箱页面

**新建文件**：`src/ui/app/pages/ProposalInboxPage.tsx`

**布局**：
- 左侧列表：按状态分组（pending/in_review 优先），显示编号、标题、发布者、时间
- 右侧详情：标题、理由、引用列表（文字 + 跳转按钮）、动作参数编辑区、评论区、操作按钮

**引用跳转**（MVP）：
```typescript
function jumpToRef(ref: ProposalRef) {
  switch (ref.ref_type) {
    case 'event': navigate(`/eventlog?highlight=${ref.id}`); break;
    case 'timeblock': navigate(`/timeblocks?highlight=${ref.id}`); break;
    case 'task': navigate(`/tasks?highlight=${ref.id}`); break;
  }
}
```

**操作按钮**：
- 同意执行：`PATCH /api/proposals/:id { status: 'approved' }`
- 编辑后执行：先更新 `action_params`，再变更状态为 `approved`
- 拒绝：`{ status: 'rejected' }`
- 暂缓：`{ status: 'snoozed', snooze_until?: ... }`

**在路由中注册**：
```bash
# 先确认路由注册位置
grep -n "routes\|RouterConfig\|path" src/ui/app/router.tsx | head -20
```

#### 7.2 验证

```bash
npx tsc --noEmit
npx vite --host 0.0.0.0 --port 5173
# 手动验证全流程：curl 提交提案 → UI 显示 → 批准 → 任务创建
```

---

## ⚠️ 容易出错的关键点

1. **提案 id 自增不可重置**：SQLite `AUTOINCREMENT` 确保 id 永久递增，即使删除记录
2. **状态不可回退终态**：`approved` / `rejected` 后不允许再改状态，store 层需校验
3. **执行失败处理**：批准后执行失败不应回滚状态（提案已批准，记录操作记录），需要日志或额外通知
4. **`snoozed` 的语义**：暂缓不是终态，需要唤醒机制（MVP 可以不实现定时唤醒，仅用手动解除）
5. **并发审批**：`in_review` 状态防止两人同时审批，`PATCH status: in_review` 需要 compare-and-swap
6. **action_params 校验**：`create_task` 至少需要 `title` 字段，store 层创建时需验证

---

## 验证总表

| 场景 | 操作 | 期望结果 |
|------|------|---------|
| curl 提交提案 | `POST /api/proposals` | 返回带自增 id 的 Proposal 对象 |
| 列表查询 | `GET /api/proposals` | 返回提案列表 |
| 状态过滤 | `GET /api/proposals?status=pending` | 只返回 pending 状态 |
| 批准执行 | `PATCH /api/proposals/1 {status:approved}` | 返回 approved 提案，任务已创建，EventLog 已写入 |
| 拒绝 | `PATCH {status:rejected}` | 状态变为 rejected，不执行 |
| UI 徽章 | 提交提案后 | 导航栏显示数量徽章 |
| 请求箱页面 | 打开页面 | 列表显示所有提案 |
| 引用跳转 | 点击引用 | 跳转到对应实体详情 |
| 编辑后执行 | 修改 action_params 后批准 | 以修改后的参数执行 |
| `npx tsc --noEmit` | 运行 | 0 errors |

---

## 完成回填

| 步骤 | 状态 | commit | 备注 |
|------|------|--------|------|
| 步骤 1 数据模型 | | | |
| 步骤 2 存储层 | | | |
| 步骤 3 执行器 | | | |
| 步骤 4 HTTP 路由 | | | |
| 步骤 5 前端类型+适配器 | | | |
| 步骤 6 通知徽章 | | | |
| 步骤 7 请求箱页面 | | | |
