# Issue #24 / PR #32 调试报告

日期: 2026-02-10  
分支: `feature/fix-timeblock-storage`

## 现象

使用 `tests/e2e/debug-feedback.js` 复现时，流程显示:

1. `block_start` 正常写入并显示
2. `block_end` 正常写入并显示
3. 输入反馈后点击“确认结束”，`block_feedback` 未显示在 eventlog

浏览器日志里可见事件数量停在 2 条，反馈事件未进入当前列表。

## 排查过程

1. 先跑 `node tests/e2e/debug-feedback.js`，确认问题稳定复现。
2. 放开控制台过滤后观察调用顺序，发现第一次“结束”点击已经触发了 `handleEndBlock`，且参数是空字符串。
3. 继续检查倒计时启动逻辑，确认 `startBlock()` 返回了倒计时初始值，但组件本地 `elapsed` 没有同步该值，UI 仍从 `0` 开始。
4. 倒计时从 `0` 开始会立即进入结束态，导致后续“结束/确认结束”流程出现空反馈先提交，真实反馈提交时 `active_block` 已被清除。

## 根因

根因是 **TimeBlockWidget 与 TimeBlockService 的倒计时初始值状态不同步**:

- Service 侧应持有倒计时剩余毫秒
- Widget 侧未在开始后同步 `block.elapsed`
- 结果是倒计时 UI 误判为立即结束，流程状态机提前进入结束路径

## 修复内容

1. `src/lib/services/timeblock.service.ts`
   - `startBlock()` 为 `countdown` 正确初始化 `elapsed`:
     - `elapsed = (minutes ?? 25) * 60 * 1000`
   - `targetMinutes` 使用同样的默认值回写，避免 `undefined`。

2. `src/components/TimeBlockWidget.tsx`
   - `handleStart()` 在 `startBlock()` 后追加:
     - `setElapsed(block.elapsed)`
   - 保证 UI 计时状态与 Service 一致，不再从 `0` 起跑。

3. 新增回归测试:
   - `tests/unit/services/timeblock.service.test.ts`
   - 覆盖点:
     - countdown 启动初始毫秒正确
     - 结束时有反馈会写入 `block_feedback`

## 验证结果

1. `npx vitest run tests/unit/services/timeblock.service.test.ts` 通过
2. `npm run build` 通过
3. `node tests/e2e/debug-feedback.js` 复测通过:
   - 日志出现 `type=block_feedback`
   - eventlog 中可见反馈内容与 `📝` 标记

## 结论

Issue #24 涉及的“反馈事件未记录”问题已定位并修复，复测路径与脚本验证均通过。
