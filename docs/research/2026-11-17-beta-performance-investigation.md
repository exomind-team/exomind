# Beta 性能、资源、能耗与包体调查

> 2026-11-17。只读调查；不改产品、设备策略或用户档案，不创建时间块/记录，不清库、不重置 batterystats、不安装其他候选。原始设备元数据、分析脚本与包体清单保存在外部证据包 `beta-performance-investigation-20261117-a`，不随仓库提交。

## 调查结论

- 现场一手反馈“约 35% 电量、外心前台、USB 接电脑仍掉电”仍是有效调查线索；Luna 初查设备点为 32%、USB powered、Android 状态码 2。该点不含电流读数，也不是外心运行窗口。
- Luna 初查时前台为 Termux，Beta10 已安装但没有外心进程，因此子任务没有采到应用 CPU/内存窗口。父代理随后正常启动同一候选，完成主进程前台/后台短测并恢复前台，见文末续测；该续测含冷启动、未归属 renderer，也没有电流/能耗归因。
- 我之前不知道但现在知道的是：新版 Beta UI 在 Now、Sync、Settings 切换时保持三个区块挂载；隐藏的时间块组件仍有 1 秒刷新和 250ms 展示 tick。Native Beta host 启动时还会启动 100ms deadline scheduler 和 500ms summary worker。它们是确认存在的周期性工作，实际资源成本尚未测得。
- 基于以上，我的判断是：本轮**没有运行时瓶颈得到测量确认**，但有数条应列入 P0 的高频空闲工作候选。包体则已确认是 debuggable APK，且 ARM64 `.so` 保留了约 39.9MB 的 `.symtab` 与 `.strtab`；这是包体/安装成本事实，不能直接解释运行时掉电。

## 1. 候选、设备与证据边界

| 对象 | 已核实身份 |
|---|---|
| 平板 | 物理 Android 15 / API 35，ARM64，型号标识 `24018RPACC`；设备序列只存外部原始元数据 |
| 已安装应用 | `com.exomind.app.v06.beta`，`0.6.0-beta10` / versionCode `6010`，UID `10365` |
| Beta10 APK | 来源 `64d170c40eea`，SHA-256 `bc112f2df94b06161719071fe0c98f5edec3245108c03b633990cd847091522c`；安装包内 base APK 哈希匹配 |
| 源码基线 | 候选源 `64d170c40eeaba9e3cc629ba330fc525908ce1ae`。源码初读时 HEAD 为 `aefa5223cfc431e88a3ef1f673f67e3c84cca4e1`；报告完成时共享 HEAD 已推进到 `0292bf40bf221928ed2a6a4047f0c808f9ad7bf1`。引用的前端刷新、Beta Native、scheduler、summary、PeerNetwork、自动原件队列文件在候选源到报告完成时 HEAD 间无差异；共享工作树里另有同步/来源链 WIP，本调查未改动它们 |
| ADB | 使用 SDK 自带 platform-tools `adb.exe`，版本 1.0.41 / 35.0.2；PATH 中旧 ADB 未使用 |

本次设备点读数时间：2026-11-17 18:51:53 +08:00。原始状态 JSON 保留在外部证据包。没有读取档案正文、原件、owner descriptor、连接凭据或日志内容；没有开启 CDP、创建 ADB forward、录屏、heap dump 或持续观察器。无外心 PID 时没有按包名停止任何进程。

### 采集命令与复现路径

