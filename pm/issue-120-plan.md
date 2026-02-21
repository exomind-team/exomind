# Issue #120 事件日志交互优化（键盘快速记录/快速开始时间块）计划

目标：在「事件日志」页面把“记录事件/开始时间块/语音输入”做成更顺手的键盘流。

对应 Issue：https://github.com/exomind-team/exomind/issues/120

## 需求拆解（验收点）

页面：`/eventlog`（组件：`src/components/Chat/ChatPage.tsx`）

1. 未聚焦任何输入框时按 `Enter` → 自动聚焦「输入内容记录事件」输入框
2. 未聚焦任何输入框时按 `Shift+Enter` → 自动展开并聚焦「时间块名称（任务标题）」输入框
3. 「时间块名称」输入框有文字时按 `Enter` → 快速开始时间块
   - `Shift+Enter` 在该输入框内应插入换行（允许多行输入）
   - 若输入为多行：第一行 `trim` 后作为时间块名称；剩余内容整体 `trim` 后作为“开始时间块事件”的描述
4. 「时间块名称」输入框无内容时点击「开始」按钮 → 自动展开并聚焦「时间块名称」输入框（不启动时间块）
5. 「输入内容记录事件」输入框无内容时按 `Enter` → 开始语音记录（等价于点击左侧 🎤 按钮）

## 设计/实现方案

### 1) 统一键盘入口（ChatPage 全局快捷键）

在 `ChatPage` 增加 `window.keydown` 监听：
- 若当前焦点在 `input/textarea/contenteditable` 内 → 不拦截（避免影响正在输入/对话框等）
- `Enter`（无 Shift）→ 聚焦事件输入框（VoiceMessageInput 的 textarea）
- `Shift+Enter` → 展开并聚焦 TimeBlockWidget 的任务标题输入框

为了避免跨组件 DOM 查询耦合，采用 `ref + imperative handle`：
- `VoiceMessageInput` 暴露 `focusText()` / `startVoiceRecording()`
- `TimeBlockWidget` 暴露 `expandAndFocusTaskName()`

### 2) VoiceMessageInput：空 Enter 启动语音

在 `VoiceMessageInput` 的 textarea `onKeyDown`：
- `Enter` 且无 Shift：
  - 若 `value.trim()` 非空 → 发送（保持现有行为）
  - 若为空 → `preventDefault()` 并触发 `VoiceInputButton` 的“开始录音”

实现方式同样通过 `ref + imperative handle`：
- `VoiceInputButton` 增加 `forwardRef`，暴露 `start()`（仅在 idle/completed 时生效）

### 3) TimeBlockWidget：多行任务标题 + Enter 快速开始

将「任务标题」从单行 `Input` 替换为 `Textarea`：
- 支持 `Shift+Enter` 插入换行
- `Enter`（无 Shift）触发“开始时间块”

开始逻辑：
- 从 textarea 内容拆分行：
  - `name = firstLine.trim()`
  - `description = rest.join('\\n').trim()`（可为空）
- 调用 `TimeBlockService.startBlock(name, config, description?)`
- UI 内部将 `taskName` 归一到 `name`（避免时间块运行时显示多行）

“开始”按钮无任务名时：
- 不弹 destructive toast
- 自动 `setExpanded(true)` 并 focus 任务标题 textarea

### 4) 开始事件描述的落地（TimeBlockService）

扩展 `TimeBlockService.startBlock` 签名：`startBlock(name, config, description?)`
- 写入 `ActiveBlockData.name = name`
- 写入事件日志：`content = description ? name + '\\n' + description : name`

同时调整事件渲染：
- `ChatPage` 的事件内容增加 `whitespace-pre-wrap`，确保换行可见

## 测试计划

### 自动化

1) Playwright E2E：`tests/e2e/eventlog.test.ts`
- `Enter` 聚焦事件输入框
- `Shift+Enter` 展开并聚焦时间块名称输入框
- 时间块名称输入框填入内容后 `Enter` → 时间块进入 running（出现“暂停/结束”按钮），且事件列表出现 block_start 事件
- 点击「开始」且任务名为空 → 展开并聚焦时间块名称输入框

2) Vitest 单测
- `TimeBlockWidget`：补充“点击开始但无任务名 → 展开并聚焦输入框”的单测
- `VoiceMessageInput`：补充“空 Enter → 调用语音开始（而非发送）”的单测（通过 mock VoiceInputButton/ref）

### 手动验证（本地）

1. `bun install`
2. `bun dev` 打开 `/eventlog`
3. 按上述 5 条验收点逐条验证（尤其：未聚焦时 Enter/Shift+Enter、时间块多行输入 Enter 开始、事件渲染换行）

## 交付与 PR 要求

- 变更完成后执行：`bun test`、`bun test:e2e`、`bun run build`
- 推送到分支 `feature/issue-120`
- 使用 GitHub CLI 创建 Draft PR：base 为 `dev`
- PR 描述包含：
  - 实现要点（对应 1~5）
  - 验证方法（命令 + 手动步骤）

