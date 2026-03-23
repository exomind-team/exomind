# 批次 E：P1 Bug 急修

> **状态**：已完成
> **分支**：直接在 `dev` 上开发
> **关联 Issue**：#656, #654, #648
> **执行顺序**：#656 → #654 → #648

---

## Context

三个 P1 级别的功能性 bug，影响数据安全和日常可用性：

1. **#656**（P1 bug）：最新完整 JSON 导出再导入失败——全量 bundle（version:3）被误交给 EventLog 单域导入（只接受 version:1/2），报「不支持的备份版本」
2. **#654**（P1 bug）：时间块旧数据迁移失败时，错误模态框被超长文本撑爆，按钮不可达，页面锁死
3. **#648**（P1 feat）：清空本地缓存 / 重置所有设置还是占位项（`'敬请期待'`），需要变成真实可执行 + 二次确认

---

## 步骤 1：#656 全量 JSON 导入版本错配修复

### 1.1 问题分析

**根因**：`settings-data-service.ts` 的 `importBackupFromContent()` 把全量 bundle（version:3，含 events + tasks + timeblocks）直接交给 `eventLogService.importEventsFromJson(content)`，而 `eventlog/transfer.ts` 的 `parseTransferPayload()` 只接受 `SUPPORTED_VERSIONS = [1, 2]`，拒绝 version:3。

**修复方向**：`importBackupFromContent` 应先解析 bundle 版本，version:3 走全量导入路径（拆分 events/tasks/timeblocks 分别导入），version:1/2 走原有 EventLog 单域路径。

### 1.2 改动

**文件**：`src/services/impl/settings-data-service.ts`

```ts
async importBackupFromContent(content: string, strategy: ImportStrategy): Promise<ImportResult> {
  const parsed = JSON.parse(content);
  const version = parsed?.version;

  if (version === 3) {
    // ★ 全量 bundle 导入：拆分各域数据分别导入
    const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

    // 1. 导入事件日志
    if (parsed.events && Array.isArray(parsed.events)) {
      const eventsPayload = JSON.stringify({ version: 2, events: parsed.events });
      const eventsResult = await getEventLogService().importEventsFromJson(eventsPayload, strategy);
      result.imported += eventsResult.imported;
      result.skipped += eventsResult.skipped;
    }

    // 2. 导入任务
    if (parsed.tasks && Array.isArray(parsed.tasks)) {
      for (const task of parsed.tasks) {
        try {
          await getTaskService().createTask(task);
          result.imported++;
        } catch {
          result.skipped++;
        }
      }
    }

    // 3. 导入时间块
    if (parsed.timeblocks && Array.isArray(parsed.timeblocks)) {
      for (const block of parsed.timeblocks) {
        try {
          await getTimeBlockService().importCompletedBlock(block);
          result.imported++;
        } catch {
          result.skipped++;
        }
      }
    }

    return result;
  }

  // version:1/2 → 原有 EventLog 单域导入
  return getEventLogService().importEventsFromJson(content, strategy);
}
```

**注意**：
- 检查 `exportBackup()` 的实际 bundle 结构，确认 `parsed.events` / `parsed.tasks` / `parsed.timeblocks` 的字段名是否匹配
- 检查 `getTimeBlockService()` 是否有 `importCompletedBlock` 方法，如果没有需要用 `replaceCompletedScoped` 或类似方法
- 检查 `getTaskService().createTask` 是否能接受包含 `id` 的完整 TaskNode（用于恢复而非新建），如果不能，可能需要用底层 port 直接写入

### 1.3 验证

```bash
bunx tsc --noEmit
bunx vitest run tests/unit/services/settings-data-service.test.ts
```

**新增测试**：