- 设备/前台/进程：SDK `adb.exe version`、`adb devices -l`、`adb -s $SERIAL shell pidof com.exomind.app.v06.beta`、`ps -A -o UID,PID,PPID,NAME`（仅筛 Beta 包与 sandbox renderer）、`dumpsys activity activities`、`dumpsys window`、`dumpsys power`。
- 供电/热/显示：`dumpsys battery`、`dumpsys thermalservice`、`settings get system screen_brightness`、`settings get system screen_brightness_mode`。`$SERIAL` 的实际值只在外部 `android-state-point.json`。
- 安装身份：`pm list packages -U com.exomind.app.v06.beta`、`pm path` 后对 base APK 执行 `sha256sum`；读取 package version/targetSdk/debuggable 与 signer。
- 包体：对候选相对路径 `0.6.0-beta09/ecb847a2edd9/android/…apk` 和 `0.6.0-beta10/64d170c40eea/android/…apk` 执行 `apksigner verify --print-certs`、`aapt dump xmltree`、ZIP 成员清单与 `readelf -W -S libexomind_lib.so`。外部脚本/JSON 是上述证据包清单所列文件。
- 私有存储探测：`run-as com.exomind.app.v06.beta sh -c 'du -sk <relative-area>'`。所有相对目录均返回 4KiB，故标记为不可用，不作为实际占用。未运行 `cat`、SQL、`logcat` 或任意业务内容读取。
- 源码路径：以下引用基于 Beta10 源 commit `64d170c…`；当前共享工作树的对应性能文件与该候选无差异。代码静态路径没有对应运行时计数窗口。

## 2. 已测事实

### 2.1 现场状态点

- `pidof` 与按包名过滤的 `ps -A` 均未发现 Beta PID；系统前台为 `com.termux/.app.TermuxActivity`。屏幕 wakefulness 为 Awake，Keyguard 未显示。
- Android Battery Service 报告：电量 32%，USB powered=true、AC powered=false、status 原始值 2、voltage 原始值 3812、temperature 原始值 324、charge counter 原始值 2623；最大充电电流/电压字段原始值分别为 500000 / 5000000。
- Thermal Service 报告 thermal status 原始值 0；当前 HAL 电池温度 32.4°C、skin 39.171°C。温度是系统传感器读数，不是外心归因值。
- 亮度设置值 44、模式值 1（自动亮度）；这是设置值，不是实测屏幕亮度。
- `/sys/class/power_supply/battery/*` 读取被系统拒绝，未取得 `current_now` / `current_avg`。`dumpsys battery` 本身没有电池瞬时电流字段；USB 输入瓦数、净充放电功率与正负号均未知。`Max charging current/voltage` 是系统字段，不是本次测得的 USB 输入功率。
- 唯一的电量百分比读数不能求功率。用户之前约 35% 的反馈与这次 32% 点之间没有同窗口连续样本；USB powered/status 也不能证明此前的 USB 供电充足或否定外心开销线索。

### 2.2 进程与存储

- 安装包身份可确认，但采样时没有外心进程，所以没有运行时 CPU、线程数、唤醒、PSS/RSS、Native/WebView heap 或帧数据。
- 观察到一个通用 WebView sandbox renderer 名称，但没有 Beta 父 PID、精确 DevTools socket 或归属链，故不纳入外心指标，也没有连接该 renderer。
- 只读 `run-as` 存储大小探测对根目录及几个预期目录都返回相同的 4KiB，结果不可信，未当作容量数据。没有取得数据库、WAL、SHM、cache、原件或 log 的可信尺寸，也没有做增速窗口；没有读取这些文件内容。
- 没有外心 CPU、BatteryStats UID 差分或 storage-growth 窗口。未重置任何统计，也未使用 `dumpsys batterystats --reset`。

### 2.3 Beta09 / Beta10 Android 包体

两包均为 arm64-v8a、targetSdk 36、`android:debuggable=true`，V2 signer SHA-256 相同：`768f3a1338da7e8d62abb93f3e124b472db5645f1338e221b9a497e42583ec80`。所以这组包体差异是在同 ABI、同签名、同 debuggable 标志下比较。

| 项 | Beta09 | Beta10 | 差异 |
|---|---:|---:|---:|
| APK | 107,897,033 B | 107,901,129 B | +4,096 B |
| `lib/arm64-v8a/libexomind_lib.so` | 100,813,176 B | 100,817,272 B | +4,096 B |
| DEX | 13 个；压缩 5,331,268 B / 解压 12,923,040 B | 同左 | 无 |
| ELF `.text` | 38,268,364 B | 38,268,364 B | 无 |
| ELF `.rodata` | 6,396,268 B | 6,400,364 B | +4,096 B |
| ELF `.symtab` / `.strtab` | 14,981,184 / 24,920,734 B | 同左 | 无 |

