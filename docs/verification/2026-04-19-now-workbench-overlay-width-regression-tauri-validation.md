# 2026-04-19 专注悬浮窗 running 宽度回归 Tauri MCP 实测记录

## 目标

在真实 Tauri 桌面窗口中验证以下结论，而不是只停留在代码阅读或单测：

1. 未登录档案匿名场景下，`NowWorkbenchOverlay` 仍会按真实可见表面同步窗口尺寸。
2. `无任务悬浮窗小窗 -> running 毛玻璃卡片` 这条真实转场里，不再出现“高度对了但宽度没撑开”。
3. running 卡片收起再展开后，也不会再次塌宽。

## 现场真值

- 受管实例：`overlay-anon-0419`
- Web：`1640`
- Embedded RT：`9344`
- Tauri MCP bridge：`9443`
- 主窗口标题：`ExoMind [dev] [Web:1640 RT:9344]`
- Overlay 标题：`ExoMind Now`
- 主窗口路由：`/eventlog`
- Overlay 路由：`/now-workbench-overlay.html`
- 档案状态：
  - `localStorage['exomind:profile-session'] === null`
  - 主窗口侧边栏显示：`未打开档案`

## 修复点

- `NowWorkbenchOverlayPage` 在 running single-card 分支里，不再使用 `w-full max-w-[390px]` 的 shrink-to-fit 链路。
- `now-overlay-single-card-stage` 改为显式 `width/maxWidth = 390px`，避免从小窗切到大卡时宽度被错误测窄并反写回 Tauri 窗口。

## 实测步骤与结果

### 1. 匿名 idle 小窗真值

Overlay 回到“无任务悬浮窗小窗”后，读取真窗与 DOM：

- `document.body.innerText = 待办 / · 无待办`
- `window.innerWidth = 252`
- `window.innerHeight = 76`

结果：

- 通过。
- 起始状态与用户反馈中的“无任务悬浮窗小窗”一致。

### 2. 主程序开始任务后，overlay 进入 running 毛玻璃卡片

通过主程序真实进入 `当下 / 专注` 运行态后，读取 overlay 真值：

- 文案：`进行中 / 宽度回归复测 / 00:12`
- `window.innerWidth = 390`
- `window.innerHeight = 192`
- `now-overlay-single-card-stage.style = width: 390px; max-width: 390px;`
- `[data-overlay-visible-surface].getBoundingClientRect() = 390 x 192`

结果：

- 通过。
- 本轮未再复现此前的 `42 x 192` 塌宽现象。

### 3. running 卡片收起为小窗

点击 overlay 上的 `收起` 后，读取真值：

- `window.innerWidth = 224`
- `window.innerHeight = 83`
- 文案：`00:28 / 进行中 / 宽度回归复测`

结果：

- 通过。
- running mini 小窗保持正常。

### 4. 小窗重新展开为 running 毛玻璃卡片

点击 overlay 小窗上的 `展开` 后，再次读取真值：

- 文案：`进行中 / 宽度回归复测 / 00:37`
- `window.innerWidth = 390`
- `window.innerHeight = 192`
- `now-overlay-single-card-stage.style = width: 390px; max-width: 390px;`
- `[data-overlay-visible-surface].getBoundingClientRect() = 390 x 192`

结果：

- 通过。
- 收起再展开后未出现二次塌宽。

### 5. running 卡片原生拖动后，位置变化但宽度不再塌

在真实 Windows 桌面上对 overlay 标题拖拽区执行原生鼠标拖动：

- 拖动前窗口位置：`1401,215`
- 拖动后窗口位置：`1467,282`
- 位置变化：`Δx=66, Δy=67`

拖动后再次回读 overlay 真值：

- `window.screenX = 1006`
- `window.screenY = 350`
- `window.innerWidth = 390`
- `window.innerHeight = 246`
- `[data-overlay-visible-surface].getBoundingClientRect() = 390 x 246`

结果：

- 通过。
- 拖动过程中的窗口位置真实发生变化，且拖动后未再出现“宽度塌成窄列”。

## 结论

- 本次真实回归已经定位并修复：
  - 问题不在 running mini 小窗本体。
  - 问题出在切入 running single-card 毛玻璃卡片时，stage 宽度缺少显式约束。
- 修复后，在匿名 Tauri 真窗里已完成两条关键验收：
  - `idle 小窗 -> running 大卡`
  - `running 大卡 -> mini 小窗 -> running 大卡`
- 当前实测结论支持：这次“高度对了但宽度没撑开”的回归已被修复。
