# 测试隔离、资源预算与显示

[返回《Tauri MCP Windows Playbook》](../tauri-mcp-windows-playbook.md)

# Tauri MCP Windows Playbook

> 持续更新。用于沉淀在 Windows 环境下，使用 Tauri MCP 调试 ExoMind 外心桌面应用的实践经验、坑点与验证套路。

> Windows 宿主机下的 Android AVD / APK / adb / Tauri MCP 调试经验，见 [Tauri Android Windows Playbook](../tauri-android-windows-playbook.md)。

> 本文中的实例名、端口、窗口标题、route、SQLite 路径、报告路径、session/anchor id 等，除非明确写成“通用规则”，否则都只表示对应阶段的现场样例，复用时必须替换为当前实例真值。

> **Beta 独立入口**：默认不注册 MCP 调试桥，即使是 debug 内测构建。需要对隔离开发实例联调时，显式设置 `EXOMIND_BETA_ENABLE_DEV_BRIDGE=1`，再按实例端口设置 `EXOMIND_MCP_BRIDGE_BASE_PORT`。普通独立 exe/APK 启动不需要这两个变量；Alpha/旧入口行为不在此变更范围。

## 目的

- 为后续 Agent 提供可复用的 Tauri MCP 调试路径，而不是每次从零摸索。
- 记录“当前 app 实际状态”和“持久化配置状态”不一致时的判定方法。
- 记录哪些目标可以直接依赖 Tauri MCP，哪些场景需要退回到 RT HTTP、日志、SQLite 与本地文件。

## 通用硬规则：测试档案与日用档案隔离

所有桌面开发实例、Tauri MCP 验收和会写业务数据的自动化脚本，默认不得读取或写入用户正在日用的档案。尤其不得让 `0.5.x` 测试实例复用仍由 `0.4.22` 使用的数据目录或档案。

1. 使用 `tauri-dev-manager` 和唯一实例名启动；确认 app-data、runtime、main WebView、overlay WebView 都落在 `.tmp/tauri-dev-state/<instance>/` 下。
2. 分配专用 Web/HMR/RT/bridge 端口。脚本在第一次 EventLog/Task/TimeBlock 写入前，必须核对当前 URL、RT endpoint 和监听进程属于该实例。
3. 创建可识别的一次性测试档案。涉及多 WebView 时，同时断言主窗口 profile owner、Rust profile broker 和子窗口 session 使用同一测试档案。
4. 任一隔离断言失败时立即停止，不得 fallback 到 legacy/current/anonymous 日用 scope，也不得通过清空真实档案来“恢复干净环境”。
5. 结束后只按实例名停止，并确认该实例的 Web/HMR/RT/bridge 端口释放；禁止按 `exomind.exe` 或 WebView 进程名全局结束。

验收报告必须记录实例名、四类端口、测试档案 ID/前缀与隔离守卫结果。没有这些证据的写入型桌面测试，不算有效验收。

## 通用硬规则：Windows 资源预算与串行验证

Windows 真机验证不得把 Rust 编译、Web 构建、Vitest 全量/聚焦测试和 Tauri 实例启动并行执行。2026-08-24 曾因并行验证造成宿主机蓝屏；即使各条命令本身正确，也不能把这种执行方式视为有效工程流程。

1. 每次启动内存密集操作前读取 `Win32_OperatingSystem` 的可用物理内存，并列出工作集最大的进程；记录 `TotalGB`、`FreeGB`、`FreePercent`。
2. 默认严格串行：一次只运行一个 Rust 编译、Web 构建、测试进程或 Tauri 启动链路。Tauri 已运行时，不再同时发起全仓测试或独立 Rust 构建。
3. 可用物理内存低于 `8 GiB` 或低于总内存 `25%` 时，不启动新的内存密集操作；先等待现有步骤结束或停止本任务的隔离实例。该阈值是当前 Windows 开发机的保守门禁，不是应用运行需求。
4. 大型验证按“轻量静态检查 → 聚焦测试 → Web 构建 → Rust 检查 → 单实例真窗验收”的顺序执行；已取得可信通过证据的步骤，不因会话刷新或机器重启无意义地重复。
5. 蓝屏、重启或异常中止后，不相信实例元数据中的 PID/status；重新核对进程命令行和四类监听端口，再决定恢复或清理。