`.symtab + .strtab` 合计 39,901,918 B（约 38.05 MiB）；所选 ELF section inventory 没有发现 `.debug_*` section。APK 中没有嵌套 `.apk`；唯一包含 `rime` 子串的 ZIP 成员是 AndroidX `annotation-experimental` 元数据名，不是 Rime。独立 Rime 附件没有计入包体。

APK 标记为 debuggable，且保留完整符号/字符串表；这确认了调试可附加属性与包体符号成本。子任务初查没有读取 Beta10 Rust 构建参数；父代理续核同一来源 `64d170c4` 的 `beta10-arm64-build-20261117-a/input.json` 及 stderr 第554行，实际 Cargo 报告 `Finished dev profile [unoptimized]`、69秒。因而 Beta10 的未优化 profile 有独立构建证据，不仅来自 debuggable 标记；完整 opt-level/LTO 配置仍须随后续对照包保存。不能据此将本次掉电全部归因于构建 profile。Beta09 Windows x64 exe（来源 `ecb847a2`）为 65,964,032 B，SHA-256 `e192c2cdb589f3757f2b1106a984e798830467ad11e374b6ce2fec64da1cc8f0`；没有同版 Beta10 Windows 包用于比较。

复现材料：外部证据包中的 `apk_profile_inventory.py`、`apk-profile-inventory.json`、`package-comparison.json`、`android-state-point.json`。分析工具为 Python `zipfile`、SDK `apksigner`/`aapt` 与 `readelf -W -S`；未编译、未安装其他候选。

## 3. 已确认瓶颈

**没有实测确认的外心运行时瓶颈。** 主要原因是现场目标进程不在运行，且没有连续电流、CPU、内存或任务计数。下面列出的高频行为是源码确认的执行路径，不是已经证明导致本次掉电的根因。

## 4. 强候选与源码风险地图

