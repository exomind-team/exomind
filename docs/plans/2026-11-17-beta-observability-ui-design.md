# Beta 本地运行与性能观测面板设计

> 2026-11-17，Asia/Shanghai。**用户新增授权的设计方案，尚未实现/运行验收。** 源码盘点固定在 `aefa5223cfc431e88a3ef1f673f67e3c84cca4e1`（B）；Alpha05 呈现基线固定为 `99b6b6480e810d6cff8559650387db4adfd45386`（A）。后续 P0 源码变化须重新对账，不把本文当作当前已具备的指标 API。

目标是让用户在本机看清**外心自身**正在怎样运行、哪里消耗资源、最后确认到哪、有什么可处理的异常，并能带走有范围的诊断证据。先建设本地观测、保留和手动导出接缝；不自动增加任何远端遥测上传。

## 1. 需求、事实与设计来源

| 来源/等级 | 本轮确认内容 | 不能推出的结论 |
| --- | --- | --- |
| **用户新需求** | 本地优先的总控运维面板；覆盖版本/进程/存储/网络/同步/原件/调度/模型/UI/能源；本机非凭据数据可直接展示或保留展开入口 | 不需要先接云服务，不把“为遥测准备”理解为同意上传 |
| **用户现场反馈，根因未知** | 平板约35%电量，外心常驻前台且通过电脑 USB 供电，仍持续掉电；必须重视能源与空闲开销 | 不证明外心 CPU、WebView、同步、屏幕、供电或某次轮询是具体根因；没有掉电速率/功率测量 |
| **视觉参考，非外心运行证据** | 用户提供的 FlClash 截图已用 `view_image` 读取：大状态概览、相邻紧凑指标/趋势、成组控制、下方详情分区、稳定侧边导航 | 不复制 VPN/DNS/代理业务、蓝色品牌、真实地址/组织/配置/读数；截图单帧也不证明能源趋势 |
| **已确认的 Alpha 基线** | 暖石/橙色、Shell/PageShell、消息/输入/计时 View、设置 registry/renderer、主/浮窗任务组合 | Alpha 没有可据此称“完整本地性能面板已成熟”的验收。[R01、R02] |
| **ARC 方法** | `arc-ui-design` 0.6.0-alpha.2 P02–P10、C04/C05；K01–K11、I01/03/05/09/11、SF02–07/SF10、反馈验收 G1–G6 | P/C 与通用/试作方法按原归属使用；不搬其他项目的材质、数值预算或自由编排系统。[R01 §1] |

原图未复制到仓库，正文不转录其中的网络信息、配置与数据。本文只有源码、既有验收和设计推导，没有新增应用运行、平板操作、采样或构建；避免改变另一路性能探查的现场。

### 1.1 P0 约束

1. **能源与空闲开销先于装饰性实时感。** 空闲、前台/后台、屏幕、充电路径和观测开/关必须有可比较证据。新面板不能靠持续动画、高频桥接、反复扫描全目录来展示“软件还活着”。
2. **不让诊断妨碍可靠记录。** 样本采集、磁盘扫描和导出有界、可取消、低优先级；不得长时间持有 Core 事务门或压住文字/计时操作。面板隐藏不停止必要业务服务。
3. **只显示达到证据的状态。** 不把已连接称为同步完成，不把事件补齐称为 projection 完整，不把 USB 连接称为净充电，不把未测/无权限称为0。
4. **本地可见不等于凭据可见。** 原始本机路径、监听地址、实例/进程身份可在本机显示与展开；密码、密钥、token、完整邀请材料及其可恢复表示不进入 UI、复制、环形记录或导出。业务正文、附件内容、模型请求/响应不默认进入诊断导出。
5. **当前是设计授权。** 不启动用户实例、不改采样环境、不提前宣称耗电优化或指标采集已完成；必要 P0 度量由核心/性能负责人落地并单独报告。

<a id="existing-sources"></a>
## 2. 现有状态源与尚缺的采集

“已有”只表示下列源码合同存在；运行/候选证据另见 [Beta盘点](2026-11-17-v0.6-beta-progress-audit.md)。本表没有从旧 RT 的同名服务推定 Beta 已接。