验收报告必须同时记录启动真窗验收前的内存快照。未经过资源门禁的并行重操作禁止作为后续默认方案。

### 通用硬规则：链接阶段低内存模式（2026-08-24）

2026-08-24 21:35:43，Windows 最终链接进程启动后，可用物理内存在一秒内下降约 `1.1 GiB`；21:35:44 宿主机随即蓝屏，且转储创建失败。崩溃前仍有约 `18 GiB` 可用内存，因此不能把原因简化成普通 OOM；但最终链接的瞬时分配与 IO 压力是目前最接近故障时刻的触发条件。

在完成驱动、硬件或内核级根因定位前，本机 Tauri MCP 桌面构建必须使用显式低内存模式：

```powershell
bun run tauri:manager start --name <instance> --web-port <port> --hmr-port <port> --rt-port <port> --low-memory
```

该模式固定执行以下约束：

1. `CARGO_BUILD_JOBS=1`，Cargo 一次只调度一个编译单元。
2. 开发 profile 使用 `debug=0`，关闭 incremental，并把 codegen units 从默认增量构建的高并发值压到 `16`。
3. Windows MSVC target 改用 Rust 工具链自带的 `rust-lld`，传入 `/threads:1`，让最终链接主动降速换取更低并发峰值；同时在 rustc 默认 `/DEBUG` 之后追加 `/DEBUG:NONE`，明确禁止生成完整 PDB。
4. 所有低内存实例串行复用 `tauri-dev/low-memory-shared` 构建缓存；低内存实例运行期间禁止启动另一个受管 Tauri 实例。
5. 该模式不改变 `.tmp/tauri-dev-state/<instance>/` 的应用数据隔离；共享的只有编译产物缓存，不是用户档案。
6. 正式 release 全平台构建优先交给 GitHub Actions。除非正在专门验证本机链接稳定性，不在这台 Windows 主机重复完整 release link。

`/DEBUG:FASTLINK` 已被微软弃用，不能作为长期方案；`/INCREMENTAL` 主要改善后续链接，不能消除第一次完整链接的峰值。若低内存模式仍触发系统异常，立即停止本机完整链接，后续只保留 Web/Rust check 与远端 CI 证据。

### 阶段补记：桌面标题 / 设置版本真窗验收（2026-04-16）

#### 本轮阶段目标

- 在真实 Tauri 桌面窗口里确认两件事，而不是停留在代码阅读：
  - 主窗口标题当前到底显示什么，以及它的真实覆盖链路来自哪里
  - 设置页 `关于 > 版本` 是否已经摆脱前端旧 fallback，显示当前包版本

#### 本轮现场真值

- 受 `tauri:manager` 管理的实例：
  - `desktop-tmcp-0416`
  - Web `1480`
  - RT `9124`
  - MCP bridge `9283`
- 官方 MCP 在这一轮可直接使用：
  - `driver_session start --host 127.0.0.1 --port 9283`
  - `driver_session status = connected:true`
- `9124` 与 `9283` 由同一个 `exomind.exe` 持有，主窗口 URL 为：
  - `http://localhost:1480/settings`

#### 本轮观察结果

- 这轮第一次拉起受管实例时，`tauri:manager list` 长时间只显示：
  - `starting`
  - active listeners 只有 `web=1480, hmr=1481`
- 问题不在 MCP bridge，也不在 RT，而在构建环境：
  - 实例日志里直接出现：
    - `failed to write ...Temp\\rustc...\\lib.rmeta: 磁盘空间不足 (os error 112)`