| 优先级 | 候选与证据 | 条件、边界与测量要求 |
|---|---|---|
| P0 | **Native deadline scheduler：100ms 周期。** Beta Native `NativeState::open` 调 `host.start_services()`；`timeblocks::run` 每轮采 clock、调用 `reconcile_clock`/`due_deadlines`，再以 `SCHEDULER_POLL=100ms` 等待。位置：`src-tauri/src/beta_native.rs:250-256`；`crates/exomind-beta-host/src/timeblocks.rs:22,150-188,228-231,286-304`。 | Host 存活时即启动，不以当前是否有活动时间块为条件。静态上最多约 10 次唤醒/秒；需测每轮 CPU、clock 与 Core 查询耗时、实际 due 数及 Condvar 提前唤醒数。不能只降低频率而失去到点与恢复语义。 |
| P0 | **Beta summary worker：500ms 轮询。** Host `start_services` 同时调用 `start_summary_services`；worker 每轮 `reconcile_summary_triggers`、读取 profile 列表并按 `summary_tasks_page(..., 100)` 扫描，然后 `sleep(POLL=500ms)`。位置：`crates/exomind-beta-host/src/timeblocks.rs:228-231`；`crates/exomind-beta-host/src/summary_jobs.rs:28,241-272,287-310,482-516`。 | worker 在 Beta Native 启动时创建。没有可领取任务时不会发模型请求，但仍会进行空闲扫描；测量需区分 poll 数、扫描 profile/page/rows、DB 时间、领取数、模型调用时间。Legacy `TimeblockSummaryAgentService` 另有 `enabled` 缺省 false，Beta 专用入口不走其 legacy bootstrap，不把它算作当前 worker。 |
| P0 | **隐藏的时间块 UI 仍轮询。** `BetaAppShell` 用 `hidden` 与 `hidden` class 切换三个 section，子树仍挂载；`ProfileWorkspace` 始终渲染 `BetaFocusTimer`。Timer 每秒 `controller.refresh()`、每 250ms `tick`，无 `visible` 条件。Controller 的一次刷新会执行外层 `status`、稳定读取中的前后 `status`、一次 snapshot，共 5 个 Native invoke。位置：`src/beta/BetaAppShell.tsx:60-62`；`src/beta/BetaApp.tsx:243-265,339,346-381,464-474`；`src/beta/BetaFocusTimer.tsx:28-34`；`src/beta/timeblocks-controller.ts:94-107`；`src/beta/timeblocks-client.ts:14-15,26-35`。 | 当前档案加载后，即使 Now 被 Sync/Settings 遮住，Timer 仍刷新；进入后台时这段 JS 定时器是否被系统节流未测。一次周期最多包含 5 个 Native invoke 与 4 次本地状态 tick/秒；需记录 invoke 数/耗时、React commit、隐藏/恢复状态。状态/运行代次的前后核验不能因优化而丢失。 |
| P0 | **隐藏的 Sync 页每两秒读 Native 状态。** `BetaPeersPage` effect 以 `setTimeout(..., 2000)` 递归调用 `peers.status(profileId)`，没有检查 section 可见性或 `document.hidden`。Tauri peer client 直接调用 `beta_peer_status`。位置：`src/beta/BetaApp.tsx:243`；`src/beta/BetaAppShell.tsx:60-62`；`src/beta/BetaPeersPage.tsx:56-80`；`src/beta/peers-client.ts:64-73`；`src-tauri/src/beta_native_peers.rs:62-69`。 | Sync 页默认也保持挂载；只要有 profile 与 Native peers client，就有约 0.5Hz 状态请求，即使用户停留在 Now/Settings。需按可见性分桶测 Native 状态查询耗时；切回 Sync 时应读新状态。 |
| P1 | **Now timeline 前台刷新。** `visible && client.summaries && !loading` 时每约 3 秒重新 `refreshTimelineWindow`；单轮最多 16 页（latest 页加最多 15 个追赶页），每页最多 100 条，然后对本地项做合并/排序。位置：`src/beta/BetaApp.tsx:368-381`；`src/beta/timeline-refresh.ts:18-37`；Native Beta client 始终提供 summaries client：`src/beta/client.ts:120-130`。 | 仅 Now 可见时启用；页面隐藏时该刷新 effect 会清理。稳定无新历史时通常只读 latest 页；存在缺口时会按 16 页边界追赶。需记录读取页数、返回行数、合并耗时与列表大小，不能将最大追赶上限当作每次必读页数。 |
| P1（条件性） | **PeerNetwork discovery、路由和原件队列。** 新网络设置缺省 `enabled=false`，Tauri 启动时 `restore()` 只在持久 enabled 时启动；用户启用后 worker 每 2 秒 tick，更新地址、发 multicast/broadcast announcement、尝试未退避 route，并调用 auto queue。位置：`crates/exomind-beta-host/src/peers/network_store.rs:53`；`crates/exomind-beta-host/src/peers/network.rs:264-318,888-896,1170-1200`；`src-tauri/src/beta_native.rs:958-968`。 | 实际平板的持久 enabled 状态未读取，故不推断该 worker 当时是否运行。Peer retry 为指数窗口并封顶 30 秒；自动原件 policy 新建缺省 enabled、8MiB 阈值，自动退避 2/4/8/16/30/60 秒。启用且有 routes 时，auto queue 每个 worker tick 轮转一个 profile，读 `missing_originals_page(..., 100)` 和元数据状态，最多启动两个下载。代码显示这是引用元数据队列，不是空闲时全盘读取/逐文件 hash；实际 hash 属于活动传输/校验阶段。位置：`crates/exomind-beta-host/src/peers/original_auto_store.rs:11,140-153`；`crates/exomind-beta-host/src/peers/original_auto_queue.rs:7-13,121-232,294+`。 |
| P1（包体） | **调试符号占用。** 同 ABI/签名/调试标志下，两候选 `.text` 相同，Beta10 只在 `.rodata` 增 4,096B；`.symtab + .strtab` 约 38.05MiB。 | 这是 APK 与安装存储成本；符号表本身不能证明运行时 RSS/掉电。后续用同一源码分别产出正式 release APK 与独立符号包，再比较；本轮没有编译 release 或安装候选。 |

