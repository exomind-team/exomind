# Alpha UI/UX 复用参考：供 Beta 前端持续使用

> 后续应用：本参考的Alpha/Beta固定基线保持不变。2026-11-18新增工作区显隐、图片直接预览、固定反馈快捷键及Web交互验证，该批变化见[前端工作区迭代](../plans/2026-11-18-beta-ui-workspace-iteration.md)。应用版本与已交付范围查[版本状态](../AI-CONTEXT.md)。

> 2026-11-17。研究基线：Alpha05 `99b6b6480e810d6cff8559650387db4adfd45386`（下称 **A**）；Beta 对照 `aefa5223cfc431e88a3ef1f673f67e3c84cca4e1`（下称 **B**）。本文整理现有任务、呈现与操作合同，不批准新的视觉改版，也不表示 Beta 已验收。

Alpha 的价值是已经形成的完整使用组合：暖石主题、导航、消息、输入、计时、反馈和设置。Beta 应沿用其呈现与操作经验，把数据、资格和副作用接到新 Core/Host。复制旧页面的服务初始化，会重新带回已排除的域；只复制颜色，又会丢失成熟工作流。[E01–E04、A01、B01]

## 1. 使用方法与证据等级

后续开发先查 [任务地图](#task-map)，再查 [复用目录](#reuse-catalog) 和 [操作合同](#interaction-contracts)；异步行为按 [状态规则](#state-rules)审查。两个明确 P1 专题见 [图片预览](#image-migration)、[独立显隐](#visibility-migration)。本地运维/性能面板属于新增授权，详见[本地观测 UI 设计](../plans/2026-11-17-beta-observability-ui-design.md)，不能因 Alpha 没有完整面板而拒绝建设。

| 标记 | 含义 | 使用限制 |
| --- | --- | --- |
| **成熟且有验收** | 指定候选、平台和用户路径有既有验收记录 | 不扩大到同组件的全部设置、边角输入或其他候选 |
| **源码存在但未验证** | 固定提交中有实现，并核查调用入口 | 不声称本轮看过运行画面或通过真机操作 |
| **用户确认行为** | 既有记录明确载明用户确认 | 保留版本、设备、场景；与工程检查分别陈述 |
| **新需求或建议** | 本轮/近期用户新增需求，或本文提出的实现建议 | 分清“用户要求”和“工程建议”；不是 Alpha 历史能力 |
| **未知** | 无足够源码接线或设备/人审证据 | 明示缺口，不用常见做法补成事实 |

本文中的 `[Axx]`、`[Bxx]`、`[Exx]` 均可在末尾证据目录查到文件、符号和提交。仓库文件链接便于导航；**证明 Alpha 的内容须用 `git show A:<path>` 回读，不能把链接打开后的 Beta 内容当作 Alpha**。

研究使用了 `arc-ui-design` **0.6.0-alpha.2** 全文，以及设计知识、交互模式、组件系统、宿主验证、状态反馈、反馈验收参考。[E05] 其中 P/C 按原归属使用；K/I 是通用解释与工程方法，SF/G 是有适用范围的试作方法。本文没有把其他项目的字体、网格、材质、采样周期、积分或自由编排编辑器移植成外心规范。

本轮先用仓库 CodeGraph 定位当前入口与调用链；索引未返回若干新抽出的 `AlphaAppShellView`、`ChatMessageRowView`、`NowInputRowView`、Beta 设置/图片 View，随后定点读取未覆盖文件。历史内容全部通过只读 Git 对象核查。没有运行产品、构建、重型测试、访问档案或取得新的视觉通过证据。

### 1.1 基线能证明到哪里

- **成熟且有验收**：Alpha05 Windows 精确候选 **73/73**、相关测试 **148/148**；Android 新装本机记录、重启、系统栏/全屏复验通过。四平台 CI 只证明该提交可构建。[E01]
- **用户确认行为**：Alpha05 当下发送、系统栏避让、Android 全屏；后续 Alpha 手机↔平板局域网消息同步确认。后者不覆盖 Beta 协议、原件、三来源、后台和升级矩阵。[E01]
- **成熟且有验收，历史候选限定**：Alpha04 主窗/浮窗同档案、记录、时间块/反馈、重启；快捷键冲突后同键重试、托盘、录音及受管退出。来源与 Alpha05 分开保存。[E02]
- **未知/待验**：Alpha05 Android 保留数据升级（用户卸载后新装）、全设备网络/后台矩阵、真实模型/ASR。录音通过不等于识别或原声媒体链路全部通过。[E01、E02]
- Beta09/10 的局部通过、用户图片传输确认、平板闪烁修复均是 **Beta 自己的证据**，不能倒填 Alpha，也不能覆盖完整 Beta。[E04]

<a id="task-map"></a>
## 2. 任务、对象与实际入口

| 用户任务/对象 | Alpha05 实际入口和路径 | Beta 接缝及复用判断 | 证据等级/来源 |
| --- | --- | --- | --- |
| 先选本地档案，再记录/计时 | `/eventlog*` → `FocusPage` → `LocalProfileGuard` → `NowPage`；未打开档案时创建/打开 `SwitchAccountSheet`，不挂载记录和计时 | `BetaApp` 的档案选择/`BetaProfileDialog`、device/profile 所有者。复用资格提示和稳定档案入口，不接旧 sync store | **成熟且有验收**：Alpha05 新装主路径；[A01、E01、B01] |
| 当下开始一段时间 | 当下页“专注” → `FocusTimerWidget` 的 idle/config/running；正计时、15/25/45 分钟及自定义倒计时 | `BetaFocusTimer` → 共用 `FocusTimerView`；状态由 `BetaTimeblockController`/Host，View 接 model/actions/bindings | **成熟且有验收**：计时主路径；具体自定义键盘边角为**源码存在但未验证**；[A02、A05、B03、E02] |
| 记录想法、浏览历史 | 当下页“记录” `/eventlog/record` → `ChatPage`（`new-mobile`、隐藏内页头、关闭内嵌 timer）→ 消息列表＋`NowInputRow` | B 的 `ProfileWorkspace` 把计时、搜索、历史、输入组合在同页。消息行/输入外观已共用，独立记录视图及行操作仍缺 | 记录主路径**成熟且有验收**；独立显隐是**新需求或建议**；[A02–A04、B01–B04、E04] |
| 回看时间块与反馈 | 停止 → `markEnding` → 反馈弹层；时间块详情路由 `/eventlog/timeblocks/$blockId` 存在 | Beta typed nodes/intervals、反馈待填/提交与回顾是不同对象；不可恢复旧任务状态表单 | 结束/反馈主路径**成熟且有验收**；详情与完整日周月为**源码存在但未验证/未知**；[A05、A06、B03、B08、E02] |
| “今日” | `/eventlog/today` → `NowTodayTab` → **Today Planner**，读/写计划区间、工作片段与休息窗 | 这不是已验收的日/周/月事实历史。Beta 需要从 typed intervals/timeline 建投影，不把 planner 写操作当历史呈现移入 | **源码存在但未验证**；完整日周月为 Beta 计划/缺口；[A02、A07、B08、E03、E04] |
| 输入、引用和轻量处理 | 记录行 `MessageActions` 复制/链接/引用；引用进入输入，点击引用定位原事件；正文 `EventMarkdown` | `ChatMessageRowView.actions/afterBubble`、`NowInputRowView.beforeControls` 已留插槽；B capture 暂未注入对应行操作/引用合同，正文仍是纯文本 | **源码存在但未验证**：Alpha 接线存在；不能以同名 View 代表已迁完；[A03、A04、A08、B02、B04、E04] |
| 修改偏好 | `/settings` → registry → desktop/mobile layouts → 同一 `SettingsItemRenderer` | `createBetaSettingsRegistry` 注入 Beta get/set/subscribe；模型、系统提醒、位置是受控 custom slot | **源码存在但未验证**：引擎与布局稳定可复用；Beta09 八项便携设置不等于逐项实机验收；[A09、B05、E04] |
| 呼出、隐藏、返回与退出 | 主窗口全局热键、快速聚焦设置；托盘；悬浮工作台展开/小窗/回主窗 | Beta 的 Native 快捷键/overlay bridge 接新所有者。浮窗是独立宿主表面，不是新业务写入者 | Alpha04 主路径**成熟且有验收**；**标题栏 X 是退出**，不是已通过的关闭隐藏；[A10、E02、B06] |
| 设备和网络 | 可选“网络”入口 → `AgentsPage` 的设备视图；`DeviceView` 含本机、设备状态、详情和旧 RT 控制 | Beta“同步”/`BetaPeersPage`；旧设备卡片和分区可抽呈现，发现、授权、可达、记录补齐、原件补齐须分别建模 | 旧 UI **源码存在但未验证**；用户偏好设备网络视觉、潜在设备发现是后续要求，不能原样接旧自动配对/RT 控制；[A11、B07、E03 §3.1] |

**已排除的域不能因 UI 复用而恢复。** Alpha 验收记录已经裁掉任务写入/关联、提案审批、Agent 创建/会话和 PTY 恢复；Beta 明确不建设独立任务/目标/提案/终端会话管理，也不做 0.5 协议兼容。泛型反馈组件仍有 `tasks` 参数、布局分类仍有 `terminal-agent`，不授予这些业务能力。Alpha 源码中可选目标入口、旧文档页面示例或未接线实现，不是 Beta allowlist。[A01、A06、A09、E02 §3、E03 §2/§9]

### 2.1 桌面、手机和平板

| 表面 | 已核实的 Alpha 组织 | Beta 应保持的关系 | 验收边界 |
| --- | --- | --- | --- |
| 宽窗口/桌面 | `useIsDesktop` 默认 768px，且桌面适配开关开启才选桌面壳；侧栏展开/收起，底部档案入口；主内容独立滚动 | `AlphaDesktopShellView/SidebarView` 已共用；宽度改变只移动同一工作区，不重建 sole writer | 768px、侧栏 64/256px 是现有项目参数，非 ARC 通则；原生全局热键/托盘不是“窗口够宽”就具备；[A01、B01] |
| 手机/窄窗口 | 底部导航，内容区与导航安全区；普通内容页用 PageShell；短屏、IME 与系统栏属于宿主问题 | 共用 `AlphaMobileShellView`，结合 Beta compact-editing/viewport；输入时重排不能丢主动作 | Alpha05 原生系统栏/全屏有设备证据；不能借此宣称 Beta 当前所有 IME、减少动效均通过；[E01、E04、B01] |
| 平板/横屏 | 仍按真实宽度＋适配偏好选择壳，不存在独立“平板设计已全验”的结论 | 宽度与输入能力分别判断：可用桌面组织，但保留触摸、软键盘、返回、原生系统栏路径 | 不能把 PC hover、Ctrl、右键作为必要入口；横竖屏切换保同一档案、草稿和阅读上下文；[A01、E01、E05 P02/P07/C05] |

<a id="reuse-catalog"></a>
## 3. 组件、样式与 recipe 复用目录

目录中的“可复用”包含交互职责，不等于整页导入。A 中尚无后来抽出的 `*View` 文件；不能给这些新文件虚构 Alpha05 来源。

| 组合/层 | Alpha 来源（提交 A）与成熟度 | 交互职责 | Beta 现有接缝与复用边界 |
| --- | --- | --- | --- |
| 语义 token/主题 | `src/index.css` 的 root/dark、`tailwind.config.js`；**源码存在但未验证**到全表面 | 文本强弱、表面、边界、激活/危险/成功/分类分工 | 两入口共用 index.css/Tailwind。沿用语义角色，不建第二套“Beta 橙”；换主题覆盖 Dialog/下拉/图表，不改状态含义；[A12、B09] |
| 字体与密度 | `src/App.css::body`、PageShell、ChatPage、FocusTimerWidget；**源码存在但未验证**到精确计算样式 | 标题、正文、元信息、计时数字承担不同扫读职责 | Beta 主入口只显式引 index.css，不能据共用组件推定已引入 Alpha App.css 字体栈。实现时核对实际 computed font/line-height；[A12、B09] |
| PageShell | `PageShell`；源码稳定，**源码存在但未验证**到所有页型 | 页头身份、头部动作/二级导航、内容边界；内容自己决定滚动 | B 当下和设置已用；普通页不再套重复页头。App Shell/Feature Shell/Overlay 分层；不把浮窗或精确 viewport 表面强套普通壳；[A02、A13、B01、E06] |
| Sidebar/底栏 | `routes.tsx::DesktopSidebar/MobileShell`；壳有 Alpha 主路径证据，细节为**源码存在但未验证** | 导航可达、活动状态、侧栏偏好、档案入口、安全区 | `AlphaAppShellView` 接 items/footer/navigation renderer；Beta 仅 now/sync/settings。保持 active 与焦点语义，不能把旧 routes/store 搬进 Beta；[A01、B01] |
| MessageRow | A `ChatPage` 内用户/系统/agent_feedback 分支；**源码存在但未验证**到全部消息类型 | 身份、来源时间、正文、附件、引用与行操作分别归属 | `ChatMessageRowView` 接 tone/avatar/metadata/content/afterBubble/actions。B 人类/Agent/计时/回顾来自 typed record；不能按旧 tag 猜新作者类别；[A03、B02、B04] |
| NowInput | `NowInputRow`；Alpha05 草稿/回执相关回归和发送主路径，边角输入**源码存在但未验证** | 编辑、粘贴、发送资格、焦点、草稿与在途快照；语音/附件能力另注入 | `NowInputRowView` 只呈现；B `BetaDraftController`/Native journal 掌握 device/profile、整组原件、稳定回执。不要导入旧 config/voice service。默认禁用语音是能力边界，不伪装已恢复；[A04、B04、E01] |
| FocusTimer | `FocusTimerWidget` 的 idle/config/running、默认/overlay 表面；主路径**成熟且有验收** | 配置/运行状态、倒计时选择、暂停/继续、停止/待反馈、名称编辑 | `FocusTimerView` 只接 model/actions/bindings/slots；B `name.readOnly=true`、`beginRename` 为空，**改名尚未迁完**。linkedTasks 留空，不恢复 Task service；[A05、B03、E04] |
| FeedbackDialog | `TimeBlockFeedbackDialog`＋`useFeedbackSubmitControls`；流程**成熟且有验收**，快捷键分支为源码证据 | 表单、焦点、关闭、提交/跳过、结果归属；关窗不撤销已结束行动 | 共用 Dialog 已接，Beta controller 持有按 block/revision 的反馈稿；B 快捷键错误跟全局偏好，须恢复专注反馈固定合同。不能复制旧任务 outcome 更新；[A05、A06、B03] |
| Settings schema/registry | `settings-types`、`SETTINGS_REGISTRY/getVisibleSettings`；**源码存在但未验证**到每项 | 条目语义、能力可见性、get/set/subscribe 和验证；registry 不是持久库 | `portable-settings` 只共享文案元数据，Beta registry 注入自有 persistence/Native；不得导入旧整表触发 RT/模型/PTY 设置；[A09、B05] |
| Settings renderer/recipe | `SettingRow/SettingsSection/Divider`、`SettingsItemRenderer` 各 family；**源码存在但未验证**到全部失败时序 | boolean/enum/number/string/action/group 的统一呈现，局部错误与保存结果 | 优先最窄 family；custom 限模型等真正多字段编辑器。异步 setter 返回已应用值；原生应用成功但偏好保存失败须分开提示；[A09、B05] |
| Desktop/Mobile settings | `DesktopSettingsLayout/MobileSettingsLayout`；**源码存在但未验证**到真实触摸全部路径 | 同一条目清单在不同布局分组；空分类不渲染；group 横向 Dialog/纵向 Drawer | B 已共用，不能另写一套 Beta 设置行。桌面上方所谓 tabs 实际滚动到 section，是锚点导航；保留真实语义，不机械换面板 Tabs；[A09、E06] |
| 悬浮工作台 | A `src/pages/NowWorkbenchOverlayPage.tsx` 的 live 分支；Alpha04 PC 主路径**成熟且有验收** | 运行卡、小窗、idle 输入、返回主窗及窗口几何 | `NowWorkbenchOverlayView`＋Beta overlay owner/session。原 View 分支切换会卸载 slot，不能从抽取成功推定草稿/所有者自然安全；[A10、B06、E02] |
| 运行位置/诊断入口 | Alpha 的设置/设备实例详情可参考；完整仪表盘是**新需求或建议** | 日常弱化身份，主动进入后展开位置、能力和原因 | `BetaRuntimeLocation` 已有无凭据位置 DTO；新面板复用 PageShell/设置 recipe 和导航槽，不把运维信息塞满记录区；[B10、E05 P03/P05、观测设计] |

### 3.1 能沿用的具体比例与需要警惕的别名

以下是 **Alpha 项目现状**，用于保真比对，不是跨产品参数标准。[A03、A05、A12、A13]

| 角色 | 固定源码观察 | 后续使用方式 |
| --- | --- | --- |
| 页/侧栏/表面 | page、page-dark、surface、card、sidebar 家族；暖石浅/深背景 | 先解析 token 和 computed 值；Alpha 仍有 shadcn 默认值与局部硬编码混用，不能声称全仓已统一 |
| 主动作与用户气泡 | brand-accent、active；user-bubble 为橙色、浅文字 | `brand` 仍有旧蓝色定义，`primary` 等 Tailwind 同名键还有覆盖；不能把名字相近视为同一语义 |
| 状态/分类 | destructive/success/warning；系统卡、AI 反馈紫色等 | 保留真实分类和状态差异；不把全部指标或消息刷成品牌色 |
| 普通页头 | h1 `text-lg font-semibold`，副文 `text-sm`；px-5/md:px-8/lg:px-10 | 新页先走现有壳与层级，窄屏动作重组而非被挤没 |
| 消息阅读 | 正文 13px/1.6、元信息 11px/1.4、头像 32px；用户最大约84%、系统约85% | 接近的是正文、来源、动作归属；长文件名/连续长串/图片须走真实容器，不用百分比证明不溢出 |
| 输入 | 文本区最小44px，自动增长封顶约96px；图标动作约36px，保留可见输入 | 使用共用 resize helper；这些尺寸不能代替触摸可达性和软键盘实测 |
| 计时 | 主时钟等宽40px；名称20px、overlay18px；辅助信息10–12px | 不因数字位数或状态切换扰动邻近动作。展开内容可变高，不能裁掉反馈/名称 |

<a id="interaction-contracts"></a>
## 4. 操作合同：按实际上下文迁移

| 场景 | Alpha05 真实行为/证据边界 | Beta 指导与应验路径 |
| --- | --- | --- |
| 消息发送偏好 | A `input-send-mode` 默认 Ctrl/Cmd+Enter；Enter 模式纯 Enter 发送，Shift 或 Ctrl/Cmd+Enter 换行；按钮始终有自然点击路径 | B `input-preferences`/composer 已接；各模式分别测空稿、换行、附件在途、连按、中文 IME。只禁重复事务，不锁住下一稿；[A04、B04] |
| **专注反馈快捷键** | A `FocusTimerWidget` 明确 `useFeedbackSubmitControls({submitMode:'ctrl-enter-only'})`；hook 绕过全局发送偏好，先拦 composing，主修饰键 Enter 提交，Alt 不提交 | B `BetaFocusTimer` 调 `shouldSubmitOnEnter(inputSendMode, event)`，提示也跟全局，**有源码可证的迁移差异**。全局改 Enter 后，反馈仍须 Ctrl/Cmd+Enter；单独测按钮、纯 Enter/Shift+Enter 换行、IME、空反馈/跳过；[A05、A06、B03、E04 §5] |
| 空反馈/跳过 | A 空反馈经 `canSubmitFeedback` 进入冷却/再次确认；关闭弹层只改变 open。B 已改成明确“跳过”动作，普通提交要求非空 | 恢复固定快捷键不意味着顺带恢复旧冷却流程。跳过/取消/关闭三者分别验：跳过追加事实，关闭留待反馈，取消不宣称撤销已结束行动；具体等待参数非 ARC 通则；[A06、B03] |
| 计时配置/改名 | A 配置 Ctrl/Cmd+Enter 快速开始；自定义分钟 Enter 应用/Escape 恢复，改名 Enter 保存/Escape 取消且拦 IME | B 配置已接、改名未接。迁移改名须先有 Beta 追加事实合同和竞争资格；不得直接改 View 文本或调用旧 `rename` 服务；[A05、B03、B08] |
| 页面级 Enter/时间块快捷键 | A `ChatPage` 有避开 editable/composing 的全局 Enter/Shift+Enter/Ctrl+Enter 分支；但 NowPage 记录入口 `showTimerWidget=false`，对应 timer ref 不挂载 | 不把这个 listener 或注释当成 Alpha“记录页快捷键控制独立计时已完成”。B 若恢复此路径，显式绑定当前 owner、可见上下文和真实能力，避免在设置/搜索框误触；[A02、A03、E05 P07] |
| 快速聚焦/系统呼出 | A 注册记录输入焦点目标；全局热键与“唤起后快速聚焦”是两层设置。Alpha04 冲突后同键重试有人工证据 | B Native 配置成功后才显示已登记，失败保原键；呼出先恢复正确表面，再聚焦原输入，不发消息、不抢其他档案。新配置/重启组合仍需设备证据；[A09、B01、B05、E02、E04] |
| IME 与输入隔离 | A 反馈/配置/页面级 handler 有 composing 防护；**A NowInputRow 自身 `handleKeyDown` 未显式检查 isComposing** | 不能把全局保护借给局部输入，或声称 Alpha 所有 IME 已通过。B composer/反馈已有检查，后续不回退；真实软键盘与桌面输入法各验，DOM key 事件不足；[A04–A06、B03、B04、E05 I02] |
| 引用/复制/链接 | A `MessageActions` 按复制结果区分成功/失败，引用按钮接 `handleQuoteEvent`，引用摘要点击定位；不是只有图标 | B `actions` slot 尚未接。复用完整命令语义：记录ID＋档案范围＋当前客户端；复制真实文本/稳定链接；引用进当前稿且可撤去，失败不显示“已复制”；[A03、A08、B02、B04] |
| 长按/右键/触摸 | 上述行操作是显式按钮；本次固定入口未找到专用消息长按/右键菜单合同 | **未知**：系统文本选择长按不等于产品菜单。保持触摸/键盘能到行操作，不能把 hover/右键设为唯一入口；新增长按需区分选择、滚动和动作，并标新增；[A08、E05 P03/P07] |
| 搜索与定位 | A `eventlog-route-memory` 有稳定记录链接、定位参数；ChatPage 可回溯分页并高亮目标。未在该固定记录入口找到全文搜索表单 | B 已有全文搜索和 bounded timeline；尚无完整搜索锚点/引用返回。搜索条件、结果范围、目标不存在/不在已载窗口分开；定位后能回原查询和阅读点；[A03、A14、B04、E04] |
| Ctrl+K / 设置搜索 | A NewLayout 的 Ctrl/Cmd+K 是 **developerMode && commandPaletteEnabled** 才启用的命令面板；不是设置搜索 | B 恢复时仅注册允许域命令并给触摸入口；不导入旧任务/终端命令。设置搜索在本次 Alpha/Beta布局未定位，历史版本基准**未知**；[A01、A09、E04] |
| 返回/滚动/选择 | A 在当前 Chat 挂载期间仅跟随已处于尾部的用户，旧页加载保相对位置；但 `ChatPageKeepAliveState` 只存事件窗口，hydrate 明确滚到底 | **不能声称 Alpha tab 往返保精确阅读锚点/文本选区**。B 已保 readingTop/followTail 和单一 portal；新增图片、显隐、诊断详情后还须验稳定事件锚点/selection/focus；[A03、B01、B04] |
| 草稿/回执 | Alpha05 卸载前刷入 debounce 草稿、等待回执不把暂空框当删除、迟到成功只清自己快照；A 默认草稿 key 是 pathname＋placeholder，调用端未显式加 profile | 复用防旧回执思路，保留 Beta device/profile/revision/journal 更强边界，不复制旧 key。失败回填、新稿同文、切档案、刷新/卸载分别验；“失败保草稿”不自动证明在途新稿合并正确；[A04、E01 §3.2、B04] |
| 弹层/关闭/取消 | A FeedbackDialog 用 Radix Dialog；open/onOpenChange 与业务提交分离；设置 group 依据布局用 Dialog/Drawer | B 关闭反馈/预览/诊断详情只结束该视图；已提交事实不回滚；错误保对象附近且可重试。打开、ESC/遮罩/系统返回、失败、成功后的焦点与滚动分别取证；[A06、A09、B03、E05 I03/C05] |
| 标题栏 X/托盘退出 | Alpha04 人工验收 **close-to-exit**，受管 RT 随之停止；明确没有把关闭隐藏记为通过 | Beta 计划要求关闭隐藏、托盘显示/退出，需按新宿主重验；不能把“Alpha 行为一致”用于推翻 Beta 新目标；[E02 §6、E03 V19] |

快捷键精确边角也要忠实：A `runActionOnPrimaryModifierEnter` 没有单独排除 Shift；因此不能从“固定 Ctrl+Enter”擅自推定 Ctrl+Shift+Enter 的所有边角已获人审。迁移至少兑现已明确的主合同，并把组合键边角列入回归，而非静默改变全局发送偏好。[A06]

<a id="state-rules"></a>
## 5. 异步状态与真实反馈

先区分 **领域事实、读请求、写入尝试、组件呈现、设备偏好**。render/tick、读到同一 revision、收到新事实、提交已持久化不是同一事件。P05/P08 约束真实性，P07 约束输入归属，P09/P10 约束可判断和可恢复；SF 方法只用于展开本项目实际多阶段问题。[E05]

| 状态 | 权威与显示规则 | 可执行动作/恢复 | 应验证的反例 |
| --- | --- | --- | --- |
| 首次加载 | 无可用快照才显示首次恢复/读取；无档案先显示创建/打开，不渲染可误提交空壳 | 重试读取/选择档案；保本机草稿 | 首读失败退出 loading，不能“无记录”或永久 spinner；[A01、B03、B04] |
| 后台刷新 | 保留已确认值、实例和布局；只读在途不等于写入互斥 | 同一有效 revision 允许的操作保持可用；真正竞争由 Core expected_revision 拒绝 | 慢读/相同快照反复到达，不把控件周期变灰，不换 combobox DOM；[B03、B11] |
| 正在本机暂存 | journal/源副本确认前称“正在暂存”，不称事实已提交 | 保留编辑器与下一稿；失败有本机暂存重试入口 | 磁盘/权限/缓存失败，不因 UI 值已更新而显示已可靠保存；[B04、B03] |
| 写入中/结果未知 | commandId＋固定 payload/revision＋档案/设备归属；未知与被拒绝分别显示 | 对账原回执；同 ID 重试，不随机换 ID；不能“取消未知事实” | 已提交丢 ACK、旧回执晚到、新稿相同文本、档案切换；[B03、B04、E03 V02/V04] |
| 错误/离线 | 区分本机上下文、授权、网络、存储、协议与缺历史；错误保留到权威成功或用户完成处理 | 给对应入口；本机可保存不依赖对端在线 | 不把未选档案统称检查网络，不以“已连接”称原件完整；[E01 §3.2、E03 §3.1] |
| 陈旧/时钟异常 | 显示最后确认范围、样本时间/年龄、时钟重锚定；保持来源事件原发生时间 | 刷新/恢复；显示时钟不能自行结束业务 | 主题切换、页面重进、25次 render 不产生25个新事件；[B03、B08、E05 P05/P08] |
| 部分缺件/缺父事件 | 记录可读与原件可读、来源链完整与 projection 可解释分别判断 | 按需取件/上线来源/核对同档案；保原资料和草稿 | 文本已到≠时间块历史完整；坏 hash 不提升可用；不清库重建“修复”；[B07、B08、B11、E04] |
| 恢复/历史补齐 | 以相同身份重建投影；旧成功静态恢复，重复事件去重 | 从原上下文继续，旧异步回调不得覆盖新对象 | 重连/卸载/切页后不重复庆祝、不自动打开已关反馈、不盲重发；[B01、B03、E05 SF05/SF07] |

### 5.1 Beta10 必须保留的反例

修复提交 **`64d170c40eeaba9e3cc629ba330fc525908ce1ae`** 前，`BetaFocusTimer` 把 `state.loading` 纳入 disabled；约每秒快照读都会让“追加反馈”、暂停等动作灰一下。修复后 `timeblockControlsBlocked` 只依据缺快照、未决写入、本机缓存错误、真实读取错误等资格；读请求本身不使已确认 revision 失效。`refresh()` 开始时也不再清掉上一错误，避免恢复入口闪灭。[B11]

这不是“以后永不禁用”：首次无真值、写入未决、真实错误仍要限制相应变更，并解释原因。Core 的 revision 校验负责竞争，动画/控件颜色不能替代资格。已有单测覆盖慢读不禁用、读失败禁用、不重建选择器、缺历史保稿并到同步页返回；**本轮仅核查源码/既有记录，没有重跑**。Beta10 物理平板只证明指定周期灰变修复，不关闭其他黑影/IME/手机缺历史问题。[E04、B11]

当前 `BetaFocusTimer` 的约1秒读取、250ms显示 tick，以及 `timeblockClock` 的2秒外推上限是实现参数。采样、时钟投影、视图重绘、真实状态转折要分别计量；它们不是 ARC 的频率标准，也不能据此判断耗电根因。能源/空闲与新诊断面板自身成本按[观测设计](../plans/2026-11-17-beta-observability-ui-design.md)的 P0 门执行。

### 5.2 默认、详情和诊断三种反馈职责

- 自己的发送/复制/反馈：对象附近短确认；成功来自实际结果；连续操作更新同一反馈生命周期，不夺 IME、焦点或撤销归属。[A08、E05 I01/I08/P07]
- 后台补齐、原件队列、模型任务：稳定状态槽与有界聚合；保留失败、取消和阶段转折；不对每个分块/轮询弹 toast。[E03 Q19、E05 SF03/SF05]
- 诊断：主动入口可看本机路径、地址、实例和证据；详细运行信息在新面板组织。凭据不进入显示/导出，业务正文/模型请求不默认并入诊断包。[B10、观测设计]

<a id="image-migration"></a>
## 6. P1 专题一：图片直接/内联预览

### 6.1 已有能力与新增要求

**Alpha05 的附件按钮是待开发反馈**：`handleAttachmentClick` 只显示短暂 pending/“待开发”，没有通用原件接纳流程。`EventMarkdown` 可渲染 Markdown 内容，但它启用 `rehypeRaw` 且没有 Beta 的档案原件/来源校验；这不能证明 Alpha 已有完整图片原件、按需取件或内联预览验收。[A04、A08]

**Beta 已有源码与用户证据**：图片粘贴/传输曾获用户确认；当前草稿缩略图、点击大图已接；已保存消息通过 `OriginalAttachment` 的“预览图片”按钮按需打开，未自动内联。格式、字节/像素上限是当前工程策略，不能改变原件可保存范围。[B12、E04 B4.1/§5]

**用户新需求**是让图片直接帮助识别记录。以下是沿现有组合的迁移建议，不新造视觉语言。

| 迁移对象 | 沿 Alpha 的呈现 | Beta 接缝/状态权威 | 退出、恢复和副作用边界 |
| --- | --- | --- | --- |
| 记录内图片 | `ChatMessageRowView.afterBubble` 的同一消息附件区，保持来源/时间/行操作归属 | `OriginalAttachment` 的 availability/校验结果 → 安全本机 image source → 内联呈现；不依赖正文 URL 猜附件 | 可视范围内有界读取/解码；占位比例只来自可靠尺寸，不推走正在点的动作 |
| 缺件/部分件 | 沿现有文件行保文件名、尺寸、状态及“获取原件” | `originalAcquisition` 区分 missing/partial/complete/hash_mismatch；传输 receiving/verifying/confirming 独立 | 看历史不自动强制下载大图；显式取件；源离线/无授权/释放可辨，不生成假图 |
| 大图 | 复用 `BetaImagePreview` 的 Dialog、原件保留说明、重新预览 | 当前仅 PNG/JPEG/GIF/WebP，16MiB/16Mi像素以内；头部识别后解码。超限、SVG/HTML、未知格式仍走文件能力 | 关闭只清预览观察与临时 URL；不删除原件、不打开系统保存选择器、不执行附件 |
| 本机源与导出 | 原件卡保留下载/导出动作 | `collectOriginalDownload` 核对 hash/长度；导出与预览分别执行 | 缩略图/转码不是原件，导出仍用原始字节/原文件名；预览失败不使已保存原件变成丢失 |
| 资源生命周期 | 同一记录/附件保持实例身份 | identity 至少绑定 device/profile/original/hash；草稿 fileId 与已提交 originalId 分开 | 当前草稿带 device/profile，消息预览 identity 未显式带 device，实施内联缓存前补审 client/设备切换；取消旧读、释放 object URL、有界队列与缓存 |
| 隐私与模型 | 图片只帮助用户识别当前对象 | 本机预览、远端取件、向模型提供材料是三种操作 | 不外链取图、不自动把原件交模型/外部服务、不递归抓引用资源；清缓存不删除事实；低权限/切档案不得复用错误字节 |

当前预览排队已串行，并在关闭/身份改变/卸载时撤销 URL；这些机制可复用，但 **把所有历史项设 `thumbnail=true` 会变成无界读取/解码**。需增加可视范围、总内存/字节预算和失效依据；实际预算由性能探查给出，不自定“移动端足够快”。[B12、E05 I05/P04/P08/C05]

应验路径（P1 实施时取证，本轮未执行）：

1. 本机完整图片在当前记录内可识别，点击进入同一原件大图，返回保查询、滚动、选区和草稿；键盘/触摸均可进入与退出。
2. 仅有元数据、半件、坏 hash、来源离线、撤销授权分别出现正确状态；获取完成后只更新对应附件，不清记录或制造“新消息”。
3. 极端长宽比、长文件名、超限/不支持/解码失败仍能保存/导出原始字节；逐 byte/hash 核对，不以截图代替完整性。
4. 快速切档案/设备、开关大图、上滚长历史和退出页面，旧回调不串图、不泄漏 URL；面板隐藏后不持续解码，已授权 Host 取件与 UI 观察生命周期分离。
5. 不调用 export picker/模型/外部 URL 作为预览副作用；测峰值内存、解码耗时、输入响应和能耗，保留不预览的可用退路。[E03 V04/V09/V17/V18、E05 C05]

<a id="visibility-migration"></a>
## 7. P1 专题二：当下与记录可分离、折叠、隐藏

### 7.1 Alpha 实际提供了什么

- 主窗有“专注/记录/今日”互斥路由；记录页关闭自己的 timer，专注页只挂计时器。它已经把关注对象分开，**不是同页两个区域独立显隐**。[A02]
- 专注配置可收回 idle；桌面侧栏可折叠；悬浮工作台有运行卡/小窗和 idle 展开。它们是各自表面的动作，**不是主窗“当下/记录”独立可隐藏偏好**。[A01、A05、A10]
- 记录 tab 缓存数据窗口，但回挂载滚到底；不能称完整阅读锚点与选区保留。主窗/浮窗共享持久业务不代表共用同一个编辑实例。[A03、E02]

**用户新增要求**：当下与记录能按当前任务分别使用、折叠或隐藏，并有稳定恢复入口。**工程建议**：把功能可见性从档案/编辑/计时所有权中分离；不引入自由拖拽仪表盘或新风格。

| 概念轴 | 建议合同 | Beta 迁移接缝 | 应验路径 |
| --- | --- | --- | --- |
| 对象边界 | 明确“专注/当下工作区”“记录历史”“输入编辑器”各指什么；沿 A 专注与记录组合命名。隐藏历史不自动隐藏输入/停止计时 | B `ProfileWorkspace` 当前固定计时→历史→输入；在共用 recipe 外加可见状态，避免改业务 controller | 分别关每区、只看一类、返回；控件文案能预测改变的对象 |
| 显示、折叠、隐藏 | 显示完整对象；折叠留摘要/展开；隐藏不占内容区域但保稳定入口。动作由可见状态驱动，不改变业务事实 | `BetaAppShell` 导航与 header/action/设置 registry；不复制页面或再建 writer | 折叠运行计时显示同源摘要；隐藏后从导航/设置能恢复，不能把恢复按钮藏在被隐藏区内部 |
| 独立性 | 不以“隐藏计时”顺带清反馈/输入，不以“显示记录”强制展开计时；导航不因另一块隐藏丢失 | 视图状态与 `BetaTimeblockController/BetaDraftController` 分开；条件渲染纯 View 前先保证所有者在上层 | 任意组合切换＋提交在途＋到点提醒；无重复开始/结束/发送 |
| 草稿/阅读/选区 | 维持唯一编辑者和本机 journal；记录保 query、窗口、高水位、锚点/偏移、followTail；编辑光标/IME 在合法时机恢复 | B 已有稳定 portal、readingTop/followTail；不是重写新的 keepAlive cache | 输入半句、选中文本、上滚、开图、去设置/诊断再返回；后台补齐不抢回底部 |
| 时钟/反馈 | 折叠/隐藏只影响呈现成本；Host scheduler/持久事实继续；到点按合同通知，关反馈不取消待填事实 | 复用 `FocusTimerView` 模型与 `MainOverlayBridge`；从 B owner 读，而非新建 React timer 裁决结束 | 全部隐藏、缩窗、屏幕关闭、重开后计时/反馈来源一致；不要借隐藏暂停必要服务 |
| 偏好/可恢复性 | 建议按本设备保存版本化显隐偏好，默认沿已认可组合；不擅自跨设备同步，也不改档案授权 | B preferences/registry 增窄接口；读取失败用明确默认并提示“偏好未保存”，不重置业务 | 重启、损坏/旧版本偏好、关闭适配再开启；布局入口仍可达 |
| 主窗/浮窗/诊断 | 主窗分区显隐、浮窗显示、诊断页进入是不同轴；不能一键隐式联动 | shell 显隐保工作区挂载；诊断离开仅停高频呈现；浮窗 owner/session 保原资格 | 主窗藏记录但浮窗仍能记录；诊断返回复原；恢复入口不会让两个编辑者同时发送 |

“两区都隐藏”时仍须有可达恢复入口；可以复用现有导航/设置/页头动作位置。这里定义任务合同，不预先画未经批准的新界面，也不把某一套按钮排序当作已获人审方案。新增诊断入口不得挤走记录/发送主动作。[E05 P04/P07/P09/P10、B01、观测设计]

## 8. 可持续规则与迁移验收

后续每个变更在评审材料中填写一行即可，不另建平台：**任务/对象 → 状态权威 → 布局/动作 → 退出与恢复 → 应验证证据**。已有实现和建议规则分别给来源。

| 任务/对象 | 状态权威 | 布局/动作 | 退出与恢复 | 应验证证据 |
| --- | --- | --- | --- | --- |
| 可靠记下 | device/profile journal＋Core 回执 | 沿 Alpha input/message recipe，状态贴近本次快照 | 失败留原稿，旧回执不清新稿 | V01/V02/V04；独立回执/原件 hash，真实输入与重启分开 |
| 控制一段时间 | typed projection/revision＋Host clock/scheduler | 沿 FocusTimerView；反馈固定快捷键，动作资格独立于读 loading | 关窗/隐藏不撤销已发生行动，未知先查证 | V10；慢读、竞争、缺父、IME、主/浮窗同源 |
| 阅读与定位 | scoped timeline page/highwater/稳定 eventId | 元数据、正文、附件、引用和操作各归属原行 | 返回保 query/锚点/选择；历史补齐不强滚 | V03/V18；长历史、定位失败、上滚时新事件/图片到达 |
| 改偏好 | Beta config/Native setter，registry 仅声明 | 同一 renderer 多布局，保存/应用结果分开 | 失败保可解释旧值；关闭/取消只作用本轮草稿 | V18/V19；两种布局、平台无能力、保存失败/迟到结果 |
| 取原件 | availability＋来源授权＋hash/byte 校验 | 沿附件行/局部进度/取件与导出分离 | 取消只针对本次任务；部分保留、状态可重读 | V05/V09/V17；断网、坏件、源离线、权限和原始字节 |
| 了解软件运行 | Native/Host/OS分域样本，不读UI自身猜值 | 主动进入本地观测面板，摘要→详情→可执行处理 | 返回原工作上下文；暂停观察不暂停业务 | 观测设计的 O0–O6；含能源/自成本及未知边界 |

### 8.1 常见退化反例

| 退化 | 对应纠正 |
| --- | --- |
| 同色按钮/同名 View 就宣称继承 Alpha | 对照对象、入口、动作、输入路径、取消/恢复与宿主；补缺少的 action/binding |
| 导入旧 `ChatPage/SettingsPage/AgentsPage` 方便复用 | 抽无副作用呈现，Beta 注入能力；禁止旧服务/域启动副作用 |
| 全局 Enter 发送后反馈也改成 Enter 提交 | 反馈使用专用合同，消息发送偏好只作用其授权上下文 |
| 每次轮询全区 loading、禁用、清错误、重挂组件 | 保留快照与实例，只反映真实资格；错误到权威恢复才消退 |
| A 的互斥 tab 被描述成独立显隐且保全部上下文 | 分开历史能力、当前新增需求与实际生命周期实现 |
| 图片缩略图可见就说原件已保存/对端已收到/模型已读 | 三种事实分别用回执、hash、模型材料读取证据证明 |
| 0.5 的任务参数、Ctrl+K命令、设备自动配对一起搬回 | 按 Beta allowlist 接新 owner；外观复用不扩领域或授权 |
| 操作按钮存在就认定窄屏可用 | 连续完成输入→发送→反馈/回看→返回；测真实宽高、软键盘、安全区、焦点 |
| 新诊断页面持续高频重绘以显示“软件活着” | 有界采样、按变化呈现、隐藏停高频；面板开销独立计量，不制造活动 |

### 8.2 后续实施清单（尚未执行）

- [ ] 固定 A/B 源码、候选/hash、平台/安装态；说明哪些继承历史验收、哪些需重新取证。
- [ ] 对照完整消息/输入/导航/设置组合；核计算字体/密度/浅深色及展开弹层，记录允许的几何例外。
- [ ] 消息两种发送偏好＋反馈固定 Ctrl/Cmd+Enter，IME、空反馈、跳过、按钮、移动端自然路径均成立。
- [ ] 复制/引用/链接/定位接到正确档案；失败与受限/未载范围真实，返回保阅读现场。
- [ ] 首次加载、慢刷新、结果未知、错误、陈旧、缺件、缺父、重连逐项区分，保留 Beta10 周期灰变反例。
- [ ] 图片内联有按需取件与资源上限；源离线/校验失败/跨档案/关闭取消不串图或改原件。
- [ ] 当下/记录显隐有稳定恢复入口，草稿/阅读/计时/浮窗/诊断生命周期互不误伤。
- [ ] 桌面、窄窗、手机、平板横竖屏按能力验；未实测平台保留“未测”。
- [ ] 本地观测面板先通过能源/空闲和自成本门，再扩大采集；没有后台遥测上传。见[观测设计](../plans/2026-11-17-beta-observability-ui-design.md)。
- [ ] 单测/类型、宿主输入、可诊断性、审美/可读性、性能/能源分别记录；测试绿不代替人审。[E05 C05/G1–G6]

### 8.3 给主代理的接入次序与待补证据

1. **先完成核心 P0**：手机/三来源时间块、文件传输/恢复。UI 保留“最后确认/缺什么/怎么恢复”，不靠隐藏错误、假零、清库或重建档案绕开。能源/空闲探查也是新增 P0，先取得同条件基线。[E04、观测设计]
2. 固定 Beta 展示 model/owner 接缝和上表能力清单；保留共用 View，先补反馈快捷键等小而明确的合同差异，再恢复消息行操作/定位和计时改名所需新事实接口。
3. **P1 独立显隐先定生命周期，再接呈现**；避免为了新布局丢 single writer/草稿/滚动。图片直接预览在原件可用状态与资源围栏上递进，保持现有文件卡/大图退路。
4. 本地观测面板按独立方案分期，复用设置/导航入口与 token；不把它混成 Alpha 历史成熟能力。P0 度量先于装饰性趋势和全量采集。
5. 最后以精确同版 PC/Android 候选闭合 V18/V19，并补相关 V03/V09/V10/V17；视觉/输入/恢复/能源各有证据再更新本文等级。

仍需人/设备证据：反馈偏好切换＋IME全路径；消息长按/右键是否存在更早已认可版本；设置搜索历史出处；完整日周月/搜索返回；独立显隐后主/浮窗/通知/草稿连续使用；图片大历史内存与掉电影响；Beta 新热键/托盘/关闭隐藏/DPI及移动安全区；平板 USB 供电仍掉电的时间序列与归因。上述缺口不妨碍先形成可评审实现，但不得提前填“通过”。

## 9. 证据目录与维护约定

### 9.1 既有规格、验收与方法来源

| ID | 来源 | 本文实际采用的范围 |
| --- | --- | --- |
| E01 | [Alpha 收尾](../plans/2026-11-13-v0.6-alpha-closeout.md) §3–5 | Alpha05 精确来源、73/148、Android新装/系统栏/全屏、草稿修复、用户确认、未测边界 |
| E02 | [Alpha04交接](../plans/2026-11-12-v0.6-alpha04-handoff-for-gpt.md)、[验收记录](../plans/2026-11-12-v0.6-alpha04-acceptance-evidence.md) §3/§6–9 | 历史PC候选、主/浮窗/录音/退出/热键、36/68与裁剪；未继承历史执行指令 |
| E03 | [Beta 功能计划](../plans/2026-11-13-v0.6-beta-feature-plan.md) §2–5、B4、V03/09/10/17–19 | Alpha组合复用、设备上的档案、原件/回执、独立排除域、恢复和验收合同 |
| E04 | [Beta 全项盘点](../plans/2026-11-17-v0.6-beta-progress-audit.md) §2–7 | Beta09/10实际差异、反馈固定快捷键要求、图片/搜索/显隐缺口；不是整体通过 |
| E05 | 用户指定 `arc-ui-design`，版本0.6.0-alpha.2；`SKILL.md` P01–P10；`references/design-knowledge.md` K01–K11、`interaction-patterns.md` I01–I15、`component-systems.md` C01–C03、`host-and-validation.md` C04/C05、`state-feedback-systems.md` SF02–07/SF10、`feedback-acceptance.md` G/T | 按原归属区分个人原则、通用方法、试作参考；本轮只消费，不改 skill。安装路径非项目运行依赖 |
| E06 | [UI规范](ui-spec.md) §3/§6–13、[#807实施计划](../plans/2026-04-02-issue-807-ui-unification-implementation-plan.md) §0–3 | 普通/特殊表面、token、Tab/模式/锚点区分；文档自身仍标 Draft，不把所有旧示例域加入Beta |
| E07 | [产品愿景](../product/vision.md)、[架构原则](../architecture/principles.md)、[AI索引](../AI-CONTEXT.md) | 工程协作身份；动作留痕、过程与环境裁决；索引不替代精确候选证据 |

### 9.2 Alpha05 固定源码（统一提交 A）

| ID | 文件/符号 | 复核要点 |
| --- | --- | --- |
| A01 | [routes.tsx](../../src/routes.tsx) `NewLayout/MobileShell/DesktopSidebar`；[FocusPage](../../src/ui/app/pages/FocusPage.tsx)；[LocalProfileGuard](../../src/ui/app/components/LocalProfileGuard.tsx) | 真实路由、能力门、无档案guard；不是直接挂 NowPage |
| A02 | [NowPage](../../src/ui/app/pages/NowPage.tsx) `NowPage/NowViewBar` | focus/record/today互斥；record关内嵌timer；recordKeepAliveRef |
| A03 | [ChatPage](../../src/components/Chat/ChatPage.tsx) `ChatPageKeepAliveState/hydrateFromKeepAliveState/refreshLatestEvents/ensureEventInMemory/handleQuoteEvent` | 分页/刷新/引用/定位；hydrate到底；实际 JSX行与传入操作 |
| A04 | [NowInputRow](../../src/ui/app/components/NowInputRow.tsx) `submitInput/handleKeyDown/handleAttachmentClick/buildAutoDraftStorageKey`；[input-send-mode](../../src/config/input-send-mode.ts) | 发送/草稿快照、IME未显式拦截、附件占位；双发送模式 |
| A05 | [FocusTimerWidget](../../src/ui/app/components/FocusTimerWidget.tsx) `useFeedbackSubmitControls/handleOpenEndDialog/handleSubmitRunningName/handleCollapseToIdle` | 固定反馈模式；运行/配置/改名/markEnding与呈现 |
| A06 | [TimeBlockFeedbackDialog](../../src/ui/app/components/TimeBlockFeedbackDialog.tsx)；[useFeedbackSubmitControls](../../src/ui/app/components/useFeedbackSubmitControls.ts)；[dialog-submit-shortcuts](../../src/ui/app/components/dialog-submit-shortcuts.ts) | 组件不裁决发送模式；controller选择ctrl-enter-only；空反馈/关闭/IME |
| A07 | [NowTodayTab](../../src/ui/app/components/NowTodayTab.tsx)、[NowTodayPlannerTimeline](../../src/ui/app/components/NowTodayPlannerTimeline.tsx)；[TimeBlockDetailPage](../../src/ui/app/pages/TimeBlockDetailPage.tsx) | Today Planner不是完整日周月；详情的返回“当下”与空task映射 |
| A08 | [MessageActions](../../src/components/Chat/MessageActions.tsx)；[EventMarkdown](../../src/components/Chat/EventMarkdown.tsx) | 显式行按钮及clipboard结果；Markdown raw配置不等于安全原件预览 |
| A09 | [SettingsPage](../../src/ui/app/pages/SettingsPage.tsx)、[settings-registry](../../src/ui/app/config/settings/settings-registry.ts)、[settings-types](../../src/ui/app/config/settings/settings-types.ts)、[renderers](../../src/ui/app/components/settings/settings-renderers.tsx)、[settings-shared](../../src/ui/app/components/settings-shared.tsx)、[Desktop](../../src/ui/app/layouts/DesktopSettingsLayout.tsx)/[Mobile](../../src/ui/app/layouts/MobileSettingsLayout.tsx) | get/set/subscribe、family与布局；锚点而非面板tab；旧整表不能直接导入 |
| A10 | [NowWorkbenchOverlayPage](../../src/pages/NowWorkbenchOverlayPage.tsx) `NowWorkbenchOverlayPageContent` live branches | 区分static preview、idle输入、运行小窗、FocusTimerWidget surface |
| A11 | [DeviceView](../../src/ui/app/pages/agents/DeviceView.tsx) `DeviceView` | 本机/设备分区和来源信息；旧启动、网络模式、自动配对是不同业务合同 |
| A12 | [index.css](../../src/index.css)、[tailwind.config.js](../../tailwind.config.js)、[App.css](../../src/App.css) | 主题/token与字体来源；同名别名和局部例外 |
| A13 | [PageShell](../../src/ui/app/components/PageShell.tsx)、[useIsDesktop](../../src/ui/app/hooks/useIsDesktop.ts) | header/content slots与768px判定 |
| A14 | [eventlog-route-memory](../../src/ui/app/pages/eventlog-route-memory.ts) `EVENTLOG_TAB_PATHS/buildEventlogRecordLocatePath` | lastTab仅session；记录permalink/locate合同 |

### 9.3 Beta 接缝（统一提交 B，B11 另固定修复提交）

| ID | 文件/符号 | 复核要点 |
| --- | --- | --- |
| B01 | [BetaAppShell](../../src/beta/BetaAppShell.tsx)、[AlphaAppShellView](../../src/ui/app/components/AlphaAppShellView.tsx)、[BetaApp](../../src/beta/BetaApp.tsx) `ConnectedBeta/DeviceWorkspace` | now/sync/settings；portal保唯一writer，隐藏与卸载分离 |
| B02 | [ChatMessageRowView](../../src/ui/app/components/ChatMessageRowView.tsx) | 无旧event store/router，actions/afterBubble插槽 |
| B03 | [BetaFocusTimer](../../src/beta/BetaFocusTimer.tsx)、[FocusTimerView](../../src/ui/app/components/FocusTimerView.tsx)、[timeblocks-controller](../../src/beta/timeblocks-controller.ts) | 共享呈现；readOnly改名缺口；反馈仍跟发送偏好；权威快照/回执/时钟 |
| B04 | [BetaApp](../../src/beta/BetaApp.tsx) `ProfileWorkspace`、[NowInputRowView](../../src/ui/app/components/NowInputRowView.tsx)、[drafts](../../src/beta/drafts.ts)、[input-preferences](../../src/beta/input-preferences.ts) | capture纯文本/无行操作；readingTop/followTail；本机草稿/整组原件资格 |
| B05 | [BetaSettingsPage](../../src/beta/BetaSettingsPage.tsx)、[Beta registry](../../src/beta/settings-registry.tsx)、[portable-settings](../../src/ui/app/config/settings/portable-settings.ts)、[preferences](../../src/beta/preferences.ts) | 共用引擎和元数据，自有持久化/Native setter；不导旧整表 |
| B06 | [NowWorkbenchOverlayView](../../src/ui/app/components/NowWorkbenchOverlayView.tsx)、[MainOverlayBridge](../../src/beta/overlay/MainOverlayBridge.tsx)、[main-owner](https://github.com/exomind-team/exomind/blob/b6ee76a9fefd01141880bc41b31570e31765caf5/src/beta/overlay/main-owner.ts) | live呈现、owner/session、分支生命周期 |
| B07 | [BetaPeersPage](../../src/beta/BetaPeersPage.tsx)、[peers-client](../../src/beta/peers-client.ts) | 授权/连接/事件/原件状态，不等同潜在设备发现 |
| B08 | [timeblocks-types](../../src/beta/timeblocks-types.ts)、[timeblocks-controller](../../src/beta/timeblocks-controller.ts) | typed action不含rename，nodes/intervals/snapshot、expected_revision |
| B09 | [beta-main](../../src/beta-main.tsx)、[beta.html](../../beta.html) | 独立入口；index.css/系统栏恢复；字体是否等价需宿主核对 |
| B10 | [BetaRuntimeLocation](../../src/beta/BetaRuntimeLocation.tsx)、[runtime-location](../../src/beta/runtime-location.ts)、[beta_native](../../src-tauri/src/beta_native.rs) `RuntimeLocation/beta_runtime_location` | 不含凭据的本机HTTP/目录/实例详情 |
| B11 | `64d170c40eeaba9e3cc629ba330fc525908ce1ae`；[timeblocks-controller](../../src/beta/timeblocks-controller.ts) `timeblockControlsBlocked/refresh`、[timeblock-ui测试](../../tests/unit/beta/timeblock-ui.test.tsx)、[timeblock-controller测试](../../tests/unit/beta/timeblock-controller.test.ts) | 只读loading不禁用，真实错误仍限制；恢复入口保留。设备证据见E04及[实施记录](../plans/2026-11-13-v0.6-beta-execution.md) |
| B12 | [BetaImagePreview](../../src/beta/BetaImagePreview.tsx)、[OriginalDownloads](../../src/beta/OriginalDownloads.tsx)、[original-acquisition](../../src/beta/original-acquisition.ts)、[original-download](../../src/beta/original-download.ts) | 本机按需预览、取件/导出分离、身份/URL/校验与资源围栏 |

更新本文时只提升有新证据支持的行：记录目标提交、候选/hash、平台/容器、入口、实际输入、独立真值、返回/故障结果、人审及未覆盖项。源码存在→工程通过→设备通过→用户确认不是自动晋级链；需求改变也不能抹掉历史失败。截图、缓存、附件原件和会话导出留仓库外。
