# Beta 前端工作区迭代：Alpha 操作经验与 ARC

> 2026-11-18，Asia/Shanghai。用户明确恢复前端工作，要求完整呈现和鼠标、键盘、触摸交互验证，优先 Web，不要求重新构建 Tauri EXE。基线为 `e89370d8`；已有安装候选已到 Beta11，本轮不复用 Beta10 编号、不改写旧候选。前端实现及 Web 验证结果见下表；实际设备与人审仍独立。

## 目标与范围

主目标是让日常「专注—记录—看图—返回—继续输入」成为连续工作流。沿用 Alpha 的 Shell、消息/输入/计时 View、暖石主题、设置 registry 与 Radix 弹层；依据 ARC P01/P03–P10、I01–I05/I07/I09 与 C04/C05 检查信息、输入、状态及宿主边界。SF/IF 保持候选方法属性，没有新增全局设计规则。

本轮不运行日用 0.5.1、不操作已拿走的平板、不写真实档案、不发原件给模型。旧 Beta11 二进制仍来自 `8235fa0a`；本轮前端源码、Web 产物与旧 APK/EXE 分别记证据。

## 用户路径与实现合同

| 路径 | 本轮实现与权威边界 | 回归/剩余边界 |
| --- | --- | --- |
| 只看专注或只看记录 | `BetaWorkspaceView` 分区，展开/折叠/隐藏独立；全局保留恢复入口。唯一编辑器、controller、journal、查询和阅读窗口不随显隐重建 | 保输入实例、未发稿、光标/选区、阅读位置；这不是新增独立窗口能力 |
| 切页、重启与偏好失败 | 版本化本设备显示偏好；保存失败仍应用本窗口布局并说明未持久化，不锁住恢复入口；不将布局写成业务事实 | Web Lock 仍由 DeviceWorkspace 持有；不变更档案权限或计时资格 |
| 图片直接帮助识别 | 已有本机可读原件，经原读取/hash 校验路径生成内联预览；IntersectionObserver 限可见范围，串行读，离开范围/隐藏时释放 URL | 自动读取候选上限 4 MiB/4 Mi 像素；显式预览保留原 16 MiB/16 Mi 像素限制。超限/失败仍可走原件能力，不伪造缩略图 |
| 开大图后继续记录 | 已就绪图片展开复用 URL，关闭把焦点归还原入口；设备/档案/hash/client scope 变化隔离旧结果与错误 | 不自动取远端缺件，不启动导出选择器或模型调用；原件和预览状态分别判断 |
| 图片异步长高、后台刷新 | 只在原本跟随最新时随内容尺寸变化到底；阅读旧记录时保锚点。已有页面刷新不插入首次加载文字，不以刷新开始清除上次读取错误 | 读取错误与提交/剪贴板错误分开；隐藏记录时的提交异常仍在输入附近保留 |
| 结束/追加反馈 | 复用 Alpha `runActionOnPrimaryModifierEnter`，固定 Ctrl/Cmd+Enter；消息发送偏好独立，IME 组合不提交；跳过按钮有明确可访问名称 | 保留已结束行动与反馈草稿，关闭弹层不撤销事实，不恢复旧任务域副作用 |
| 隐藏与前后台 | UI 活动订阅独立于 Native 所有者。隐藏计时区停快照/显示 tick，隐藏同步页停 UI 状态轮询；原件观察与日期刷新按活动收束，隐藏期间时间线变化只在返回后补读 | 未停止 Native deadline、持久取件/同步任务或草稿 writer；已验证观察生命周期，不声称掉电根因已解决 |
| 短横屏与窄屏 | 输入区独立留在底部，上方工作内容可滚动；窄屏搜索重组，原件队列限高并可滚动；图标刷新保留可访问名称 | 验完整控件在视口中和实际点击，不能以部分交集、元素存在或无横向溢出代替可达性 |

相关生产接缝：`src/beta/BetaApp.tsx`、`BetaWorkspaceView.tsx`、`workspace-layout.ts`、`view-activity.ts`、`BetaFocusTimer.tsx`、`BetaImagePreview.tsx`、`OriginalDownloads.tsx`、`BetaPeersPage.tsx`、`date-clock.ts`。

## 验证与纠偏记录

证据根目录：`G:/exomind-runs/beta-ui-20261118-a/`。日志、配置、截图、trace、Git archive 基线及 Web 构建输出均在仓库外；只提交维护源和测试夹具。