**排除/较弱候选：** `MainOverlayBridge` 的 bridge poll 为 250ms，但组件在 `desktop=false` 时不挂载、不连接；Android/iPad 用户代理都走此分支，故不把桌面 Overlay 轮询列为平板根因（`src/beta/overlay/MainOverlayBridge.tsx:23-36`、`src/beta/overlay/main-owner.ts:79-105`）。

## 5. 待验证 / 不支持的判断

### 待验证

- 外心处于前台、Now 可见、Sync 可见、Settings 可见以及普通后台状态的真实 CPU/线程/唤醒、PSS/RSS、WebView renderer、帧与 Native RPC 成本。
- 电池瞬时电流/净充放电方向和 USB 实际输入功率。当前 sysfs 权限拒绝；可在 Native 层只读尝试 Android BatteryManager 属性，若缺测就显示 unsupported/null，不重置统计。USB 最大充电字段不能代替输入功率。
- App 私有存储各 SQLite 主库/WAL/SHM、原件、cache、log 的字节数与增速。当前 `run-as du` 输出不可用，未读取文件内容。
- 实际 PeerNetwork enabled、routes、重试、队列 pages 和活动传输状态。没有读取当前档案/授权/peer 数据，也没有执行同步。
- 后续同源码 debug/release 的完整 `opt-level`、LTO 与剥符号对照。父代理已续核 Beta10 Cargo 日志为 dev/unoptimized；尚无同源码 release 行为/资源结果。

### 当前证据不支持

- 不能把“32%”或用户先前“约35%”单独转换成外心功率或续航估计。
- 不能据 USB powered=true 判定 USB 供电足够，也不能因此否定用户掉电线索；本次没有输入电流计量。
- 不能归因到外心：采样时没有外心 PID，通用 WebView renderer 未建立到外心的父子/DevTools 归属链。
- 现有源码不支持“自动原件在 idle 时对全部本地文件全量 hash/扫描并持续逐条写日志”的说法；所见的 auto queue 是受 PeerNetwork enabled、策略、routes、分页与容量限制的数据库元数据扫描。
- 未发现嵌套 Rime APK 或可据此计入的 Rime 二进制。包内 `annotation-experimental` 名称的子串匹配不构成 Rime 内容。

## 6. 本机性能面板的指标清单

所有字段统一携带 `value / unit / source / sampled_at / status`。状态至少区分 `current`、`stale`、`unsupported`、`permission_denied`、`error`；缺测保持 null，不填 0。指标在本机显示，默认不上传；性能采样不采正文、模型请求或 token/凭据。按用户要求，非凭据的路径、端点、设备/档案身份保留在本机详情层展示的可能性；这与默认性能导出的范围分开。

