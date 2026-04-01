# 实施计划：提案系统 — UI 端

> **状态**：待执行（依赖 RT 计划完成）
> **设计文档**：[2026-04-01-agent-api-and-proposal-system-design.md](./2026-04-01-agent-api-and-proposal-system-design.md)
> **关联 Issue**：#677
> **分支**：`feature/proposal-system-ui`
> **前置依赖**：`proposal-system-rt-plan.md` 完成（HTTP 端点可用）
> **验收标准**：用户在 UI 中看到提案通知 → 进入请求箱 → 查看详情和引用 → 批准后任务创建

---

## 步骤 0：前置检查（确认 RT 端点可用）

```bash
# 确认 RT 正在运行且提案端点可用
curl -s http://127.0.0.1:1949/api/proposals | jq .
# 预期：返回 [] 或提案列表（不是 404）

# 提交测试提案，确认创建正常
curl -s -X POST http://127.0.0.1:1949/api/proposals \
  -H "Content-Type: application/json" \
  -d '{
    "title": "UI 联调测试提案",
    "action_type": "create_task",
    "action_params": {"title": "测试任务"},
    "publisher": {"publisher_type": "agent", "id": "test", "name": "Test"}
  }' | jq .id
# 预期：返回自增 id（如 1）

# 确认前端项目路由注册位置
grep -n "Route\|path\|createRoute" src/ui/app/router.tsx | head -20

# 确认导航栏/侧边栏位置（徽章插入点）
find src/ui -name "*.tsx" | xargs grep -l "Sidebar\|sidebar\|导航\|nav" | head -10

# 确认现有 RT 适配器模式（参考 eventlog-rt-adapter.ts）
head -40 src/lib/adapters/eventlog-rt-adapter.ts
```

---

## 步骤 1：类型定义

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

export interface CreateProposalPayload {
  title: string;
  body?: string;
  action_type: ActionType;
  action_params: Record<string, unknown>;
  references?: ProposalRef[];
  publisher: Publisher;
}

export interface UpdateProposalPatch {
  status?: ProposalStatus;
  action_params?: Record<string, unknown>;
  snooze_until?: string;
}
```

### 验证

```bash
npx tsc --noEmit
```

---

## 步骤 2：RT 适配器

**新建文件**：`src/lib/adapters/proposal-rt-adapter.ts`

参考 `src/lib/adapters/eventlog-rt-adapter.ts` 的实现模式。

```typescript
import type {
  Proposal,
  ProposalStatus,
  CreateProposalPayload,
  UpdateProposalPatch,
  Publisher,
} from '@/lib/types/proposal';

// ★ 先确认项目中 RT 请求的通用函数
// grep -n "fetchRT\|rtFetch\|getRuntimeUrl" src/lib/adapters/ -r | head -10

export async function listProposals(filter?: {
  status?: ProposalStatus;
}): Promise<Proposal[]> {
  const params = new URLSearchParams();
  if (filter?.status) params.set('status', filter.status);
  const url = `/api/proposals${params.toString() ? `?${params}` : ''}`;
  // 使用项目统一的 RT fetch 函数
  const response = await fetch(url);
  return response.json();
}

export async function getProposal(id: number): Promise<Proposal> {
  const response = await fetch(`/api/proposals/${id}`);
  return response.json();
}

export async function createProposal(
  payload: CreateProposalPayload,
): Promise<Proposal> {
  const response = await fetch('/api/proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response.json();
}

export async function updateProposal(
  id: number,
  patch: UpdateProposalPatch,
): Promise<Proposal> {
  const response = await fetch(`/api/proposals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return response.json();
}

export async function addComment(
  id: number,
  content: string,
  author: Publisher,
): Promise<Proposal> {
  const response = await fetch(`/api/proposals/${id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, author }),
  });
  return response.json();
}
```

**注意**：上方 `fetch` 调用需替换为项目统一的 RT 请求函数。先执行前置检查中的 grep 确认实际用法。

### 验证

```bash
npx tsc --noEmit
```

---

## 步骤 3：全局通知徽章

**新建文件**：`src/ui/app/components/ProposalNotificationBadge.tsx`

**前置检查**：
```bash
# 确认导航栏结构和已有徽章模式
grep -n "Badge\|badge\|notification" src/ui/app/layout/ -r | head -10
grep -n "Badge\|badge\|notification" src/ui/app/components/ -r | head -10
```

**功能**：
- 轮询 `GET /api/proposals?status=pending`（每 30 秒）
- 显示未处理提案数量（数字徽章）
- 点击跳转到请求箱页面

```tsx
import { useEffect, useState } from 'react';
import { listProposals } from '@/lib/adapters/proposal-rt-adapter';

