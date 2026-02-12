# Issue #65 EventLog 懒加载（方案 B）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `/eventlog` 实现“存储分页 + 顶部无限滚动”，在不改变核心业务行为的前提下显著降低首屏加载成本。

**Architecture:** 在 `EventStorage` 增加基于 cursor 的分页读取接口，保留现有 `getEvents()` 兼容路径；`ChatPage` 改为首屏拉取最近一页、滚动到顶部拉取更早页，并通过滚动高度差修正避免视口跳动。分页返回顺序保持“新到旧”，UI 层统一转换成“旧到新”渲染。

**Tech Stack:** React 18, TypeScript, PouchDB, Vitest, Testing Library

---

### Task 1: 为 EventStorage 增加分页读取能力

**Files:**
- Modify: `src/lib/storage/event-storage.ts`
- Test: `tests/storage/event-storage.test.ts`

**Step 1: Write the failing test**

在 `tests/storage/event-storage.test.ts` 新增 `getEventsPage` 用例：
- 首次分页应返回最近 N 条、`hasMore=true`、`nextCursor` 有值
- 使用 `nextCursor` 拉取下一页时不重复且顺序正确

**Step 2: Run test to verify it fails**

Run: `bun test tests/storage/event-storage.test.ts`
Expected: `getEventsPage` 相关断言失败（方法不存在或行为不符）

**Step 3: Write minimal implementation**

在 `src/lib/storage/event-storage.ts` 增加：
- `EventPageCursor` / `EventPageResult` 类型
- `getEventsPage({ limit, cursor })` 方法
- 设计文档 `by_created_at` 改为复合 key（时间 + 文档 ID）以稳定分页游标

**Step 4: Run test to verify it passes**

Run: `bun test tests/storage/event-storage.test.ts`
Expected: 全部通过

**Step 5: Commit**

```bash
git add src/lib/storage/event-storage.ts tests/storage/event-storage.test.ts
git commit -m "feat: add cursor pagination for event storage"
```

### Task 2: ChatPage 接入分页与顶部无限滚动

**Files:**
- Modify: `src/components/Chat/ChatPage.tsx`
- Create: `src/components/Chat/chat-event-pagination.ts`
- Test: `tests/unit/chat/chat-event-pagination.test.ts`

**Step 1: Write the failing test**

新增纯函数测试：
- 将“新到旧”分页数据转换为“旧到新”显示顺序
- prepend 历史页时按 ID 去重
- 合并新消息时保持时间升序

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/chat/chat-event-pagination.test.ts`
Expected: 模块不存在或断言失败

**Step 3: Write minimal implementation**

- 新建 `chat-event-pagination.ts` 承担转换/合并去重纯逻辑
- `ChatPage` 改为：
  - 首屏调用 `getEventsPage({limit: 50})`
  - 列表 `onScroll` 顶部触发 `loadOlderEvents`
  - 使用滚动高度差修正避免跳屏
  - 发送消息/远程变更后只刷新最新页并合并

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/chat/chat-event-pagination.test.ts`
Expected: 全部通过

**Step 5: Commit**

```bash
git add src/components/Chat/ChatPage.tsx src/components/Chat/chat-event-pagination.ts tests/unit/chat/chat-event-pagination.test.ts
git commit -m "feat: add reverse infinite scroll for eventlog"
```

### Task 3: 回归验证与文档更新

**Files:**
- Modify: `docs/specs/` or `docs/plans/`（若需补充行为说明）

**Step 1: Run targeted tests**

Run: `bun test tests/storage/event-storage.test.ts tests/unit/chat/chat-event-pagination.test.ts tests/components/ChatPage.test.tsx`
Expected: 通过

**Step 2: Run build**

Run: `bun run build`
Expected: 构建通过

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs: document eventlog lazy loading behavior"
```