| 对象 | B 中核实的权威接缝 | 已能表达 | 还缺什么/证据等级 |
| --- | --- | --- | --- |
| 版本/实例/本机位置 | `resolveVersionBuildInfo`；Native `RuntimeLocation/beta_runtime_location`；Host `HostStatus/HostCapabilities`；`BetaRuntimeLocation` | app/build、protocol、runtime/device、running/capabilities；HTTP listener 的 starting/listening/unavailable/stopped、真实目录/地址 | **源码存在**；构建 profile/编译参数、包体组成和进程指标不在这些 DTO 中。[S01、S02] |
| 对端连接 | `BetaPeerStatus/BetaPeer`；Host peer network | network_enabled、local_addresses、成员代次/授权状态、连接状态、last_sync_at/error、事件/原件同步分类 | **源码存在**；不是潜在发现；TS DTO 无完整每来源游标、真实队列/速率、详细 listener 统计。[S03、R03] |
| 来源与补齐 | Host `PeerSyncResult/PeerSnapshot`、`peers/sync_store`；Core origin chain | 内部有 sent/received snapshot、cursor seq/hash、已发送/接收/重放事实数、projection complete 可选值及持久 ACK | **内部源码存在，UI诊断接线待建**；不能用 `event_sync=complete` 替代全来源覆盖。内部库函数不是公开诊断 DTO。[S04] |
| 时间块 | `BetaTimeblockSnapshot/nodes/intervals`；Core timeblock projection；`timeblock_history_incomplete` 错误 | revision/heads、active/phase、pending_feedback、权威clock；节点parents；当前错误可知历史不能完整解释 | **源码存在**；完整“缺哪个父/哪个来源/哪些范围”需要 Core 提供有界证据，不能让前端猜根因。[S05、R03] |
| 原件/附件 | `LocalSourceState`、stage/original DTO、`BetaOriginalTransferStatus`、`OriginalAttachment` | 源复制/就绪、上传offset、校验、availability、请求/来源、传输阶段/错误；Host 自动队列另有内部存储 | **源码存在**；各阶段 enter/exit/queue wait/CPU/IO耗时、完整队列诊断与准备阶段总量没有现成完整 UI 指标。[S06] |
| scheduler/系统提醒 | Host `ServiceStatus/service_status`；`beta_native_deadlines`；`BetaDeadlineAlertStatus` | 内部调度服务身份/running/error；平台可用性、通知权限/精确闹钟资格、登记/投递计数、keepalive_requested | **源码存在**；`keepalive_requested` 不是服务实际存活/耗电证据，权限具备不是准时送达；唤醒/耗时/能耗统计待建。[S07] |
| 模型任务 | `SummaryServiceStatus`、`SummaryTaskView/RunView/AttemptView` | waiting_configuration/queued/running/retry_wait/succeeded/failed/cancelled、owner代次、attempt/retry_at、coverage变化/结果身份 | **源码存在**；请求已接受、提交结果、模型质量、费用与能源分别判；不默认保存业务请求或密钥。[S08] |
| UI/进程/存储/能源 | 现有前端有读状态、计时、草稿和刷新逻辑；目录位置可读 | 能指出已知循环与状态入口，不能据 render 次数得 CPU/能耗 | **新增采集需求**：下述 OS/WebView/目录测量与本地 ring store 未在上述合同中核实为成品；待性能探查，不填假数值。[S01、S09] |

Beta10 `64d170c40eeaba9e3cc629ba330fc525908ce1ae` 修掉“读 loading 每秒让控件灰变”，并保留缺历史恢复入口。这证明一次 UI 状态资格修复，**不证明空闲CPU/掉电根因已经定位或解决**。当前计时显示 tick、快照读取、Native deadline loop 等周期只能登记为待测活动源。[R01 §5、S09、R03]

## 3. 信息结构、导航与视觉组织

### 3.1 从进入到处理

默认路径建议为 **设置 → 运行诊断**；桌面侧栏可在后续提供同一目标的次入口。手机先保留当下/同步/设置三个主入口，不为参考截图机械新增图标栏。运行位置详情可链接同一诊断对象；同步错误、缺父历史、原件准备慢可带对象ID跳到对应分区。全部是**新设计建议**，入口接入须沿 Beta 自有导航。[S01、S10]

诊断作为普通内容页使用 PageShell；页头弱化显示当前构建、实例和观测状态。主层回答“正在运行什么、当前哪里需处理、资源是否在变化”，详情层给身份/口径/时效/原因，诊断层给有权限的有界事件证据。无需离开页面查一堆独立设置表才能理解当前对象。[R01、ARC P03/P05/P06/P09]

| 区域 | 默认内容 | 就近动作/下钻 | 状态权威与退出 |
| --- | --- | --- | --- |
| 运行概览（大卡） | 当前实例/构建、Host/采样状态、最近确认、待处理边界；能源观察状态与“USB供电/净变化未知”等实况 | 查看实例/能力、刷新快照、进入异常分区 | 不能给单一“全部健康”绿灯掩盖缺测；展开后返回保分区/对象/滚动 |
| 紧凑指标/趋势 | CPU、内存、能源/空闲等有真实采样后再出现数值和小趋势；无数据时显示原因与“尚未采样” | 选采样窗口、看组成/口径；暂停观测 | 同一MetricSample驱动读数和图；不是预设曲线或装饰波浪 |
| 数据与资源 | DB/WAL/原件/缓存组成、目录范围、扫描时间 | 手动重测范围/查看本机路径；无自动清理动作 | 文件系统/数据库元数据；扫描取消保上次结果并标陈旧 |
| 网络与来源 | HTTP API与peer listener用途、实际监听、成员/连接；按来源覆盖和projection分开 | 到同步页、展开某来源/游标/缺父证据 | Native/Host/Core原状态；进入详情不发邀请、不扫描网段、不自动同步 |
| 原件流水线 | 有界活动队列、等待原因、阶段、已知字节、阶段耗时、最近失败 | 展开同一file/command/attempt；去现有获取/取消/重试入口 | Native源副本/Host队列/校验；打开面板不开始取件或hash全库 |
| 调度与模型 | scheduler/系统提醒/后台权限、模型任务各自状态和更新时间 | 到现有设置/任务详情；支持的取消/查证经原领域接口 | 请求取消≠已停止；提醒权限≠已投递；回顾生成≠内容质量通过 |
| UI与观测器自身 | 各WebView活动、可用UI响应样本、采集/聚合/绘制/持久化成本、丢样/退避 | 限时详细观测、暂停/恢复、手动导出范围 | 不用采样器的自报“正常”代替独立性能对照 |