export function ProposalNotificationBadge() {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const poll = async () => {
      const proposals = await listProposals({ status: 'pending' });
      setPendingCount(proposals.length);
    };
    poll();
    const interval = setInterval(poll, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (pendingCount === 0) return null;

  return (
    <a href="/proposals" className="relative">
      {/* 图标 + 数字徽章 */}
      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
        {pendingCount}
      </span>
    </a>
  );
}
```

**插入位置**：在导航栏/侧边栏中引入此组件。具体位置通过前置检查的 grep 确认。

### 验证

```bash
npx tsc --noEmit
# 手动验证：curl 添加提案后 → 等 30 秒或刷新 → 徽章显示数量
```

---

## 步骤 4：请求箱页面

**新建文件**：`src/ui/app/pages/ProposalInboxPage.tsx`

### 布局

```
┌──────────────────────────────────────────────────┐
│  请求箱                                    [过滤]  │
├──────────────────┬───────────────────────────────┤
│  提案列表         │  提案详情                      │
│                  │                               │
│  #3 ● 待处理     │  #3 建议：整理会议记录          │
│  #2 ○ 审议中     │                               │
│  #1 ✓ 已批准     │  理由：检测到今天有未记录的...   │
│                  │                               │
│                  │  引用：                        │
│                  │  📎 09:32 团队会议 [↗ 跳转]    │
│                  │                               │
│                  │  动作：创建任务                  │
│                  │  标题：[整理会议记录]  ← 可编辑  │
│                  │                               │
│                  │  评论区：                       │
│                  │  Agent: 这是基于今天...         │
│                  │                               │
│                  │  [✓ 批准执行] [✗ 拒绝] [⏸ 暂缓] │
└──────────────────┴───────────────────────────────┘
```

### 引用跳转（MVP）

```typescript
function jumpToRef(ref: ProposalRef) {
  switch (ref.ref_type) {
    case 'event': navigate(`/eventlog?highlight=${ref.id}`); break;
    case 'timeblock': navigate(`/timeblocks?highlight=${ref.id}`); break;
    case 'task': navigate(`/tasks?highlight=${ref.id}`); break;
  }
}
```

### 操作按钮

| 按钮 | API 调用 | 说明 |
|------|---------|------|
| 批准执行 | `PATCH { status: 'approved' }` | 立即执行对应动作 |
| 编辑后执行 | 先 `PATCH { action_params }` 再 `PATCH { status: 'approved' }` | 修改参数后执行 |
| 拒绝 | `PATCH { status: 'rejected' }` | 归档不执行 |
| 暂缓 | `PATCH { status: 'snoozed' }` | 回到 pending，保留不处理 |

### 在路由中注册

```bash
# 先确认路由注册方式
grep -n "createRoute\|Route\|path" src/ui/app/router.tsx | head -20
```

在路由配置中新增：
```typescript
// 路径：/proposals
// 组件：ProposalInboxPage
```

### 验证

```bash
npx tsc --noEmit
npx vite --host 0.0.0.0 --port 5173

# 手动验证全流程：
# 1. curl 提交提案
# 2. 刷新 UI，确认通知徽章显示
# 3. 点击进入请求箱页面
# 4. 确认列表显示提案
# 5. 点击提案查看详情
# 6. 点击引用确认跳转
# 7. 点击"批准执行"
# 8. 确认任务已创建（检查任务列表或 curl 验证）
```

---

## ⚠️ 容易出错的关键点

1. **RT 请求函数不统一**：项目中可能有多种 fetch 封装（裸 fetch / rtFetch / Tauri invoke），需确认当前环境用哪个
2. **轮询性能**：30 秒轮询 MVP 足够，后续可改为 WebSocket / SSE 推送
3. **引用跳转路径**：`/eventlog`、`/timeblocks`、`/tasks` 路径需与实际路由一致，先 grep 确认
4. **action_params 编辑 UI**：不同 action_type 的参数结构不同，MVP 可用 JSON 文本编辑器，后续为每种类型做专用表单
5. **状态颜色/图标映射**：pending=黄色、in_review=蓝色、approved=绿色、rejected=红色、snoozed=灰色

---

## 验证总表

| 场景 | 操作 | 期望结果 |
|------|------|---------|
| 通知徽章 | curl 添加提案后刷新 | 导航栏显示数量徽章 |
| 请求箱列表 | 打开 /proposals | 显示所有提案，pending 在前 |
| 提案详情 | 点击列表项 | 右侧显示标题/理由/引用/参数/评论 |
| 引用跳转 | 点击引用的跳转按钮 | 导航到对应实体页面 |
| 批准执行 | 点击"批准执行" | 提案状态变 approved，任务创建 |
| 编辑后执行 | 修改标题后批准 | 以新标题创建任务 |
| 拒绝 | 点击"拒绝" | 状态变 rejected |
| 暂缓 | 点击"暂缓" | 状态变 snoozed |
| `npx tsc --noEmit` | 运行 | 0 errors |

---

## 完成回填

| 步骤 | 状态 | commit | 备注 |
|------|------|--------|------|
| 步骤 1 类型定义 | | | |
| 步骤 2 RT 适配器 | | | |
| 步骤 3 通知徽章 | | | |
| 步骤 4 请求箱页面 | | | |