```ts
describe('#656 全量 bundle 导入', () => {
  it('version:3 bundle 不应报版本错误', async () => {
    const bundle = JSON.stringify({
      version: 3,
      events: [{ id: 'e1', content: '测试', createdAt: '2026-03-22T00:00:00Z', type: 'note' }],
      tasks: [],
      timeblocks: [],
    });
    const result = await service.importBackupFromContent(bundle, 'merge');
    expect(result.errors ?? []).toHaveLength(0);
    expect(result.imported).toBeGreaterThan(0);
  });

  it('version:2 单域导入仍正常工作', async () => {
    // 原有测试不回归
  });
});
```

---

## 步骤 2：#654 迁移错误模态框撑爆修复

### 2.1 问题分析

**根因**：`MigrationDialog.tsx` 的错误态直接渲染 `{error}` 长文本，无最大高度/滚动限制。同时 `onInteractOutside={(e) => e.preventDefault()}` 阻止点外关闭，按钮被挤出视口时用户被完全锁死。

### 2.2 改动

**文件**：`src/ui/components/MigrationDialog.tsx`

**3 处修复**：

1. **错误文本加滚动容器**：

```tsx
// 错误态正文：
<div className="max-h-[40vh] overflow-y-auto rounded-lg bg-[#FEF2F2] p-3 text-xs text-[#991B1B] dark:bg-[#450A0A] dark:text-[#FCA5A5]">
  <pre className="whitespace-pre-wrap break-all font-mono">{error}</pre>
</div>
```

2. **底部按钮始终可达**：确保按钮在 `DialogFooter` 中，不被内容挤出。如果当前不在 footer 中，移入：

```tsx
<DialogFooter className="mt-4 flex-shrink-0">
  <button onClick={handleFallback}>继续使用旧版存储</button>
  <button onClick={handleRetry}>重试</button>
</DialogFooter>
```

3. **允许 Esc 关闭**（退出到旧版存储）：

```tsx
<Dialog
  open={open}
  onOpenChange={(isOpen) => {
    if (!isOpen) handleFallback();  // Esc/点外 = 继续使用旧版
  }}
>
  <DialogContent
    onInteractOutside={(e) => {
      // 错误态允许点外关闭，非错误态仍阻止
      if (!error) e.preventDefault();
    }}
  >
```

### 2.3 验证

```bash
bunx tsc --noEmit
```

**手动验证**：
- 模拟迁移失败（传入 500 字符错误文本）→ 模态框内滚动，按钮可见 ✓
- 按 Esc → 退出到旧版存储 ✓
- 点击模态框外部（错误态）→ 同上 ✓
- 正常迁移流程不受影响 ✓
- 手机窄屏下按钮仍可达 ✓

---

## 步骤 3：#648 清空缓存 / 重置设置真实实现

### 3.1 改动概览

**文件**：`src/ui/app/config/settings/settings-registry.ts`

将两个占位项改为真实实现。

### 3.2 「清空本地缓存」实现

**语义定义**：清除 UI 层面的临时缓存和偏好，**不**清除核心数据（事件日志、任务、时间块、档案）。

**清除范围**：
- 所有 `exomind:*` localStorage key（DAG 偏好、搜索选项、折叠状态、模式记忆、路由记忆等）
- 所有 sessionStorage
- 不清除 RT SQLite 数据
- 不清除 EventLog / Task / TimeBlock 持久化数据

```ts
{
  id: 'clear-local-cache',
  label: '清空本地缓存',
  description: '清除 UI 偏好与临时缓存，不影响事件日志、任务和时间块数据',
  confirmMessage: '确认清空本地缓存？UI 偏好（DAG 布局、搜索选项、模式记忆等）将恢复默认。事件日志、任务和时间块数据不受影响。',
  onAction: () => {
    // 遍历清除 exomind:* 前缀的 localStorage key
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('exomind:')) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
    sessionStorage.clear();
    return '已清空本地缓存，刷新页面后生效';
  },
}
```

### 3.3 「重置所有设置」实现

**语义定义**：清除所有设置项（含火山配置、快捷键、语音偏好等），恢复到出厂默认值。**不**清除用户数据。