| 验证 | 结果 | 证据用途 |
| --- | --- | --- |
| 新工作区/图片红例 | `workspace-red` 1 失败；`image-red` 2 失败 | 缺显隐/可见观察的反例，未以测试数量推断完成度 |
| 首批直接回归 | `focused-green-b` 7 文件/29 项通过 | 草稿/锁、计时、图片、导出、共用壳的直接接缝 |
| 完整 Beta 前端初跑 | `beta-unit-suite` 51 文件，313 过/14 失败 | 保留失败，不写全绿 |
| 原 HEAD 基线对照 | `baseline-failures`：23 项中 12 失败，与原有失败逐项相符 | Git archive `e89370d8`，同一 node_modules、独立 alias/cwd；无新 worktree，无真实档案 |
| 分类修正 | `triage-green` 6 文件/29 项通过 | Android 设置测试补真实平台条件；回顾测试按安全 Markdown/渐进披露/正文待读取合同；补明确跳过名称；新增故障测试覆盖实际 Storage shim |
| 短屏几何红例 | `short-geometry-red` 1 失败 | 旧 `toBeInViewport()` 只测交集；提高为 ratio=1 后稳定复现输入被裁，随后修布局 |
| 中间完整页面 | `browser-d` 12 项通过 | Edge 桌面浅/深、390×844 触摸、1024×768 触摸；含短屏完整可见、图片/返回/草稿/计时反馈。后续增加短屏实际开始与键盘控制再验 |
| 最终 Beta 前端全目录 | `beta-unit-final-c`：51 文件/328 项通过，45.30 秒，正常0/Job清理确认 | 追加原件描述替换回归后全目录复跑；0新增skip。此前 `beta-unit-final` 的旧跳过按钮名称断言失败如实保留 |
| 最终完整 Web 界面 | `browser-final-b`：16 项通过，26.0秒，正常0/Job清理确认；`browser-self-start`另1项通过，7.1秒 | 桌面浅/深1280×900、手机触摸390×844、平板触摸1024×768；再测860×580/844×390短屏。真实click/tap/键盘、完整视口、光标/稿/阅读恢复；自启动用例核仓库内配置可独立启停Vite。合成适配器，非Core/Host真机证据 |
| 最终类型与 Beta Web 构建 | `web-final`：tsc通过，2272模块，Vite4.72秒，正常0/Job清理确认 | 生产 beta 与 beta-focus-overlay 入口；不编译 Rust/Tauri。Web输出在 `web-dist/`，最大JS块586.20kB有>500kB提示，未以构建成功宣称完成包体优化 |

初次验收宿主因 Tailwind 不扫描测试目录而没有 `h-dvh`，造成长历史把输入推出窗口；明确宿主高度后重验，不能归因为生产数据问题。Vite 初轮复用旧优化缓存请求不存在的 d3-force 旧路径；验收配置改用独立缓存及明确入口后成功，没有改依赖或锁文件。

共享预览可以打开和读取 DOM，但截图接口反复返回 `Preview automation snapshot timed out after 15000ms.`；随后用受控 Edge/Playwright 截图检查。初始两轮保留为失败/取消；修正合成时间块快照多余字段后完成页面流程。自有 Vite 会话曾因 config watcher 在关闭后重启，仅按已记录 PID/创建时间/可执行路径终止该实例；最终会话有截止和显式清理，不按镜像名全局停止。

所有有限作业均已终态且Job清理确认；自有预览PID54788于01:29正常关闭，独立自启动用例也清理了服务器/浏览器，15420无监听。维护入口为 `tests/e2e/fixtures/beta-workspace.html`（明确合成验收，非临时HTML报告），配套TSX与独立Vite/Playwright配置一并存盘。

复跑命令（Windows仍经仓库supervised-command有限作业执行）：`node node_modules/vitest/vitest.mjs run tests/unit/beta --maxWorkers=1`；`node node_modules/@playwright/test/cli.js test --config tests/e2e/playwright.beta-workspace.config.ts`。截图/trace输出用`EXOMIND_UI_EVIDENCE_DIR`放仓库外；设置`EXOMIND_UI_BASE_URL`时复用明确自有服务，否则配置独立启动并清理Vite。前端接管自查以“再加一种布局/图片状态”为下一变更，确认显示偏好、UI观察、原件与业务所有者的职责分开；这是Agent自查，不代表人类接管或审美批准。

## 验收边界与下一步

- 鼠标、键盘、浏览器触摸仿真和浅/深画面分别记录；未将仿真称为平板物理触摸、Android IME、系统返回或 WebView 真机通过。
- 视觉已由 Agent 按实际截图自查，用户尚未对本轮具体画面作审美批准；不把技术测试写成「最丝滑」或能耗改善已证明。
- 运维面板仍是设计，电量下降根因、暖机/renderer/电流与采集自成本仍待。只减少已明确无用的隐藏 UI 观察，不替代性能 P0。
- 同版 Beta11 的保留数据升级、手机原库、跨端历史/投影/原件、完整网络/OEM矩阵继续见[核心优先路线](2026-11-17-v0.6-beta-core-first-iteration.md)。其他黑影/选区重绘报告不因本轮关闭。
- 之后从本轮界面人审、Android 真机/IME 和实际资源窗口继续；消息引用/复制/链接、改名、完整日周月、grant UI、媒体与正式导出仍按原 Beta 范围收尾。每次提交立即推送并回读，结束工作区干净。