大概览与紧凑卡邻接，下方按对象分区、每个关键值可追到同一来源和时间窗口，是截图可迁移的组织方式。**橙色用于外心主动作/选中，暖石区分页面/卡/边界，成功/警告/错误另有语义**；不照搬蓝色主色、大面积背景特效、VPN按钮或配置组织。[R01 §3、R02]

### 3.2 容器与输入

| 容器 | 组织建议 | 必须保持的操作 |
| --- | --- | --- |
| 桌面宽窗口 | 大状态概览占主要宽度，相邻2个关键指标；下方按实际容器组成两/多列。详情可用页内侧区或Dialog，不重复套全局壳 | 键盘定位卡/读数/图中点，真实进程行可查；页头导出/采样控制不被长路径挤掉 |
| 平板横屏/窄桌面 | 概览与指标自动重组，分区保顺序；能力按平台判，不按宽度误授桌面进程权限 | 触摸可开详情、筛范围、暂停；软键盘、系统栏、旋转后同对象与滚动仍在 |
| 手机/竖屏 | 概览压为必要状态，指标单/双列按容器；长表转对象行/详情，不整体缩放 | 每项保单位/时效，刷新/返回/导出有完整点击区；不用hover/右键作为唯一入口 |

浅/深色覆盖卡片、图轴、图例、弹层、选择/禁用/错误；状态不只用颜色。长路径/ID在详情可选取/复制，主层保精确身份的短表示及完整展开；**本地详情不强制把合法路径/地址全部打码**。不显示或复制凭据。[用户新增边界、ARC C02/C05]

图表提供当前值/单位/窗口/样本数及可访问文本等价；缺样留断口，暂停留最后值及其年龄。拖选区间若引入，必须有精确时间输入/键盘与触摸等价；初期可只提供窗口选择和点选，不为“交互性”增加画布系统。

### 3.3 与当下、记录和显隐的关系