- 后续 manager session 再次尝试后，同一实例才真正进入可接管状态。
- 真实主窗口标题并不是 `src-tauri/src/lib.rs` 里设置的：
  - `ExoMind (dev)`
- 真窗里读到的原生窗口标题与 `document.title` 都是：
  - `ExoMind [dev] [Web:1480 RT:9124]`
- 这条标题并非 Rust 侧最终真值，而是前端开发态标题同步覆盖：
  - `src/ui/app/components/DevInstanceTitleSync.tsx`
  - `src/config/dev-instance-diagnostics.ts`
- 设置页真窗验收到的 `关于` 区内容：
  - `版本 0.4.10`
  - `构建 dev`
- `package.json.version` 当前真值也是：
  - `0.4.10`
- 因而设置页“关于 > 版本”已不再停留在旧前端 fallback `0.3.6`。

#### 本轮结论

- 对“受管实例一直 `starting`、只有 `web/hmr` 活着”的现场，不要先怀疑 bridge：
  - 先看实例日志里有没有 `rustc` 向 `%LOCALAPPDATA%\\Temp` 写中间文件失败
  - 即使 Cargo target 已经放到别的盘，`rustc` 临时文件仍可能打爆系统盘
- 对“标题栏版本号是否生效”的判断，不能只看 `src-tauri/src/lib.rs`：
  - 开发态下还要同时检查 `DevInstanceTitleSync`
  - 否则会把 Rust 默认标题和真窗最终标题混为一谈
- 对设置页版本文案的验收，本轮真窗结果表明：
  - 当前显示已经与 `package.json.version` 对齐
  - 旧的 `0.3.6` 前端 fallback 已被清掉

#### 可复用操作套路

1. 先用 `bun run tauri:manager -- start --name <name> --web-port <port> --hmr-port <port>` 拉起受管实例。
2. 如果 `list` 长时间只有 `web/hmr`，不要立刻判 bridge 挂掉：
   - 先读 `.tmp/tauri-dev-instances/<name>.log`
   - 搜 `os error 112`、`failed to write ...Temp\\rustc...`
3. 若日志命中系统盘临时目录写满：
   - 优先清理 `%LOCALAPPDATA%\\Temp` 下明显过期的大目录
   - 再重启该受管实例
4. 实例跑起来后固定执行：
   - `driver_session start --host 127.0.0.1 --port <bridge-port>`
   - `manage_window list`
   - `webview_execute_js(() => ({ href: location.href, title: document.title }))`
5. 验收桌面标题时：
   - 同时记录原生窗口标题和 `document.title`
   - 若在 dev 环境里看到 `ExoMind [<branch>] [Web:<port> RT:<port>]`，优先回看：
     - `src/ui/app/components/DevInstanceTitleSync.tsx`
     - `src/config/dev-instance-diagnostics.ts`
6. 验收设置页版本时：
   - 直接导航 `/settings`
   - 在桌面关于区 `new-settings-desktop-vc-section-about` 内读取可见文本
   - 当前 `about-version` 行没有单独 `rowTestId`，用可见文本 `版本` + 右侧值做断言更稳

### 阶段补记：事件引用 / 事件唯一链接真窗验收（2026-04-13）

#### 本轮阶段目标

- 在真实 Tauri 桌面窗口里确认事件引用与唯一链接链路已经真正闭环，而不是只停留在单测：
  - `引用` 按钮能把目标事件插入输入区引用 banner，并同步首行 permalink
  - 发送后的新事件会把被引用事件写入 `refs`
  - 已发送事件上的前向引用摘要可回跳到被引用事件，并落到 `?event=<id>&locate=1`
  - `链接` 按钮在窗口真正获得前台焦点后可给出成功反馈

#### 本轮现场真值

- 隔离实例：
  - `eventlog-mcp-verify`
  - Web `1620`
  - RT `9324`
  - raw bridge `9423`