| 对象 | 指标、单位与权威来源 | 当前已有接口 | 采样与保留建议 / 代价 |
|---|---|---|---|
| 构建与包体 | version/name/code、source hash、ABI、debuggable、签名指纹、APK/DEX/SO/ELF section 字节；安装包/构建清单静态读取 | 候选元数据已有；当前 Native `beta_status` 不等同完整构建证明 | 静态加载；每次候选变更更新，不轮询 |
| App 与子进程 | 每 PID CPU time delta / %core、线程数、RSS/PSS/Private Dirty/Native/Java heap；Android `dumpsys meminfo` / `Debug.MemoryInfo` 和进程 CPU，Windows Process API | 无当前 App PID 指标 | CPU 5–10s，内存 30s；renderer 按精确 parent/UID 映射，禁止把无关进程并入，也不把 RSS/PSS 重复相加 |
| WebView renderer | PID、PSS、JS heap bytes、DOM node count、长任务 ms、frame/paint 统计；Android WebView/ActivityManager，调试版 CDP，Windows WebView2 ProcessInfos | 无当前 renderer 归属；debug CDP 仅适用于可连接的候选 | 高频 DOM/rAF/录屏不作常驻采集；CDP 单列短追踪与 overhead，release 无 CDP 时标 unsupported |
| 电池与热 | level %、voltage mV、current µA、charge counter µAh、status/plug enum、thermal status、battery/skin °C；`ACTION_BATTERY_CHANGED`、`BatteryManager`、`ThermalService` | `dumpsys battery` 有 level/status/电压等点读字段；本机 current 属性未获访问 | 30–60s；BatteryManager 电流 API 按文档正值=充电、负值=放电，并保留 unsupported/null；USB 输入功率单独标 unsupported，不能用 max charging limit 代替 |
| 屏幕/前后台 | foreground section、document visibility、display awake、亮度模式/实际亮度、温度状态；Native/OS | section/visibility 在 UI 内可读，系统点读接口存在 | 随事件记录，不截图；实际亮度若自动模式则与设置值分开 |
| Scheduler / Summary | tick/wake count、实际等待/提前唤醒数、每轮耗时 ms、due count、profiles/pages/rows、claim/no-op/task count、DB duration、model call duration | 已有 `ServiceStatus` / `SummaryServiceStatus` 只给运行/active/error 摘要；缺轮询量和耗时 | 用现有循环内的计数器及直方图，无逐 tick 日志；每 5s 刷 UI |
| Beta UI/Native IPC | Timer refresh 次数、status/snapshot 调用数与耗时、Timeline page/row/merge 数、visible 状态、React commit/render tick 计数 | 现有 controller 与 timeline API；没有耗时面板 | 自然路径埋点；页面打开面板后 5s 聚合，不开持续 rAF 或 DOM MutationObserver |
| PeerNetwork | `network_enabled`、peer 状态数、route attempt/success/failure/backoff、discovery announce/min、活动连接与队列数 | `PeerNetworkStatus`、`OriginalAutoQueueStatus` 已有 enabled/peer/active/deferred/error 摘要 | 默认聚合；本机可展开非凭据端点、设备身份和故障原因，手动导出可选择/脱敏这些字段。身份令牌、密钥和授权 secret 不展示或导出 |
| 自动原件 | auto policy/threshold、metadata pages/rows、eligible/skipped/deferred、active transfer count、bytes/s、hash bytes/ms、retry/backoff 与 error code | 队列状态和单原件阶段/offset 已有；缺扫描量、阶段 duration、吞吐直方图 | 只对真实页/块/传输更新计数，不按文件内容轮询；不记录文件名或正文 |
| 存储 | Core/auth DB、WAL/SHM、local source/originals、cache、logs 的 bytes 与 `Δbytes/min`；文件元数据 `stat` | 可读状态接口不提供分项尺寸/增速 | 每 60s 汇总元数据，不打开文件内容；存储扫描自身时长也作为成本显示 |
| 采集器自身 | sample duration ms、IPC 次数、读取字节、ring-buffer bytes、丢样数 | 无 | 采集成本在面板可见，采样器不能造成比被测 idle loop 更密的负载 |

建议高频计数只保留进程内 30 分钟有界环形缓冲（5–10 秒聚合桶）；Battery/thermal 每 30–60 秒，文件尺寸每 60 秒。默认退出即丢弃，用户显式导出时只导出非凭据聚合数据；若后续需要跨重启趋势，再单独评估本机持久写入的电量与 WAL 成本。

## 7. P0/P1 修复顺序与验证方案

