# 2026-04-19 UI 文本选中与默认右键菜单 Tauri 实测记录

## 目标

在真实 Tauri 桌面窗口中验证 `#503` 当前实现，而不是只停留在代码阅读或单测：

1. Tauri 端已经落下 “app-like 默认禁选，白名单内容显式放开” 的交互基线。
2. Tauri `debug` 构建不会全局抑制浏览器默认右键菜单。
3. Tauri `release / production` 行为分支会抑制浏览器默认右键菜单，但不会误伤产品现有自定义右键菜单。
4. 本轮结论与当前策略代码保持一致：
   - `src/config/runtime-target.ts`
   - `src/ui/app/components/RuntimeInteractionPolicyController.tsx`
   - `src/index.css`

## 代码基线

- 文本选中 / 默认右键菜单策略入口：
  - `src/config/runtime-target.ts`
  - `src/ui/app/components/RuntimeInteractionPolicyController.tsx`
- 白名单样式入口：
  - `src/index.css`
- 相关实现提交：
  - `4de089ec feat(ui): implement tauri text selection and context menu policy`

## 实测一：真实 Tauri debug 匿名档案窗口

### 现场真值

- 受管实例：`proposal-tmcp-0419`
- Web：`1620`
- Embedded RT：`9324`
- Tauri MCP bridge：`9423`
- 主窗口标题：`ExoMind [dev] [Web:1620 RT:9324]`
- 主窗口初始路由：`/tasks/dag`
- 档案状态：
  - `localStorage['exomind:profile-session'] === null`
  - 侧边栏显示：`未打开档案`
- Tauri 后端状态：
  - `debug = true`
  - `version = 0.4.11`

### 选择行为抽样

#### 默认禁选样本

- `body` 计算值：`user-select: none`
- “当下”页标题：`user-select: none`
- “记录”Tab：`user-select: none`
- 侧边栏账号入口“未打开档案”：`user-select: none`
- 设置页“关于 > 版本 0.4.11”整行 copy-row：`user-select: none`
- 设置页“关于 > 构建 dev”整行 copy-row：`user-select: none`
- 设置页“实例诊断信息”按钮：`user-select: none`
- 实例诊断弹窗标题“实例诊断信息”：`user-select: none`

#### 白名单可选样本

- 当下记录页输入框 `textarea`：`user-select: text`
- 当下记录页消息正文内部 `.exomind-selectable`：`user-select: text`
- 设置页“实例诊断信息”弹窗内存在 `18` 个 `.exomind-selectable` 值节点
- 已确认可选的诊断值样本包括：
  - `dev`
  - `1620`
  - `9324`
  - `9232`
  - `exomind`
  - `27644`
  - `http://127.0.0.1:6984`
  - `http://127.0.0.1:1949`

### 默认右键菜单与自定义右键

#### 1. debug 下不做全局默认菜单抑制

在普通 probe 元素上派发 `contextmenu`：

- `event.defaultPrevented === false`
- 事件监听器可正常收到 `contextmenu`

结论：

- 当前 debug 真窗没有全局一刀切 `preventDefault()`。
- 这与 `resolveUiInteractionPolicy()` 中 “Tauri + debug = 不抑制默认浏览器右键菜单” 的实现一致。

#### 2. Task DAG 节点右键菜单仍可工作

在真实 `/tasks/dag` 页面中切到 `浏览` 模式，对 `rf__node-*` 节点派发右键事件后：

- `dispatchEvent()` 返回 `false`
- 说明事件已被页面业务层 `preventDefault()`
- 页面真实出现：
  - `data-testid="task-dag-context-menu"`
- 菜单项样本：
  - `设为区间起点`
  - `聚焦此系列`

结论：

- debug 下保留浏览器默认右键菜单，并没有破坏任务依赖图的节点自定义右键。

#### 3. Task DAG 画布右键菜单仍可工作

在真实 `/tasks/dag` 页面中切到 `编辑 / connect` 模式，对 `.react-flow__pane` 空白画布派发右键事件后：

- `dispatchEvent()` 返回 `false`
- 页面真实出现：
  - `data-testid="task-dag-pane-context-menu"`
