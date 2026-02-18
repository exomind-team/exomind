# Issue #40 暗色模式：实施计划

## 背景 / 需求

- Issue：exomind-team/exomind#40（暗色模式）
- 诉求：支持 Chrome 手机版等无法通过浏览器扩展强制暗色的场景，应用自身提供暗色模式切换能力。

## 现状调研结论

- Tailwind 已配置 `darkMode: ["class"]`（`tailwind.config.js`），并且 `src/index.css` 已定义 `.dark { ... }` 下的 CSS 变量。
- 目前缺少“把 `.dark` class 应用到根节点（`<html>`/`document.documentElement`）”的机制，也没有 UI 入口与持久化策略。

## 目标与验收标准

### 目标

1. 在 Web UI 中提供“主题/外观”设置：`system` / `light` / `dark`。
2. 主题选择持久化（刷新后仍生效）。
3. 在 `system` 模式下跟随系统 `prefers-color-scheme`（至少启动时正确；理想情况下系统切换时也能即时跟随）。
4. 尽量避免启动瞬间“闪白/闪黑”（FOUC）。

### 验收标准（可手工验证）

1. 打开 `/settings`，切换为 `dark` 后整个页面立刻变暗（含背景、文字、卡片等）。
2. 刷新页面仍保持 `dark`。
3. 切换为 `light` 后立刻恢复浅色并能持久化。
4. 切换为 `system`：当系统为暗色时页面为暗色；系统为浅色时页面为浅色。

## 方案设计

### 数据模型（localStorage）

- Key：`exomind:themePreference`
- Value：`system` | `light` | `dark`
- 默认：`system`

### 技术实现（最小侵入）

1. 新增主题模块 `src/config/theme.ts`
   - `getThemePreference()`：读取并校验 localStorage（无效值回退 `system`）。
   - `setThemePreference(pref)`：写入 localStorage，并 `dispatchEvent` 通知运行中页面更新。
   - `applyThemePreference(pref)`：把最终主题映射为是否添加 `.dark`，并设置 `document.documentElement.style.colorScheme`。
2. 启动前应用主题（避免 FOUC）
   - 在 `index.html` 的 `<head>` 注入一段极小的自执行脚本：读取 localStorage + `matchMedia`，在 React 启动前给 `<html>` 加/删 `.dark`。
3. 运行时同步
   - 新增 `ThemeController`（React 组件，`return null`）：负责初次 `apply`、监听 `themePreference` 变更事件、在 `system` 模式下监听 `matchMedia` 变化。
   - 在 `src/App.tsx` 中挂载该组件，确保路由切换不影响。
4. 设置页 UI
   - 在 `src/components/Settings/SettingsPage.tsx` 添加“主题”下拉选择（system/light/dark），调用 `setThemePreference` 并即时生效。

## 测试计划

### 单测（Vitest）

- 新增 `tests/unit/ui/theme-preference.test.ts`
  - `getThemePreference` 默认值与非法值回退。
  - `applyThemePreference('dark')` 会给 `document.documentElement` 添加 `.dark`，并设置 `colorScheme` 为 `dark`。
  - `applyThemePreference('light')` 会移除 `.dark`，并设置 `colorScheme` 为 `light`。
  - `system` 模式下会使用 `matchMedia('(prefers-color-scheme: dark)')` 的结果。

## 验证命令（本地）

1. 安装依赖：`bun install`
2. 单测：`bun run test tests/unit/ui/theme-preference.test.ts`
3. 构建（合并前要求）：`bun run build`
4. 手工验证：`bun run dev` → 打开 `http://localhost:<port>/settings` 切换主题并刷新验证持久化。

## 交付物

- 代码变更（主题模块 + UI + 启动脚本 + 单测）。
- Issue 评论：说明方案与验收链路（与本计划一致）。
- Draft PR：base=`dev`，在 PR 描述中给出验证方式与相关命令。

