修复 #640 的遗留偏差（批次 FH 中未完成的部分）。

## 现状确认

当前代码里这 3 处仍未完全落地：

1. `useTaskDagKeyboard.ts` 仍使用 `Ctrl+←/→`
2. `TaskDagModeSelector.tsx` 仍没有模式切换条 `onWheel`
3. `TaskDagKeyHints.tsx` 的提示文案仍是 `Ctrl+←/→`

因此这次需要把“快捷键 + 模式切换条滚轮 + 用户可见文案”补齐成一致行为。

## 需要修改 3 处

1. **`useTaskDagKeyboard.ts`**：模式切换快捷键从 `Ctrl+←/→` 改为 `Ctrl+Alt+←/→`
   ```ts
   // 原来：if (event.ctrlKey && (key === 'ArrowLeft' || key === 'ArrowRight'))
   // 改为：if (event.ctrlKey && event.altKey && (key === 'ArrowLeft' || key === 'ArrowRight'))
   ```
   注意：
   - 不要改动其它已有键盘逻辑。
   - 仍然保持“输入框聚焦时不处理 DAG 快捷键”的现有保护。
   - 不要破坏 browse / connect / execute 其它键位。

2. **`TaskDagModeSelector.tsx`**：模式切换条根容器新增 `onWheel`（无需修饰键）
   ```tsx
   onWheel={(event) => {
     event.preventDefault();
     const delta = event.deltaY > 0 ? 1 : -1;
     const currentIndex = enabledOptions.findIndex((o) => o.key === mode);
     const nextIndex = (currentIndex + delta + enabledOptions.length) % enabledOptions.length;
     onChange(enabledOptions[nextIndex].key);
   }}
   ```
   注意：
   - `onWheel` 加在包含三个模式按钮的容器上，不是整个页面。
   - 只在“模式切换条悬浮滚轮”时触发；不要影响画布区域现有 `Ctrl+Alt+滚轮` 逻辑。
   - 只在**已启用模式**之间循环，不要切到禁用模式。
   - 需要 `preventDefault()`，避免误触页面滚动。

3. **`TaskDagKeyHints.tsx`**：提示板中的 `Ctrl+←/→` 文案改为 `Ctrl+Alt+←/→`

## 额外检查

除了上述 3 处，额外扫一遍是否还残留旧文案或旧断言：

- `src/` 下与 DAG 模式切换相关的用户可见文案
- `tests/` 下与 `Ctrl+←/→` 相关的断言/说明

如果存在旧文案，统一改成 `Ctrl+Alt+←/→`，避免实现和提示不一致。

## 验证

至少执行：

1. `bunx tsc --noEmit`
2. `bunx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx`

如果现有测试没有覆盖“模式切换条滚轮”和“快捷键文案更新”，就补对应断言，而不是只改实现。