- 沿 `BetaAppShell` 的单一 workspace/portal，导航改变可见性，不因进入诊断重新创建草稿writer、模型编辑器或计时owner。[S10]
- 当下/记录显隐、浮窗显示、诊断页进入是三种状态轴；不得把“看诊断”变成清空输入、隐藏记录永久生效或停止计时。稳定恢复入口按[Alpha参考 §7](../development/alpha-ui-ux-reference.md#visibility-migration)。
- 离开诊断停止其高频呈现及订阅请求，保留有界状态。后端必要业务、已有传输、scheduler继续按领域合同运行；不与“暂停观测”绑成同一个按钮。
- 诊断页自身高频采样只在可见/限时探查时开启；返回只读最新快照与保留窗口，不重播历史成功、不自动打开刚关闭的详情。[ARC P04/P05/P07、SF05]

<a id="metric-catalog"></a>
## 4. 指标目录：来源、单位、时效与能力

下表是**需要实现的最小口径**。现有来源与新增字段已分开；不得把候选接口名写成已经可调用。各指标都带第5节的状态/身份/时间信息。

| 类别/指标 | 权威源与必须说明的口径 | 单位/时效/能力差异 | 当前状态与默认呈现 |
| --- | --- | --- | --- |
| 版本/构建/包体 | 构建产物metadata：app version、commit、protocol/schema、target/ABI、debug/release/profile、优化/符号配置；包体组成来自绑定hash的构建分析manifest | 原始bytes，显示MiB等明确换算；静态随构建变更，不轮询解包。APK/安装器/已装体积分别计 | 版本/构建已有，profile与manifest待增。Beta09历史包约107.9MB及SO/符号构成仅为历史分析，不填成当前包值。[R03 §5/6、S02] |
| Host/进程/WebView身份 | Native拥有的进程/窗口映射，进程键含PID＋创建时间/生命周期；区分Host进程、WebView renderer及可能共享进程 | pid/role/start/uptime；启动/退出事件更新。Android/Windows/Web远端各有权限边界 | 实例ID已有，进程映射待建。Web页面只认自身能力，不谎称能读远端OS进程 |
| CPU | OS累计CPU时间的差分；说明100%表示单核还是整机归一、采样窗口/核数；JS主线程与全进程分开 | CPU ms、%/窗口；首样/计数重置不能算速率。支持哪些进程由Native能力探测 | **新增采集**；卡片未采集时不用0%；归一口径随样本一起导出 |
| 内存 | OS报告RSS/working set/private/PSS等实际可得字段及方法；Web JS heap仅在宿主确有能力时单独列 | bytes/MiB、sampled_at；共享内存不重复相加；不同平台方法不能直接排性能名次 | **新增采集**；不能把JS heap叫应用总内存，或把各WebView重叠RSS相加叫净占用 |
| 线程/响应 | OS进程线程数、服务worker身份；请求/主线程响应通过有界被动事件或限时探针 | threads、latency ms，n/窗口/测量方法；UI可响应≠Host所有worker正常 | **新增采集**；探针本身成本另计。纯Web不承诺系统线程级细节 |
| 数据目录/DB/WAL | Native当前root及文件元数据；数据库提供必要schema/表/页面元信息，按需只读统计 | logical bytes与allocated bytes分开、WAL/SHM单列；统计带范围/扫描起止/权限失败 | 目录已有，体积/统计待建。不能为观察执行checkpoint/VACUUM/整理，不跟符号链接扫出根目录 |
| 原件/源副本/缓存占用 | Core/Host文件布局及引用元数据，Native/浏览器各自缓存适配器 | bytes/count；完整、部分、private-source、派生/预览缓存分组；去重前后分别说明 | **新增聚合**。Blob/IndexedDB/OS缓存能力不同；目录求和不等于全部可释放空间 |
| HTTP API | Native真实server绑定与listener_state；请求统计来自HTTP处理边界，按route模板/结果/耗时聚合 | 状态、实际地址、requests/window、inflight、latency ms；本机origin而非peer地址 | 位置状态已有；请求/连接计数与耗时待采。不显示认证头/完整URL参数/请求正文。[S01] |
| peer listener/连接 | PeerNetwork真实绑定/会话/传输计数；用途、授权成员、连接方向和生命周期 | endpoint、connections、bytes/s、bytes累计、retry_at；TCP/TLS成立不等于档案授权或补齐 | 状态/地址部分已有，统计待建；不照搬VPN/代理控制，不开诊断监听到局域网。[S03] |
| 来源游标/覆盖 | Core/Host持久 origin identity、seq/hash、目标head、receive cursor/确认ACK；分页范围与授权边界 | 每来源cursor/heads/known facts；seq只在同来源比较，不能全局相减制造“差N条” | 内部已有数据，需安全有界DTO；未知目标head时只写覆盖未知，不造全局进度。[S04] |
| projection/缺父历史 | Core投影结果/revision/heads、明确不完整原因；缺父ID/来源来自Core校验，不用UI选候选猜 | complete/incomplete/unknown；缺父/待来源集合及范围、首次/最近见时刻 | 当前错误与节点parents已有；诊断列表待实现。文字同步完成仍可能投影不完整。[S05、R03] |
| 附件流水线 | 选取/源复制/源hash/暂存分块/校验/记录提交/跨端取件各worker边界；stage/command/request/attempt固定关联 | queue_wait_ms、wall_duration_ms、bytes_done/total、chunk count、retry、active elapsed；复制/hash可重叠，不能把阶段耗时简单求和当总耗时 | 阶段/offset部分已有，完整span与队列统计待采；准备慢无阶段证据不归因“上传慢”。[S06] |
| scheduler | Host ServiceStatus与Core deadline选择/完成事实；每轮唤醒原因/工作量需增加低成本计数 | running/instance、due/handled counts、wakeups/window、run/lag ms；单调/墙钟域及重锚定注明 | 身份/running/error内部已有；wake/耗时/lag待采。观察面板不创建业务到点事实。[S07] |
| 模型任务 | Summary worker与持久task/run/attempt、owner代次/取消围栏、回执及provider可得usage | 队列/运行数、阶段与持续ms、有限重试/next_retry、token usage或unknown；任务/尝试/产物分别计数 | 大量状态已有，聚合与耗时需接；取消请求不等于上游停止计费。默认不收prompt、记录内容、响应全文。[S08] |
| Android后台/权限 | Native/OS实际服务状态、通知/闹钟权限、电池策略与前后台切换；请求状态与运行状态分开 | 枚举/计数/时间；OEM拒绝或不可读按能力显示；Web/桌面不伪造Android字段 | 部分权限/请求已有；真实服务存活、策略/唤醒等待探查。具备资格不等于准时通知。[S07] |
| UI长任务/帧/响应 | 当前WebView在支持时提供的性能条目/呈现时序，按WebView/可见区间绑定；限时输入延迟探查 | long-task duration ms/count、frame interval ms及样本窗口；缺乏可靠显示时机时不得称真实屏幕FPS | **新增采集与能力探测**；诊断图帧、计时display tick、事实采样不是同一计数 |
| 电池/供电/热/空闲 | OS可用电池状态/SOC、充电类型/状态、温度、电流/电压/能量计数；外部供电测量另列；进程归因依OS证据 | %、百分点/小时、°C、mA/mV/mW/mWh仅在源确实支持并校单位/方向时使用；趋势带窗口/n | **P0新增探查**；电量下降是设备净变化，不能直接写“外心功耗”。USB已连接≠输入功率够用 |
| 观测器自身 | collector/桥接/聚合/绘图/写盘各边界；独立工具A/B对照核实整体增量 | own_cpu_ms、read/scan bytes、poll count、frame/longtask、buffer bytes、dropped/coalesced、export duration、能源差分 | **P0待采**；先预算再开持续采样，不能为监控建立新的无界日志/定时器 |

每项“无权限/不支持”必须说明主体和能力范围，例如“此Web连接未提供本机进程指标”，不写“没有进程”。“0”只用于确实采到的零；空列表同时带范围/完整性，不能默认表示整个软件没有活动。

## 5. 状态与数据合同（建议，未实现）

### 5.1 一条指标要随值带什么

| 字段组 | 最小内容 | 用途 |
| --- | --- | --- |
| 身份 | metric_id、app/build、device/runtime、profile（适用）、process/WebView/service、lifetime/attempt | 防重启PID复用、切档案或新run覆盖旧对象；不能只靠卡片位置关联 |
| 来源 | authority、采集方法/口径、unit、scope、capabilities、schema_version | 分清OS/Host/Core/UI，说明本机/远端/部分范围；不导出凭据 |
| 时间 | source_event_at（适用）、sampled_at、received_at；duration用单调时钟并记录epoch；窗口起止/n | render时间不刷新样本年龄；OS/远端墙钟不能任意相减作阶段耗时 |
| 质量/状态 | known、loading_initial、refreshing、stale、unsupported、permission_denied、unavailable/error、partial；value/last_known与状态绑定 | 区分新鲜值、上次值、真实零与缺测；reason code可下钻，不输出任意错误正文 |
| 覆盖 | measured_scope、limit、cursor/window、complete/partial、dropped/reset及误差/估算标记 | 有界尾部不是全部历史，采样不是完整事件统计，累计重置可见 |
| 行动 | 可读取/重试/导出/取消的能力、目标对象/预期版本 | 控件只调用有权限真实接口；不是采样中就全页disabled |

实现时采用能表达互斥状态的DTO；例如缺测状态不能同时携带伪造 `value:0`。陈旧状态可保留 `last_known`，但必须保其原始采样时刻。已知值刷新中保原值和操作，失败留原因直到权威恢复，沿用 Beta10 经验。[R01 §5、S09]

现有状态接口并非全部带源采集/变更时间：适配器只能如实记录“本端何时读到”，不能把接收时刻或render时刻填成源事件发生时刻。源时效未知时明确标未知；本地读取成功也不证明某个对端最近仍在线。

### 5.2 状态显示与事件投影

- 首次无样本：显示“尚未采样/正在读取/不支持/无权限”等真实阶段；骨架不预画假曲线。
- 后台刷新：卡片和详情不重新挂载；同值/同revision不做完成脉冲。只更新变化区，保焦点、选择、展开和滚动。
- 停止/陈旧：保最后确认值＋时间/范围，趋势停在最后样本；暂停观测不冒充Host暂停，断线不冒充指标归零。
- 高频：网络分片/采样进入聚合；关键错误、授权变化、projection失败和取消结果保留可定位事件。事件重放/重连补齐不重复计成果。[ARC SF03–07]
- 来源/权限变化：同一张卡显示新对象前清楚换身份，旧异步回调不能写入；本机观察到的“对端最后状态”不等于对端现在仍如此。
- 展开本机详情：地址、目录、实例、可读非凭据配置可正常显示和复制；不用“隐私”名义把用户明确允许的诊断能力清空。凭据从数据源边界排除，而非仅用CSS遮住。

### 5.3 原件与同步的关键区别

流水线至少分为：**本机源准备 → 本机原件暂存/校验 → 记录提交 → 对端元数据/事实补齐 → 对端原件取回/校验**。阶段可以重叠/重试，队列等待另计，不画成必然依次完成的单向百分比。未持久化或丢回执显示待确认；取件取消保已收部分及request身份。[S06、R04 §4]

来源详情分别列 **来源head、当前持久cursor、确认ACK、projection状态、原件缺口**。没有全集证据时不得给“已全部同步”；`local_projection_complete` 的可选值为 unknown 时不当 false或true。缺父列表来自Core，UI只提供到可连接来源/同档案授权的核对路径，不制造缺失事实。[S04、S05]

## 6. 采样、保留与自成本预算

### 6.1 职责分界

建议最小链路为：**Native/Host/OS能力适配器 → 单一有界采集/聚合所有者 → 本地快照与环形保留 → 受控纯View → 手动诊断导出**。诊断不通过导入旧Runtime/AgentsPage来获得数据，也不在每张卡里各开一条无限轮询。[R01、S10]

业务事件计数优先在已有边界被动更新，OS资源值按需采样；昂贵目录遍历、包体分析、数据库统计走手动/低频独立作业，限制并发/读取量/时长，并可中断。不能每个采样周期重新hash原件、扫全史、打开数据库长读事务或持有Core门。

### 6.2 试行档位（工程候选，待性能负责人校准）

| 档位 | 候选策略 | 保留/终止 |
| --- | --- | --- |
| 初期只读快照 | 打开页/手动刷新读取现有状态；静态metadata缓存 | 无持续OS采样/图表RAF；这是第一期安全起点，不称性能数据完整 |
| 可见概览 | OS资源候选每5秒一组，共享collector；按需订阅业务事件；呈现最多随新样本/真实事件更新 | 候选15分钟/180组概览＋独立byte上限，先内存ring；上限达到有明确覆盖/丢样计数 |
| 限时详细探查 | 用户主动开启，候选1Hz、最长60秒；只测选中的进程/分区 | 到时/离页自动退回；样本/字节/事件量三重有界；不留下常开调试模式 |
| 页面隐藏/应用后台 | 停图表与高频UI观察；已获准后台的低频本地采集由collector策略明确决定；初期默认停诊断专用高频采集 | 保最后样本、暂停原因与年龄；必要业务独立运行，不把数据补齐/scheduler一起停 |
| 文件扫描/手动导出 | 单作业、有界范围、低优先级，目录或范围改变使旧任务失效；进度来自已知工作量 | 取消只取消诊断作业；原业务文件/事实不清除；已输出部分的去向明确 |

5秒、15分钟、1Hz/60秒是**便于建立上限的待试初值**，不是用户性能承诺或 ARC 通则。byte上限、每样本耗时、总CPU/内存/IO/耗电增量、输入延迟门限仍待探查与项目预算冻结；未确定这些数值前不能声称“低开销已通过”。不因有默认档位就自动启动所有采集。

### 6.3 必须测量面板自身

记录并比较：①面板关闭且诊断采集关；②面板打开仅快照；③可见概览采样；④限时探查；⑤离页后回落。固定候选、实例/数据量、设备、电源/亮度、网络与业务负载，记录测量窗口及工具开销。至少分 collector、IPC/HTTP、聚合、绘图、ring持久化/导出；避免把采样器本身导致的额外活动归因产品业务。

隐藏页面后应能从独立测量确认诊断高频poll/绘图停止；保留状态不要求无限保留DOM或GPU缓冲。样本峰值时聚合/丢样有口径，不形成toast/读屏队列；降低采样不丢关键状态转折。不要以“用了CSS/Canvas/transform”自行证明性能或能源通过。

<a id="energy-evidence"></a>
## 7. 平板掉电：P0 证据请求与阶段判断

当前只把用户反馈记为**真实现场线索，具体根因未知**。电脑USB连接、充电图标、低电量单帧都不能给出净输入功率或应用消耗归因。下列字段交由实际性能探查返回；缺项用 unsupported/permission_denied/未测，不为填满卡片开启侵入式采集。

| 待返回字段 | 最少上下文/单位 | 设计如何使用 |
| --- | --- | --- |
| 候选与宿主 | commit/hash、app/build profile、ABI、OS/WebView版本、设备能力、实例/进程生命周期 | 绑定基线；debug包与release包不可混成同一结论 |
| 用电条件 | 起止SOC与时间、USB/电源类型、充电状态；可得时电流方向/电压/能量计、温度；屏幕亮度/刷新率/亮屏状态 | 计算带窗口的设备净变化；无可用能量计不标mW，不直接标“外心功耗” |
| 业务现场 | 计时状态、当前页/可见性、主/浮窗数量、同步/附件/模型活动、网络/VPN/供电状态 | 对比同任务；保留可能影响项，不从一个开关直接断言因果 |
| 进程与WebView | CPU累计差分/口径、内存方法、线程、GC/响应可得项、各实例归属；固定窗口/n | 区分Host、renderer、同设备其他工作与观测工具成本 |
| 周期活动 | 快照读/Native桥/peer广播或重连/数据库查询/调度wake/模型worker/界面tick的次数与耗时窗口 | 寻找空闲仍工作的真实热点；“频率高”仅为候选，不等于主因 |
| 文件准备阶段 | 源复制、hash、暂存/分块、校验、排队、提交、跨端传输的单调起止/bytes/attempt | 回答“准备慢在哪”；不把约63MB耗时线索混为已测上传吞吐 |
| 观测器增量 | 面板/collector/ADB或其它探查工具开关前后的CPU/内存/IO/唤醒/能源、重复次数、误差 | 冻结面板预算；独立工具自身开销需保留，不把被观测状态当无扰动真值 |

建议证据顺序：先在现场条件记录原始序列，再在独立获准环境中控制单一因素比较；保留前台空闲、明确业务活动、屏幕/后台、USB供电路径的差异。基线必须有有限时窗与足够可解释样本；电量百分比跳变/量化、温度/电池策略、未归属系统消耗都记录。某组件CPU下降不自动证明总掉电改善，某次充入为正也不证明长期能源达标。

设计P0放行条件是：已知空闲活动源和测量范围、明确未归因部分、冻结面板自成本上限、关闭后实际回落、输入/记录/计时未退化。**具体阈值等待性能证据，不在本文凭空给出“低于X%CPU/每小时Y%电量”承诺。** 核心修复可先补必要计数/时间边界，不必等完整仪表盘完成。[R03、S09]

## 8. 本地保留、手动导出与未来遥测

### 8.1 本地保留

默认先用有界内存ring；若加入重启保留，提供明确设备偏好，设置容量/时长/轮转、版本迁移、清除和权限失败行为。不能按无限日期追加到业务EventLog，不能将诊断增长混入原件或业务记录统计。持久化失败保当前会话并说明“未持久保留”，不影响事实提交。

环形窗口分别定义：周期样本、关键事件、限时trace；事件去重键、窗口覆盖、丢样与计数重置可查。重复读取不追加“新成功事件”；摘要不声称全量。保留身份和关联足够定位，排除凭据与默认业务正文。

### 8.2 手动诊断导出（拟议接口，不是现有能力）

用户选择时间窗口/分区/目标实例后，先展示将包含的字段组、范围、缺口、大小估计和目标文件。导出包建议含版本化manifest、能力与字段口径、样本/聚合、相关错误码/操作ID；原始本机路径、地址、实例身份可按用户本机诊断需要选入，默认包范围明确，不能把整个配置/日志对象直接序列化。

**永不包含**：密码、密钥、token/认证头、完整邀请、connection owner descriptor、可恢复凭据的URL或任意错误转储。**默认不包含**：业务记录/反馈正文、附件字节/图像、模型prompt/response、剪贴板、用户档案全文。凭据过滤放在Native/Host DTO生成和导出allowlist两处；UI掩码不是保护边界。[S01]

手动导出只是本机文件操作，不发送给Agent、远端服务器或公开Issue；用户另行选择分享。使用现有Native/平台文件能力的契约方式，保取消、失败、部分输出说明与不覆盖语义；**当前单原件导出可参考其平台行为，但它不等于诊断bundle已经实现**。[R03 B4.3]

建议未来接口职责名为 `capabilities / snapshot / bounded_samples / diagnostic_export`（名称待实现确定），只读查询与显式导出分开。没有批准前不新增HTTP监听、不开放跨设备诊断访问、不自动写远端地址；本机观测权限与业务Agent grant不是同一能力。

### 8.3 未来远端采集的边界

本期只为未来保留版本化口径/有界查询/脱敏导出接缝。若以后增加远端遥测，须另行明确：目的与接收方、可选字段/频率/保留期、同意状态、开启/暂停/撤销、历史已上传数据处理、离线队列及容量、身份关联与传输策略。未开启时零远端上传；撤销后停止新采集/发送相应范围，历史处理结果单独说明。不得从“本机数据可见”推导远端授权。

## 9. 操作、故障与验收

初期主控制限定为读取、范围/窗口选择、暂停观测、限时详细观测、展开和手动导出。固定二值名称“暂停观测”用状态/激活语义表达是否生效；不随状态改名让人猜。领域控制如取消原件获取/模型任务，优先跳回现有对象入口，未来内嵌也必须复用原领域资格/回执，不建立诊断后台旁路。[ARC P07/P09/P10]

| 门 | 操作/注入 | 必须观察到的结果与独立证据 | 当前状态 |
| --- | --- | --- | --- |
| **O0 能源/空闲与自成本 P0** | 同候选下观测关/快照/概览/限时探查/离页对照，含平板USB现场条件 | 原始时序与测量方法，增量/误差、隐藏回落、采样/byte上限、输入/计时/记录无退化；阈值依据明确 | 未测，待性能报告 |
| **O1 状态真实性** | 首样、真实0、无权限、不支持、陈旧、部分、重启；API200但业务未完整 | 卡/趋势/详情同口径；最后确认/未知可辨，缺测不填0，counter reset不画负吞吐 | 未实现/未测 |
| **O2 身份/恢复** | PID复用、runtime/档案切换、迟到采样、乱序/重放、取消后成功、缺父 | 稳定身份；旧回调不串对象，丢样/窗口披露；请求取消与停止确认分开，未决不盲重发 | 未实现/未测 |
| **O3 可理解/定位** | 同终局失败分别注入源读取、校验、授权、projection、提交ACK故障 | 用户能指出最后确认、待处理边界、证据入口和可用下一步；不要求猜UI未提供根因 | 未测；维护者源码自查不能替代用户路径 |
| **O4 输入/呈现等价** | 键盘/鼠标/触摸、长路径/小容器、浅深色、减少动效、IME、返回 | 图形有文本/单位/范围；无hover唯一入口；关闭/返回保对象、筛选、滚动、草稿与焦点 | 未测 |
| **O5 本地数据/导出** | 有界ring轮转、磁盘失败/取消、恶意错误/URL字段、凭据fixture、默认正文排除 | 白名单包可查、范围/缺口真实、凭据零进入、无后台上传、失败不改业务数据 | 未实现/未测；fixture须合成 |
| **O6 基准保真/审美** | 同内容同状态在目标PC/手机/平板观察，分区连续使用 | 暖石/橙色与Alpha组合一致，指标主次清楚、控制就近；图表不以假活动取代事实 | 待人审；没有动机/奖励目标，不额外造积分 |

验收分别记录**状态正确性、可诊断性、输入/无障碍、性能/能源、审美**；一项通过不合成“整体体验已通过”。每份记录含提交/候选hash/宿主、任务与范围、输入/故障、独立来源、实际结果、人审及未覆盖。截图证明几何/层级，时间序列证明变化，OS/Host真值证明状态，分别使用。[ARC C05、feedback-acceptance]

## 10. 分期实施与主代理接入

| 阶段 | 可评审产出 | 开始/放行依据 |
| --- | --- | --- |
| **D0 P0事实与预算** | 性能探查回填第7节；必要计数/阶段时间边界；能源/空闲假设与反例、设备能力和面板预算 | 核心手机时间块/文件传输P0优先；本阶段不靠新UI改变现场。未获得根因就保留未知，不等待完整面板才排障 |
| **D1 最小本地总览** | 设置稳定入口＋PageShell/Alpha recipe；只接已有无凭据状态，手动刷新，清楚显示未测指标 | 数据范围/DTO白名单与身份已审；不导入旧RT，不假装CPU/内存/能源已有值；先取真实宿主画面/操作 |
| **D2 有界资源观测** | 单一collector、OS/WebView能力适配、共享样本/趋势；先一个热点和自成本，再扩类别 | D0预算明确；O0/O1/O2先过；离页停高频、零样本/不支持路径可用 |
| **D3 因果诊断与流水线** | 来源cursor/projection/缺父、附件各阶段span、scheduler/模型/后台状态分区；与已有控制入口接续 | 核心提供可信证据与有界查询；不由UI重扫全史算真值；不以“全绿”掩盖部分来源 |
| **D4 本地保留与导出** | 分窗ring/可选有界持久化、manifest/allowlist、取消/失败/范围预览 | O5合成负例、目标平台文件行为、自成本与保留上限过门；可供人工主动分享，无后台上传 |
| **D5 未来遥测（未授权实施）** | 如用户另行要求，形成目的/选项/撤销/数据范围和远端策略 | 单独授权与审阅；前面完成不自动启动D5 |

视觉实现不需要先全量集齐指标：已有状态就诚实呈现，有缺口就显示能力边界。也不能为了“仪表盘先好看”先造假CPU、假趋势或一圈永远流动的动画。D0必要度量可以随核心P0落地，完整前端排版在核心稳定后推进；本研究仅交设计和映射。

待主代理/性能探查补充：实际设备能力、空闲活动占比/热点、USB供电与能源时序、测量工具成本、构建profile/包体manifest、各阶段时间边界、可接受采样/内存/IO/输入预算。返回后逐项更新第2/4/7节的“已有/待采/未知”和O0状态，不凭探查结论重写Alpha历史验收。

## 11. 源码与资料索引

所有S项盘点基于B；源码链接便于打开，复核固定版本使用 `git show aefa5223:<path>`。后续实现路径可以调整，但需保留同一状态权威和证据边界。

| ID | 来源/符号 | 用途 |
| --- | --- | --- |
| R01 | [Alpha UI/UX参考](../development/alpha-ui-ux-reference.md) | 任务/组件/操作与ARC来源分层；两项P1显隐/图片迁移 |
| R02 | [UI规范](../development/ui-spec.md)、[#807计划](2026-04-02-issue-807-ui-unification-implementation-plan.md) | token/recipe/普通页壳与特殊表面边界 |
| R03 | [Beta进度盘点](2026-11-17-v0.6-beta-progress-audit.md)、[实施记录](2026-11-13-v0.6-beta-execution.md) | 实际版本/设备/原件/黑影/包体证据及失败/未测，不把旧总表当现状 |
| R04 | [Beta功能计划](2026-11-13-v0.6-beta-feature-plan.md) §3–5、Q19、V02/08–12/17–19 | 本机/对端回执、来源/授权/可达、原件、取消恢复和反馈合同 |
| S01 | [beta_native](../../src-tauri/src/beta_native.rs) `RuntimeLocation/beta_runtime_location/beta_status/NativeState::start_listener`；[runtime-location](../../src/beta/runtime-location.ts)；[BetaRuntimeLocation](../../src/beta/BetaRuntimeLocation.tsx) | 本机HTTP/目录/实例的专用无凭据DTO；禁止序列化含owner credential的descriptor |
| S02 | [Host lib](../../crates/exomind-beta-host/src/lib.rs) `HostStatus/HostCapabilities`；[version-build-info](../../src/config/version-build-info.ts)；[BetaSettingsPage](../../src/beta/BetaSettingsPage.tsx) | 当前身份/能力与版本；不是CPU/包体metric接口 |
| S03 | [peers-client](../../src/beta/peers-client.ts) `BetaPeer/BetaPeerStatus`；[BetaPeersPage](../../src/beta/BetaPeersPage.tsx)；[peer network](../../crates/exomind-beta-host/src/peers/network.rs) | 成员/连接/同步分类和Native peer接缝 |
| S04 | [synchronization](../../crates/exomind-beta-host/src/peers/synchronization.rs) `PeerSyncResult/PeerSnapshot`；[sync_store](../../crates/exomind-beta-host/src/peers/sync_store.rs)；[Core projection](../../crates/exomind-core/src/timeblocks/projection.rs) | 内部来源snapshot/cursor/ACK和projection，尚需有界诊断投影 |
| S05 | [timeblocks-types](../../src/beta/timeblocks-types.ts)；[Host timeblocks](../../crates/exomind-beta-host/src/timeblocks.rs)；[timeblocks-controller](../../src/beta/timeblocks-controller.ts) | snapshot/heads/parents/intervals/clock、历史不完整与显示状态边界 |
| S06 | [local_sources](../../crates/exomind-beta-host/src/local_sources.rs) `LocalSourceState`；[original-types](../../src/beta/original-types.ts)；[original-acquisition](../../src/beta/original-acquisition.ts)；[OriginalDownloads](../../src/beta/OriginalDownloads.tsx)；[自动队列](../../crates/exomind-beta-host/src/peers/original_auto_queue.rs) | 本机源/暂存/取件/队列；完整阶段耗时尚待埋点 |
| S07 | [Host timeblocks](../../crates/exomind-beta-host/src/timeblocks.rs) `ServiceStatus/service_status`；[beta_native_deadlines](../../src-tauri/src/beta_native_deadlines.rs)；[deadline-alert-client](../../src/beta/deadline-alert-client.ts) | scheduler/系统提醒权威与资格/请求/实际结果区分 |
| S08 | [summary-types](../../src/beta/summary-types.ts)；[summary-tasks-controller](../../src/beta/summary-tasks-controller.ts)；[summary_jobs](../../crates/exomind-beta-host/src/summary_jobs.rs) | task/run/attempt、取消/重试/owner与服务状态 |
| S09 | `64d170c40eeaba9e3cc629ba330fc525908ce1ae`；[BetaFocusTimer](../../src/beta/BetaFocusTimer.tsx)、[timeblocks-controller](../../src/beta/timeblocks-controller.ts)、[回归源码](../../tests/unit/beta/timeblock-ui.test.tsx) | 背景读不脉冲禁用；UI/采样/真实状态转折分离，不证明能源根因 |
| S10 | [BetaAppShell](../../src/beta/BetaAppShell.tsx)、[AlphaAppShellView](../../src/ui/app/components/AlphaAppShellView.tsx)、[PageShell](../../src/ui/app/components/PageShell.tsx)、[Beta settings registry](../../src/beta/settings-registry.tsx) | 稳定workspace、显隐、导航、设置入口和纯View复用 |

本次轻量交付检查仅涵盖两份Markdown的本地链接/结构、来源定位和空白diff；未进行真实性以外的运行、视觉、性能、能源或用户验收。截图、性能样本、日志、进程现场、会话导出和业务资料不进入提交。
