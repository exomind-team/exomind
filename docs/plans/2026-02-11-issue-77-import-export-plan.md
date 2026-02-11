# Issue #77 Import/Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在设置页恢复 eventlog 的最小 JSON 导入/导出能力（MVP），满足 Issue #77 的验收标准。

**Architecture:** 以 `EventLogService` 作为数据入口，新增 `eventlog/backup` 纯函数模块负责 JSON 序列化/反序列化与合并策略。设置页只负责 UI 与文件读写交互，不直接操作底层存储结构。

**Tech Stack:** React 18, TypeScript, Vitest.

---

### Task 1: Add backup model and export helper

**Files:**
- Create: `src/lib/eventlog/backup.ts`
- Create: `tests/unit/eventlog/backup.test.ts`

**Step 1: Write the failing test**

```ts
it('exports backup v1 payload', () => {
  const payload = createBackupPayload([]);
  expect(payload.version).toBe(1);
  expect(Array.isArray(payload.events)).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/eventlog/backup.test.ts`
Expected: FAIL with missing module/function.

**Step 3: Write minimal implementation**

```ts
export interface EventLogBackupV1 { version: 1; exportedAt: string; events: EventData[] }
export function createBackupPayload(events: EventData[]): EventLogBackupV1 { ... }
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/eventlog/backup.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/eventlog/backup.ts tests/unit/eventlog/backup.test.ts
git commit -m "feat: add eventlog backup v1 model and export helper"
```

### Task 2: Add import parser and merge strategy

**Files:**
- Modify: `src/lib/eventlog/backup.ts`
- Modify: `tests/unit/eventlog/backup.test.ts`

**Step 1: Write the failing test**

```ts
it('merges imported events by id without duplicates', () => {
  const merged = mergeEventsById(existing, incoming);
  expect(merged).toHaveLength(3);
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/eventlog/backup.test.ts`
Expected: FAIL with missing merge/parser behavior.

**Step 3: Write minimal implementation**

```ts
export function parseBackupPayload(raw: string): EventLogBackupV1 { ... }
export function mergeEventsById(existing: EventData[], incoming: EventData[]): EventData[] { ... }
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/eventlog/backup.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/eventlog/backup.ts tests/unit/eventlog/backup.test.ts
git commit -m "feat: add eventlog backup import parse and merge strategy"
```

### Task 3: Expose import/export in EventLogService

**Files:**
- Modify: `src/lib/services/eventlog.service.ts`
- Modify: `tests/unit/eventlog/write.test.ts`
- Modify: `tests/unit/eventlog/read.test.ts`

**Step 1: Write the failing test**

```ts
it('exports eventlog backup json', async () => { ... });
it('imports eventlog backup in merge mode', async () => { ... });
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/eventlog/write.test.ts tests/unit/eventlog/read.test.ts`
Expected: FAIL with missing service APIs.

**Step 3: Write minimal implementation**

```ts
export interface EventLogService {
  exportEventsAsJson(): Promise<string>;
  importEventsFromJson(json: string, strategy: 'merge' | 'overwrite'): Promise<{ imported: number }>;
}
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/eventlog/write.test.ts tests/unit/eventlog/read.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/services/eventlog.service.ts tests/unit/eventlog/write.test.ts tests/unit/eventlog/read.test.ts
git commit -m "feat: expose eventlog json import/export service APIs"
```

### Task 4: Implement settings page UI for JSON import/export

**Files:**
- Modify: `src/components/Settings/SettingsPage.tsx`
- Create: `tests/unit/settings/import-export.test.tsx`

**Step 1: Write the failing test**

```tsx
it('renders import/export controls in settings page', () => { ... });
it('shows success or error feedback after import/export action', async () => { ... });
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/settings/import-export.test.tsx`
Expected: FAIL because controls/feedback not present.

**Step 3: Write minimal implementation**

```tsx
// 添加“导出 JSON”“导入 JSON”按钮和文件选择输入
// 使用 EventLogService 调用导入导出
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/settings/import-export.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/Settings/SettingsPage.tsx tests/unit/settings/import-export.test.tsx
git commit -m "feat: add settings UI for eventlog json import/export"
```

### Task 5: Verification and PR

**Files:**
- Create: `agent-output/debug/issue-77-manual-test.md`

**Step 1: Run verification commands**

```bash
bunx vitest run tests/unit/eventlog/backup.test.ts tests/unit/eventlog/read.test.ts tests/unit/eventlog/write.test.ts tests/unit/settings/import-export.test.tsx
```

Expected: PASS.

**Step 2: Write manual checklist evidence**

```md
1. 生成事件
2. 导出 JSON
3. 清空后导入
4. merge 去重验证
5. 非法 JSON 提示验证
```

**Step 3: Push and open PR**

```bash
git push -u origin feature/issue-77-import-export
gh pr create --base dev --head feature/issue-77-import-export --title "feat: add eventlog json import/export in settings (issue #77)" --body "Closes #77"
```

Expected: PR created successfully.
