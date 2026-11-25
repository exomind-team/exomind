# ExoMind 0.6 · 版本与维护入口

核对日期 2026-11-25。本页回答三个问题：应该运行哪条产品线、哪个候选包含这项改动、该从哪里验证。首次开发从[快速上手](development/quickstart.md)进入；按功能查资料使用[文档导航](README.md)。

## 当前阶段

`dev-0.6` 的日用反馈基线是 **β26**，开发线程已获准推进 **β27** 的紧要日用功能。**β28** 的架构与代码简化处于提案阶段，未来的 β28 Agent 负责按实际基线复核后提请用户审阅。产品优先级、32 条批注及验收条件由[批注后迭代计划](plans/2026-11-25-beta-iteration-after-user-review.md)维护。

| 核对对象 | 可复查的版本 | 证据能回答的问题 |
|---|---|---|
| β26 日用基线 | `0.6.0-beta26`，应用源码 `87d510bc`，构建请求 `7438a0ae`，Android versionCode `6026` | 四平台构建和该批次交付记录。[构建 #27](https://github.com/exomind-team/exomind/actions/runs/45320820956) · [冻结基线](plans/2026-11-24-beta27-feedback-investigation.md#β26-冻结基线) |
| β27 首个焦点修复 | 应用源码 `f0ab0fbf`，构建请求 `7cfa90f8` | 四平台构建，Windows EXE 已按该批次的来源、build-info 和 SHA-256 核验交付。[构建 #28](https://github.com/exomind-team/exomind/actions/runs/45537104031) |
| β27 键盘更新候选 | `0.6.0-beta27`，应用源码 `5e704ec8`，构建请求 `ac682eab`，Android versionCode `6027` | Windows x64、macOS arm64、Linux x64、Android 构建均成功。同一构建请求的源码 CI #101 失败，后续 `4a241ceb` 的 #102 通过。设备验收按实际制品记录。[构建 #29](https://github.com/exomind-team/exomind/actions/runs/45548377937) · [源码 CI #101](https://github.com/exomind-team/exomind/actions/runs/45548377895) · [#102](https://github.com/exomind-team/exomind/actions/runs/45553925101) |
| β27 后续源码 | `e5c61220` 支持读取剪贴板期间预发送，`dfb2b73c` 接入从事件附件分享已校验原件 | 两项改动分别通过源码 CI #103 和 #104。以上改动均晚于构建 #29 所选源码。系统分享、剪贴板和软键盘／IME 的设备结果按制品核对。[源码 CI #103](https://github.com/exomind-team/exomind/actions/runs/45588938602) · [源码 CI #104](https://github.com/exomind-team/exomind/actions/runs/45596484811) · [分层验收](development/beta-iteration-guards.md) |

源码版本看 [Beta 配置](../src-tauri/tauri.beta.conf.json)，请求打包的应用提交看[构建锁](../.github/beta-build-candidate.json)，已构建的包以对应 run 的产物及 build-info 为准。日用验收看具体设备、操作和回读。公开分发单独查 [GitHub Releases](https://github.com/exomind-team/exomind/releases)：在上述核对日，Latest 标记为 `v0.4.23`，`v0.5.1` 标记为 prerelease，β27 通过 Actions 分发验证制品。跨批次更新时应同时核对这四类证据。

## 选择运行入口

| 要做的事 | 入口与数据范围 |
|---|---|
| 纯前端验证 0.6 Beta | 在开发用 Vite 打开 `/beta.html?mock=1`。页面使用合成内存档案，刷新后重建。参见[快速上手](development/quickstart.md)与[前端维护入口](../src/beta/README.md)。 |
| 验证真实提交、档案或 peer | `crates/exomind-core` 持有 SQLite 事实和事务回执。`crates/exomind-beta-host` 检查档案资格并运行服务。测试使用新建独立根。[Host 启动](../crates/exomind-beta-host/README.md) · [Core](../crates/exomind-core/README.md) |
| 验证 Windows 或移动端能力 | Beta Native 用独立配置、`beta-native-only` feature 与 `beta.html`。平台文件、通知、窗口和草稿仲裁从 Native 入口追踪。[构建说明](../BUILD.md) · [Native 工作区](development/beta-native-workspace.md) |
| 接入外部 Agent | `exomind-beta/1` 使用同档案授权。运行地址、授权资格、读取覆盖和写入回执分别验证。[公共 Skill](development/agent-skills.md) · [授权](development/beta-agent-grants.md) |
| 维护既有产品或参考实现 | 根包默认入口 `index.html` 和默认 Tauri feature 对应 Alpha05／旧 Runtime。`crates/exomind-cli` 指向旧 Runtime。`next/` 是独立迁移候选。按所选产品使用对应的根目录和协议。[旧架构](architecture/overview.md) · [迁移候选](../next/README.md) |

## 关键目录

| 责任 | 实现与维护合同 |
|---|---|
| 主窗口、浮窗、时间线和输入 | [`src/beta`](../src/beta/README.md) → [`src/beta-main.tsx`](../src/beta-main.tsx) → Native IPC 或 Beta HTTP；[原件、输入及宿主要求](development/beta-ui-user-requirements.md) |
| Core、Host、Native | [当前架构导览](architecture/README.md)及[首组提交合同](development/v0.6-beta-core-contract.md)。追踪一条记录可从 Host 的 `capture` 到 Core 的 `submit`。 |
| 设备发现与复制 | [发现边界](development/beta-nearby-discovery.md)、[多来源复制](development/beta-multiorigin-sync.md)、[连接持久层](plans/2026-11-22-beta26-b1a-connection-store.md)。成员资格、事件、时间块投影、原件字节分别查证。 |
| 维护与作业规则 | [源码 Agent 合同](../AGENTS.md)、[产品愿景](product/vision.md)、[架构原则](architecture/principles.md)、[Git 与发布](development/repo-agent-workflow.md)。 |
| 规划与历史 | [计划索引](plans/README.md)列出执行入口、待审提案和历史候选证据；[档案索引](ARCHIVE-INDEX.md)保留文档搬迁记录。 |