| 顺序 | 建议 | 不影响正确性的验收条件 |
|---|---|---|
| P0-0 | 在修复前先加最小计数/耗时：scheduler、summary、Timer refresh、Peer status、timeline、auto queue。计数走原有执行路径，不新增轮询。 | 同一 Beta10/设备重复 3 次空闲窗；确认计数与 OS CPU/内存、电池读数同步；记录采集开/关成本。 |
| P0-1 | 优先消除无必要的 Native 高频空闲扫描：scheduler 按最近 deadline/显式 wake 等待；summary queue 由任务/信号唤醒并保留启动恢复与低频漏检兜底。 | 合成 Core/Native 测试覆盖“新 deadline 在等待期间加入”“到点恰遇睡眠/恢复”“summary 在 worker 休眠时入队”“restart 恢复 queued/running”；检查 deadline 不漏、不早结束，任务不丢不重复。不要用真实档案写测试时间块。 |
| P0-2 | 让隐藏页面停止高频展示/状态读取；Timer 隐藏时暂停 250ms tick 和 1s refresh，返回时立即读权威快照；Sync status poll 只在可见/显式刷新时运行。可将身份和 snapshot 做成一个 Native 原子读，保留 runtime/device revision 核验。 | 在 Now/Sync/Settings 间切换并恢复时，旧结果不覆盖新 profile/runtime；空闲时调用计数明显下降；计时由 Native scheduler 保持，UI 恢复后显示与权威快照一致。 |
| P1-1 | Timeline 对“无新 highwater”使用低成本确认/事件触发刷新，保留 16 页追赶边界与旧页面锚点。 | 新事件/跨页 gap 仍补齐，hidden section 不触发读，列表 conflict 和高水位语义不变。 |
| P1-2 | PeerNetwork enabled 时分别量 discovery、route retry、auto queue 空页成本；无 route/无 missing item 时退避或等事件唤醒。保持用户显式启停、授权隔离、重试上限与 source completeness。 | 使用合成三 Host / TLS / 原件数据验证关网后退避、重连及时恢复、字节 hash/ACK/撤销边界；不读写本机真实档案。 |
| P1-3 | 用同一 commit、ABI、签名基线建立 release APK，符号单独归档后复查 `.text/.symtab/.strtab`、包体、启动和资源。 | release 与 debug 配对验证相同功能/权限/来源；先通过离线合成与当前候选验收，再进入受控安装窗口。本轮未构建或安装 release。 |

### 后续物理设备窗口

待用户自然打开 Beta10 且主代理完成单路编译/测试后，再预约同一设备只读窗口。每个区段先稳定 2 分钟，再采 10–15 分钟：Now 空闲、Sync 可见、Settings 可见；如做后台对照，仅在无 modal/未确认提交时用 Home，结束后恢复原页面。维持现有亮度、网络、USB 与后台策略，不写档案、不结束用户计时、不 reset batterystats。PID/父子 WebView/UID 每段重新核验；电流权限缺失时报告缺测，不用电量百分比计算功率。修复前后使用相同 APK profile、网络/屏幕条件和采样器，并另用合成 Core 测试验证所有写入与恢复语义。

## 外部证据包清单

- `android-state-point.json`：ADB 版本、安装包摘要、前台/供电/温度单点；序列号仅在此文件中。
- `apk_profile_inventory.py` / `apk-profile-inventory.json`：APK 解包成员计数与 selected ELF section sizes。
- `package-comparison.json`：两个 Android APK 与 Beta09 Windows exe 的哈希、签名、profile 摘要及局限。

最终判断：用户的掉电反馈保持为 P0 线索；系统点读数只能描述那一刻。源码已给出可优先测量的高频循环，包体也确认带有调试符号成本。下一轮应先在外心实际运行时采到进程与 Native 计数，再依据对照数据决定哪个循环是首要修复目标。

## 父代理续测：Beta10 主进程短时窗口

