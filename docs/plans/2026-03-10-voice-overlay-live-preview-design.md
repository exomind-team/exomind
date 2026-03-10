# 2026-03-10 语音悬浮窗实时预览设计

## 背景

当前全局语音快捷键悬浮窗只有阶段状态：

- `recording / 录音中`
- `recognizing / 识别中`
- `done / 完成`
- `error / 失败`

但没有 `partial transcript / 中间转写`，所以用户在说话过程中看不到文字反馈；同时窗口尺寸过小，最终文本也只能显示极短预览。

## 本次方案

本次先做一个低风险、可交付的两层方案：

1. `live preview / 实时预览`
   - 录音开始后，若运行环境支持 `SpeechRecognition / 浏览器原生语音识别`，并行启动一个只负责 UI 反馈的预览会话。
   - 预览文本只用于悬浮窗即时显示，不替代最终识别结果。
2. `final transcript / 最终转写`
   - 录音结束后，仍然使用当前设置中的 provider（`MOSS / 火山`）完成最终识别与粘贴、EventLog 双写。

## 文本显示策略

- 悬浮窗主文本统一显示 `latest 100 chars / 最新 100 字`。
- `recording / 录音中`：
  - 若有实时预览文本，主行显示预览文本；
  - 次行显示 `00:xx · 实时预览 · 再按结束`。
- `recognizing / 识别中`：
  - 保留最后一份实时预览文本；
  - 次行显示 `识别中...`。
- `done / 完成`：
  - 显示最终 provider 的结果文本；
  - 次行显示 `provider + recognitionMs / 识别引擎 + 耗时`。

## 窗口承载调整

- Tauri 悬浮窗从 `220x52` 提升到 `560x128`。
- 文本区域改为多行换行显示，避免只看到极短截断。

## 当前任务悬浮窗评估

当前仓库已经有页面内 `TaskCurrentRootCard / 当前根节点卡片`，说明“当前任务”数据链已存在：

- 计算：`src/lib/task/task-dag-graph.ts`
- 展示：`src/ui/app/components/TaskCurrentRootCard.tsx`
- 页面接入：`src/ui/app/pages/TasksPage.tsx`、`src/ui/app/pages/TaskDetailPage.tsx`

如果要做 `task overlay / 当前任务悬浮窗`，可以复用本次语音悬浮窗的外壳：

1. 新增一个 Tauri overlay window（或抽象成通用 overlay window 工厂）。
2. 新增 `task-overlay-state` 事件。
3. 在任务 store / DAG 计算完成后把当前根节点摘要推给悬浮窗。

## 后续演进

更完整的方向仍然是 `provider-native streaming / 提供商原生流式识别`：

- 火山可进一步升级成 Rust 侧长连接流式会话；
- MOSS 若后续提供 streaming API，再替换 live preview 数据源；
- 这样可以让“实时预览”和“最终结果”来自同一识别链路。