- 菜单项样本：
  - `快速创建任务`

结论：

- debug 下同样没有破坏任务依赖图的画布右键流程。

## 实测二：release 行为侧验收构建

### 为什么需要这一步

正式 release 二进制当前不能直接用 Tauri MCP 自动验收，因为 bridge 只在 Rust `debug_assertions` 下编译：

- `src-tauri/src/lib.rs` 中 `tauri_plugin_mcp_bridge` 被包在 `#[cfg(debug_assertions)]`

因此，本轮补充了一份仅用于验收的 “release 行为侧构建”：

- 使用 `release profile`
- 使用 production 前端产物
- 通过 `CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS=true` 临时保留 bridge

构建命令：

```powershell
$env:CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS='true'
$env:EXOMIND_SKIP_BUN_INSTALL='1'
bun x tauri build --no-bundle
```

这不是正式发版产物，只用于验证 production / non-dev 前端分支的实际交互行为。

### 现场真值

- 验收构建 bridge：`9523`
- Embedded RT：`9524`
- 主窗口 URL：`http://tauri.localhost/...`
- 主窗口标题：`ExoMind`
- 档案状态：
  - `localStorage['exomind:profile-session'] === null`
- `body` 仍为：
  - `class = exomind-app-like-selection`
  - `user-select = none`

### release 行为侧结果

#### 1. 默认浏览器右键菜单已被抑制

在普通 probe 元素上派发 `contextmenu`：

- `event.defaultPrevented === true`
- `dispatchEvent()` 返回 `false`

结论：

- production / non-dev 分支已经走到“抑制默认浏览器右键菜单”的策略。

#### 2. 自定义右键菜单没有被误伤

在 `/tasks/dag` 页面切到 `编辑 / connect` 模式，对空白画布派发右键事件后：

- 页面真实出现：
  - `data-testid="task-dag-pane-context-menu"`
- 菜单项样本：
  - `快速创建任务`

结论：

- 全局默认菜单抑制没有打断产品自己的 `contextmenu` 交互链。

#### 3. 选择白名单基线仍保持一致

- 设置页“版本 0.4.11”整行 copy-row 仍是：
  - `user-select: none`
- 当下记录页 `textarea` 仍是：
  - `user-select: text`
- 当下记录页标题 `h1` 仍是：
  - `user-select: none`

结论：

- release 行为侧没有把白名单 / 禁选基线打散。

## 单测复核

已复跑最小策略守卫：

```bash
bun x vitest run tests/unit/ui/runtime-interaction-policy.test.tsx
```

结果：

- `1` 个文件通过
- `3` 个测试全部通过

## 结论

本轮实测可以把 `#503` 当前实现收敛为以下结论：

1. Tauri 真窗已经落下 “默认禁选，白名单显式放开” 的 app-like 基线。
2. debug 真窗不会全局抑制默认浏览器右键菜单，同时任务依赖图自定义右键链路保持正常。
3. production / non-dev 行为分支会抑制默认浏览器右键菜单，但不会误伤任务依赖图等现有自定义右键菜单。
4. 设置页 copy-row、标题、Tab 等 chrome 仍保持禁选；输入框、消息正文、诊断值等白名单内容面仍保持可选。

## 边界说明

- 本轮 release 侧证据来自“release 行为侧验收构建”，不是正式分发包本体。
- 原因不是产品逻辑未完成，而是当前正式 release 默认不编译 MCP bridge，无法直接被 Tauri MCP 接管。
- 若后续要补“正式 release 安装包本体”的自动化验收，需要先提供单独的 release 验收入口，或转为纯人工桌面验收。

## 与 `#503` 的关系

这轮实测直接补齐了 `#503` 此前缺的运行时证据：

1. 不再只有文档与单测，而是有了真实 Tauri debug 窗口证据。
2. 也补上了 production / non-dev 分支的真实行为证据。
3. 可以据此把 `#503` 的实现状态从“已落代码但未完成 Tauri 真机闭环”推进到“已完成 Tauri 侧核心验收闭环”。