- 本轮继续直接使用 raw bridge `ws://127.0.0.1:9423` + RT HTTP `http://127.0.0.1:9324`。
- 本轮验收 marker：
  - source event id：`tmcp-src-1776068436514`
  - source marker：`TMCP_ACCEPT_SOURCE_1776068436514`
  - reply marker：`TMCP_ACCEPT_REPLY_1776068436514`
  - permalink：`http://localhost:1620/eventlog/record?event=tmcp-src-1776068436514&locate=1`

#### 本轮观察结果

- 通过 RT `POST /eventlog` 预埋 source event 后，真实记录页能出现对应事件行，且行内存在：
  - `msg-quote-btn`
  - `msg-link-btn`
- 点击 `msg-quote-btn` 后，真实窗口里出现：
  - `new-now-quote-banner`
  - 文案：`引用TMCP_ACCEPT_SOURCE_1776068436514`
  - 输入框首行自动同步为：
    - `> 引用：[TMCP_ACCEPT_SOURCE_1776068436514](http://localhost:1620/eventlog/record?event=tmcp-src-1776068436514&locate=1)`
- 发送 reply 后，真实窗口日志出现：
  - `[ChatPage] handleSend done {"totalMs":179}`
- 同轮 RT `/eventlog?limit=200` 回读确认 reply 已落库，且 `refs` 真值为：
  - `eventId = tmcp-src-1776068436514`
  - `summary = TMCP_ACCEPT_SOURCE_1776068436514`
- reply 行上的前向引用按钮文本为：
  - `引用：TMCP_ACCEPT_SOURCE_1776068436514`
- 点击该前向引用按钮后，真实窗口 URL 变为：
  - `http://localhost:1620/eventlog/record?event=tmcp-src-1776068436514&locate=1`
- 被引用 source 行在真实窗口里拿到高亮 class：
  - `ring-2 ring-[#F59E0B]/70 ...`
- 针对 `msg-link-btn`：
  - 当 `document.hasFocus() === true` 时，按钮文案可从 `链接` 变为 `已复制链接`
  - 说明真实产品路径已经返回复制成功，而不是只做了假反馈

#### 本轮结论

- 事件引用链路已经在真实 Tauri 桌面窗口中通过：
  - 引用插入
  - `refs` 落库
  - 前向引用摘要渲染
  - permalink 回跳与 locate 高亮
- 事件唯一链接的复制按钮也已在真实窗口里得到成功反馈，但必须先拿到真正的前台焦点。
- 本轮早些时候出现过两类“看起来像产品失败”的现象：
  - `Document is not focused`
  - `The native clipboard is not accessible due to being held by another party.`
- 同一 Windows 会话下，PowerShell `Set-Clipboard` 也会直接失败；因此不能把这类早期报错简单归因到 permalink 功能本身。
- 对 `msg-link-btn` 的判断准则应改为：
  - 先确认真实窗口 `document.hasFocus() === true`
  - 再点击按钮
  - 以按钮进入 `已复制链接` 作为桌面验收通过信号

#### 可复用操作套路

1. 先用 RT `POST /eventlog` 注入唯一 marker 的 source event，避免在脏数据里盲点历史消息。
2. raw bridge 脚本保持短小：
   - 导航
   - 轮询 source row 出现
   - 单步点击 `msg-quote-btn`
   - 单步读取 `new-now-quote-banner` 与 textarea
   - 单步发送
   - 单步点击 `event-forward-refs-*`
3. `refs` 是否真的落库，不要只看 UI；必须同时回读 RT `/eventlog`。
4. permalink locate 是否真通过，不要只看按钮点击；必须同时检查：
   - URL 已变成 `?event=<id>&locate=1`
   - source row 出现高亮 class
5. 如果 `msg-link-btn` 再次报复制失败，先判断：
   - `document.hasFocus()` 是否为 `true`
   - 当前 Windows 会话的系统剪贴板是否整体可用
   - 不要在窗口未真正激活时就把失败归因到产品逻辑