**清除范围**：
- 所有 localStorage（不仅是 `exomind:*`，还包括火山配置的 `VOLCANO_*` key 等）
- sessionStorage
- 不清除 RT SQLite 数据

```ts
{
  id: 'reset-all-settings',
  label: '重置所有设置',
  description: '将所有设置项恢复为默认值，不影响事件日志、任务和时间块数据',
  confirmMessage: '确认重置所有设置？所有配置（含 API Key、快捷键、UI 偏好）将恢复默认。事件日志、任务和时间块数据不受影响。',
  onAction: () => {
    localStorage.clear();
    sessionStorage.clear();
    return '已重置所有设置，刷新页面后生效';
  },
}
```

### 3.4 二次确认 UI

**文件**：`src/ui/app/components/settings/settings-renderers.tsx`

检查 `confirmMessage` 是否已被渲染为确认弹窗。如果当前只是 `window.confirm()`，改为 shadcn `AlertDialog`：

```tsx
// 危险操作应使用 AlertDialog 而非 window.confirm
<AlertDialog>
  <AlertDialogTrigger asChild>
    <button className="text-[#EF4444] ...">清空本地缓存</button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{item.label}</AlertDialogTitle>
      <AlertDialogDescription>{item.confirmMessage}</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>取消</AlertDialogCancel>
      <AlertDialogAction onClick={() => item.onAction()} className="bg-[#EF4444]">
        确认{item.label}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

**注意**：检查项目中是否已有 `AlertDialog` 组件（shadcn/ui）。如果没有，用已有的 `Dialog` 替代。

### 3.5 验证

```bash
bunx tsc --noEmit
```

**手动验证**：
- 点击「清空本地缓存」→ 弹出确认对话框 ✓
- 确认后 → localStorage `exomind:*` key 被清除，sessionStorage 清空 ✓
- 刷新页面 → DAG 偏好回到默认 ✓
- 事件日志、任务、时间块数据仍在 ✓
- 点击「重置所有设置」→ 弹出确认对话框 ✓
- 确认后 → 所有 localStorage 清除 ✓
- 火山配置、快捷键等恢复默认 ✓

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
|------|---------|-------|
| `src/services/impl/settings-data-service.ts` | 全量 bundle 版本分流 | #656 |
| `src/ui/components/MigrationDialog.tsx` | 错误文本滚动 + Esc 退出 | #654 |
| `src/ui/app/config/settings/settings-registry.ts` | 清空缓存 / 重置设置实现 | #648 |
| `src/ui/app/components/settings/settings-renderers.tsx` | 二次确认 AlertDialog | #648 |
| `tests/unit/services/settings-data-service.test.ts` | 新增 version:3 导入测试 | #656 |

---

## ⚠️ 不要做清单

| 禁止项 | 原因 |
|--------|------|
| **不要改动 `eventlog/transfer.ts` 的 SUPPORTED_VERSIONS** | version:3 不是 EventLog 格式，不应让 EventLog parser 识别它 |
| **不要删除 MigrationDialog 的 `onInteractOutside` 阻止** | 正常迁移流程仍需阻止点外关闭，只在错误态放开 |
| **不要在「清空缓存」中清除 RT SQLite 数据** | 清空缓存 ≠ 删除用户数据 |
| **不要在「重置设置」中清除 RT SQLite 数据** | 重置设置 ≠ 删除用户数据 |
| **不要改动导出逻辑** | 导出 version:3 格式是正确的，只需修导入端 |

## ⚠️ 容易出错的关键点

1. **#656 bundle 结构字段名**：检查 `exportBackup()` 实际输出的字段名（可能是 `events`/`tasks`/`timeblocks`，也可能是其他命名），导入端必须匹配
2. **#656 任务导入的 id 保留**：恢复备份时任务需要保留原 id（幂等），`createTask` 可能不支持。检查是否需要用底层 `task.port.createTask` 或 `upsert` 方法
3. **#656 导入顺序**：先导入任务再导入时间块（时间块可能引用 taskId）
4. **#654 错误态判断**：确认 MigrationDialog 中 `error` 状态的变量名和位置，可能是 props 或内部 state
5. **#654 DialogContent 的 max-height**：错误文本用 `max-h-[40vh]` 限制，确保在手机上也不会超出屏幕
6. **#648 localStorage key 前缀不统一**：项目中有 `exomind:*` 前缀的 key，也有火山配置用的 `VOLCANO_*` 前缀。「清空缓存」只清 `exomind:*`，「重置设置」清全部
7. **#648 确认弹窗组件**：检查 shadcn/ui 是否已有 `AlertDialog`，没有就用 `Dialog` + 红色确认按钮替代
8. **#648 执行后需要刷新**：清除 localStorage 后当前页面的 state 不会自动更新，需要 `window.location.reload()` 或返回提示「刷新页面后生效」

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 全量导入 | 导出 version:3 bundle → 导入 | 成功，无版本错误 | #656 |
| 单域导入 | 导入 version:2 EventLog JSON | 仍然正常 | #656 |
| 迁移错误-长文本 | 模拟 500 字符错误 | 模态框内滚动，按钮可见 | #654 |
| 迁移错误-Esc | 按 Esc | 退出到旧版存储 | #654 |
| 迁移错误-手机 | 窄屏查看错误态 | 按钮可达 | #654 |
| 清空缓存-确认 | 点击清空缓存 | 弹出确认对话框 | #648 |
| 清空缓存-执行 | 确认清空 | exomind:* key 清除 | #648 |
| 清空缓存-数据安全 | 清空后 | 事件/任务/时间块数据仍在 | #648 |
| 重置设置-确认 | 点击重置设置 | 弹出确认对话框 | #648 |
| 重置设置-执行 | 确认重置 | 所有 localStorage 清除 | #648 |
| 重置设置-数据安全 | 重置后 | RT 数据不受影响 | #648 |
| tsc | `bunx tsc --noEmit` | 零错误 | 全部 |

---

## 完成回填

- 已完成 #656 / #654 / #648 三项修复，并保持 `eventlog/transfer.ts` 的 `SUPPORTED_VERSIONS` 不变。
- #656：`src/services/impl/settings-data-service.ts` 现会先解析 `version`；当 `version === 3` 时，按真实 bundle 字段 `events / tasks / time_blocks / active_block` 分别导入，事件域会被重写为 version:2 payload 后再交给 EventLog 导入器；version:1/2 仍走原有单域事件导入路径。
- #654：`src/ui/components/MigrationDialog.tsx` 错误态已改为 `max-h-[40vh]` 滚动错误容器，`DialogFooter` 固定可达，并允许错误态通过 Esc / 点外退出；非错误态仍保持点外不可关闭。
- #648：`src/ui/app/config/settings/settings-registry.ts` 已实现「清空本地缓存」与「重置所有设置」真实逻辑：前者只删除 `exomind:*` localStorage key 并清空 sessionStorage，后者清空全部 localStorage 与 sessionStorage；两者都不会触碰 RT SQLite 数据。`src/ui/app/components/settings/settings-renderers.tsx` 已为危险 action 改为二次确认 Dialog。
- 新增/更新测试：
  - `tests/unit/services/settings-data-service.test.ts`
  - `tests/unit/ui/migration-dialog.test.tsx`
  - `tests/unit/settings/settings-renderers.test.tsx`
  - `tests/unit/settings/settings-registry-coverage.test.ts`
- 验证命令：
  - `bunx tsc --noEmit`
  - `bunx vitest run tests/unit/services/settings-data-service.test.ts tests/unit/ui/migration-dialog.test.tsx tests/unit/settings/settings-renderers.test.tsx tests/unit/settings/settings-registry-coverage.test.ts`