2026-11-17 19:22–19:24 +08:00，独占设备采样、暂停重型构建；正常启动已验证的 Beta10/6010，3 秒后开始前台采样，随后用 Home 进入后台，结束后正常恢复外心前台。未改变亮度/网络/供电策略、未写测试事实或重置系统统计。主 PID 与 `/proc/stat` 的启动 tick 全程相同；每 5 秒读取主进程 stat/status/io 和 battery，阶段末读取 meminfo，没有 CDP、rAF、录屏或 profiler。证据包 `beta-performance-investigation-20261117-b` 与 supervisor `beta10-idle-window-20261117-a` 均在仓库外，命令 completed/0、cleanup confirmed。

| 窗口 | 实际跨度 | 主进程 CPU 时间 | 单核占用率 | 采样 RSS 范围 | 线程数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 冷启动后前台 | 63.297s | 13.16s | 20.79% | 128.61–227.50 MiB | 75–80 |
| 随后后台 | 63.656s | 0.93s | 1.46% | 59.32–160.12 MiB | 75–76 |

CPU 采用 `Δ(utime+stime)/CLK_TCK`，设备 CLK_TCK=100；百分比按单核归一。两个窗口均非稳态重复实验，前台紧接冷启动、执行次序固定，缓存、系统内存回收与真实服务状态未控制；RSS 波动也不能证明泄漏或修复。未归属 WebView renderer、系统进程或 GPU 成本，不能当成整个应用 CPU。电量两个窗口都是 28%、USB powered=true、status=2，仍没有电流或 USB 输入功率；charge counter 原始值保留但单位/分辨率未核实，不用它换算功率或掉电归因。

这次续测补上了主进程实际 CPU/内存窗口，说明需要继续测量前台工作；**尚未定位到具体循环，也不是性能修复前后验收**。下一步仍需暖机后的重复窗口、Native/IPC 自然路径计数和 renderer 归属，之后再决定最小修复。

## Beta13 实物平板续测（2026-11-18）

最终候选来源 `835d062049bdb6ee1007cdf52802c15b55a8991e`，Android15/API35 实物平板；6013/base APK 哈希与固定交付匹配，旧 0.5.2 保留。本次 Beta 为独立新装，仅使用合成档案完成双端与生命周期测试。具体产物/设备边界见 [Beta13记录](../plans/2026-11-18-beta13-shell-and-desktop-feedback.md)。

`G:/exomind-runs/beta13-feedback-20261118-a/tablet-resource-run/` 正常 completed/0、cleanup confirmed。3个各约20秒窗口，按同一 Native/JVM 主 PID 的 `/proc/<pid>/stat` 计算单核 CPU，`CLK_TCK=100`、进程启动 tick 不变；各段末读取 `dumpsys meminfo`。结束恢复前台与原同步设置，无遗留 ADB 转发。

| 场景 | 跨度 | 单核 CPU | TOTAL PSS / RSS（KiB） |
|---|---:|---:|---:|
| 前台、同步关闭 | 20.116s | 7.26% | 256,566 / 382,828 |
| 后台、同步关闭 | 20.084s | 0.55% | 158,391 / 285,156 |
| 前台、已授权 peer 离线 | 20.118s | 7.51% | 256,859 / 384,060 |

末次电量92%、USB powered=true/status2，仅为点读数，没有电流/输入功率，不能换算外心能耗。三段顺序固定、没有2分钟暖机/多次重复；缓存、GC、回收未控制，renderer/GPU 尚未精确归属。不能与前述 Beta10 冷启动窗口直接做优化归因，也不能以包体减小证明运行资源下降。

包体已确认 AGP 的 NDK 选择曾令 strip 缺失，修正后 APK68,910,081B、较 Beta12 约小36.5%；移除符号表40,513,913B，执行/动态 section 字节相同。仍为未优化 dev profile，原始符号单独归档。性能 P0 与完整本机观测面板未完成；下一步补原执行路径计数、renderer归属、采样器自成本，再按相同候选/网络/屏幕/USB条件重复暖机窗口。显示态只能停止自己的绘制与观察，不能停止其他表面依赖的业务所有者。
