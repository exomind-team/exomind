# Issue #175 · v0.3.0 UI重构（mobile-first）

## 1) 目标与范围（Scope）
- 以 Pencil 设计稿为基准，重构两张核心页面：`当下（Focus Timer）`、`设置（Settings）`。
- 保留现有功能能力（事件日志、计时器、导入导出、同步地址、主题、开发者模式）。
- 过渡期双 UI 并存：`旧 UI -> 新 UI` 与 `新 UI -> 旧 UI` 均可切换。
- `MOSS测试 / ASR测试` 仅在设置页「开发者模式」开启后显示入口。
- 移除旧首页对 `语音聊天（火山模型）` 的入口暴露。
- 版本统一为 `v0.3.0`。

## 2) 实现技术方案（Technical Plan）
- 新 UI 路由层：使用 `src/routes-new.tsx` 承载移动端壳层（393 宽设计基准、底部导航、卡片化容器）。
- 新 UI 页面层：
  - `src/ui/new/pages/NewFocusPage.tsx`：顶部任务卡 + 事件/输入主区（复用事件日志核心逻辑）。
  - `src/ui/new/pages/NewSettingsPage.tsx`：按设计稿拆分为外观/计时器/网络同步/导入导出/开发者分组卡片。
- 事件日志能力复用：`src/components/Chat/ChatPage.tsx`
  - 新增 `variant` 与 `hideHeader`，实现「保留能力 + 新外观壳层」。
- 安全区与遮挡治理：
  - 新增 `safe-area-pt-plus`，统一处理状态栏顶部安全区。
  - 新 UI 底部导航统一使用 `env(safe-area-inset-bottom)`，避免手势条遮挡输入区/导航区。

## 3) 架构变动（Architecture Changes）
- UI Mode 切换架构保持不变（`localStorage + custom event`），新增页面持续沿用：
  - `src/config/ui-mode.ts`
  - `src/App.tsx`（根据 `uiMode` 选择 `router` / `newUiRouter`）。
- Android/CI 链路增强（权限与构建一致性）：
  - Manifest 注入改为双权限：`RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`。
  - `release` 构建块确保 `usesCleartextTraffic=true`。
  - 工作流与脚本一致化，避免“本地可跑 / CI 漏检”。

## 4) UI逻辑（UX Logic）
- 新 UI 默认移动优先：
  - `当下` 与 `设置` 放入底部二级导航。
  - 顶部与底部均做安全区补偿，减少 Android 状态栏遮挡风险。
- 双 UI 过渡逻辑：
  - 旧设置页：`切换到新 UI`。
  - 新设置页：`返回旧 UI`。
- 开发者模式逻辑：
  - 关闭：隐藏 `MOSS/ASR` 快捷入口。
  - 开启：显示测试入口，便于联调与验收。

## 5) 人工验收 DoD（Definition of Done）
- [ ] 旧设置页可见 `切换到新 UI`，点击后进入新 UI。
- [ ] 新设置页可见 `返回旧 UI`，点击后回到旧 UI。
- [ ] 新 UI `当下` 页面可正常新增事件、语音输入按钮可见、计时器控件可操作。
- [ ] 新 UI `设置` 页面：主题切换、同步地址保存/恢复、导入/导出可操作。
- [ ] 开发者模式开启后显示 `MOSS测试 / ASR测试` 入口；关闭后隐藏。
- [ ] Android 模拟器中顶部不被状态栏遮挡，底部导航与输入区不互相覆盖。
- [ ] 首页不再暴露 `语音聊天（火山模型）` 入口。
- [ ] 版本号在前后端一致为 `0.3.0`（`package.json` / `tauri.conf.json` / `Cargo.toml`）。

## 6) 验证证据（Verification Evidence）
- 单测：
  - `bun run test tests/unit/scripts/android-manifest-permission-lib.test.ts tests/unit/settings/ui-transition.test.tsx tests/unit/ui/ui-mode.test.ts`
- 构建：
  - `bun run build`
- Android 初始化与运行：
  - `bun run tauri android init`
  - `bun run tauri android dev`
  - Tauri MCP 已连通并可抓取页面结构/截图。

## 7) 截图（Screenshots）
- 新 UI · 当下（Android）
  - `docs/screenshots/issue-175/new-ui-now-android.png`
- 新 UI · 设置（Android）
  - `docs/screenshots/issue-175/new-ui-settings-android.png`
- 旧 UI · 设置页新 UI 入口（Android）
  - `docs/screenshots/issue-175/old-ui-settings-transition-entry.png`

