# 0.6 Beta 维护入口

> 当前实现地图，更新于 2026-11-19。完整候选、设备和能源验收尚未完成。
> 候选身份来自 `src-tauri/tauri.beta.conf.json`，不是本 README 或默认 package 版本。

## 接手先区分三条来源

| 对象 | 入口/身份 | 不能推导的结论 |
|---|---|---|
| 既有日用 0.5 | 已安装软件及不可移动的历史 tag；用户数据独立 | 当前 HEAD 不等于已装版本，不自动升级或导入其档案 |
| 0.6 Alpha05 | 默认 `index.html` → `src/main.tsx`；默认 Tauri config / `.v06` | Alpha 的旧 Runtime/UI 验收不能代替 Beta 新协议 |
| 0.6 Beta | `beta.html` → `src/beta-main.tsx` → `BetaApp`；Beta overlay config / `.v06.beta` | overlay 版本、Core schema、Host API、peer 协议是不同维度 |

### 纯前端内存测试档案

开发态可用 `bun run dev -- --host 127.0.0.1 --port 4300 --strictPort` 启动 Vite，打开
`/beta.html?mock=1` 使用合成档案。该入口动态加载内存 `BetaClient`，不连接 Beta Host、真实档案、Tauri IPC 或 peer 服务；事件、附件、时间块与草稿保留在当前页面实例内，刷新或点“重置测试档案”会重新生成。生产构建会忽略此查询参数。

这个档案用于验证前端行为和状态呈现，不构成 Core、Host、Native、同步、身份验证、系统通知或设备验收证据。`createBetaMockProfile` 可接收 `clientOverrides` 以及 peers、deadline handoff、share handoff 客户端 fixture，供各自 UI 场景隔离测试；基础样本不会伪造网络身份或系统通知。

默认 `package.json` 仍是 Alpha05，这是隔离构建的有意选择。Beta 构建沿用
[精确候选工作流](../../.github/workflows/beta-build-validation.yml)的版本环境与配置；
自定义构建漏传 `VITE_APP_VERSION` 会显示默认 package 值。不要为统一文字而更改数据身份。

Native 有两个互斥的编译模式。默认 `alpha-legacy-runtime` 保留 Alpha Runtime、旧命令和
身份播种路径；通用默认构建仍服务 Alpha，而 Beta 候选工作流显式使用
`--no-default-features --features custom-protocol,beta-native-only` 和 Beta Tauri 配置。
Beta-only 在创建业务状态前拒绝非 Beta identifier；同时启用两个模式或两个都不启用会
编译失败。Beta-only 只将旧 Runtime 从 Beta 产物中排除，不代表可以从仓库删除：
既有 0.5.1 程序和 0.6 Alpha 入口仍依赖该路径。移动全屏、Beta 托盘退出及隔离 WebView
路径仍是共享平台接缝。

例如在已有前端资产的环境下验证 Beta-only：

```text
cargo test -p exomind --no-default-features --features custom-protocol,beta-native-only --lib runtime_config_route_tests
```

此命令还需按本机链路提供 `TAURI_CONFIG`；它不是完整包构建入口。默认模式与 Beta-only
路由测试、默认路径/播种兼容回归，以及两种错误 feature 组合均已验证。依赖图中 Beta-only
不再包含 `exomind-runtime`，但 Tauri 仍使用共享的完整 `dist`，会把 Alpha 与 Beta 多入口
资源一起打包。Beta 验证工作流可在同一源码上选择 Debug 或 Release profile；体积判断应对照
同一源码、同一特性集的产物，不能只根据 feature 名或依赖图推断大小、功耗或设备行为。
冻结 Beta18 构建入口保持原样。

## 当前控制关系

```text
Core：只增事实、事务回执、投影、原件字节及来源证明
  ↑
Host：档案权限、业务命令、peer/复制、原件与模型任务的运行边界
  ↑
Native：可信窗口/系统入口、NativeWorkspace、文件/通知等平台能力
  ↑                         ↑
Main 客户端                 浮窗客户端
```

主窗和浮窗不互相借出控制器。NativeWorkspace 持共享文字/反馈草稿、命令确认与比较更新；
主窗持本窗编辑镜像和观察，不能在卸载时撤销其他客户端的工作区。
Host 的 scoped HTTP 是外部 Agent 能力入口，不能因 Native IPC 存在而删除或复用设备邀请。
Alpha 组件承担呈现，复用视觉资产不意味着继承旧 Runtime 的事实或授权。
详见 [Native 工作区](../../docs/development/beta-native-workspace.md)。

## 按下一项任务找所有者

| 要改的行为 | 主要接缝 | 首要回归/资料 |
|---|---|---|
| 事实、回执、投影与 schema | `crates/exomind-core/` | Core 对应案例与保护性迁移，不以清库恢复 |
| 多端时间块与历史 | Host `peers/`、Core replication | [多来源复制合同](../../docs/development/beta-multiorigin-sync.md)，真实 TLS/来源/ACK/重启案例 |
| 附近未配对设备 | Host `peers/network.rs` 的独立易失候选缓存、Native peers IPC、`BetaPeersPage` | [被动发现边界](../../docs/development/beta-nearby-discovery.md)；候选地址不是身份或访问权限 |
| 回顾原件与外发同意 | Host summary/material/provider、本机 sidecar、手动压缩及任务确认 UI | [选件与本机外发合同](../../docs/development/beta-summary-originals.md)；源码已接通，旧候选不含此能力 |
| 浮窗与共享草稿 | `native_workspace.rs`、`beta_overlay.rs`、`overlay/` | Host `tests/native_workspace.rs`、`main-workspace-client`、`presentation-independence` |
| 原件准备/获取/导出 | `drafts.ts`、Host sources/peers、Native originals/export | 字节/hash、取消/代际、搜索离场、系统打开分别验证 |
| 原件本机释放与跟进 | Host/Core lifecycle、Native lifecycle command、附件卡管理面板 | 释放只作用于本机；其他设备必须显式选择，接收端查看请求后仍由本机 Human 决定是否释放 |
| 反馈与快捷键 | `BetaFocusTimer`、`BetaOverlayPage`、共享反馈Dialog | 固定 Ctrl/Cmd+Enter；草稿 ACK 前快速提交；IME 不误发；编辑不冒充提交忙 |
| 设置/外观 | Beta adapter + 共享组件/settings primitives | 先复用展示与语义 token，Alpha/Beta 状态仍隔离 |
| Android 生成物 | 对应 plugin crate + `beta-android-prepare.ts` | 修改维护源，fresh 构建后核最终 APK；真机外观另验 |

上表是找入口，不是自动选出的全量测试清单。CodeGraph 先用于定位；未覆盖或与当前源码冲突时
回查当前装配。调用图索引不是执行/可达性证明。

Android 系统选择器期间的进程回收、导出持久结果及重新选址，另见
[原件导出恢复合同](../../docs/development/beta-original-export-recovery.md)。任务面板只观察；
原件到达、另存为成功和操作回执分别验收。

档案 `.exomind-profile` 往返、选取记录／时间块导出、跨进程查证和私有暂存归属，见
[用户导出维护入口](../../docs/development/beta-user-exports.md)。两种产物用途不同；
范围导出包不作为完整档案导入，也不把取消 ACK 当作保存完成。

摘要的 `coverage_changed` 是当前来源相对冻结快照发生变化的提示，不会改写旧摘要、
snapshot digest 或 selection，也不会因读取触发模型重跑。冻结后针对已选 capture 的
有效更正，同样会更新这个提示；只匹配同档案、目标 ID 和原 digest。跨设备比较使用
`origin_heads` 中的来源/epoch/sequence，不能用两个数据库的 `local_seq` 相比。Core10
目标索引缩小查询范围。Core11 已按用户决定将冻结前的原文与匹配更正分别放入新回顾
材料，旧摘要保值；匹配索引、候选/正文预算及精确来源读取边界见
[Core11 合同](../../docs/development/beta-core11-history-and-review.md)。外部 Agent summary
和 bundle 的既有证据/排除合同保留，完整历史需分页读取。冻结 Beta19 仍为 Core10，
这些源码能力须随下一匹配候选另做实测。

## 最容易误读的名称

| 名称 | 当前含义/边界 |
|---|---|
| `MainOverlayBridge` | 主窗的 Native 偏好/提交事件客户端，不是浮窗执行器 |
| `ui_owner_generation` | 保留的 TS/Rust wire 名，现在是 Native 绑定代际，不能由主文档重载生成 |
| `events_complete` | 本次目录事实/证明补齐，不代表时间块父节点或原件都齐全 |
| 本机提交 receipt | 固定命令的本机持久结果，不代替复制 ACK 或文件 SHA |
| `source` / `stage` / `original` | 私有可恢复输入 / 待验证暂存 / 已验证原件，不能只存路径并假定字节不变 |
| “恢复旧缓存” | 同 device/profile 的显式 Beta 草稿恢复，不导入 0.5，不因加载失败自动导入旧快照 |

旧 `MainOverlayOwner` 已移至
[历史夹具](../../tests/unit/beta/fixtures/legacy-main-overlay-owner.ts)，只保留拒绝语义测试，
不证明当前 Native 装配。无消费者的旧 250ms Main 转发循环已删除。
`nativeMainOverlayPort` 仅留给历史传输解码测试，生产不注册对应 IPC。
当前 binding 代际和兼容字段仍有真实读写，不进行单边重命名。

## 验证从便宜且相关的层开始

先读 [27项决定](../../docs/plans/2026-11-11-v0.6-approved-decisions.md)，再按实际行为选
单测/真实 Host-TLS/原生接线/精确候选/设备或人审。
[迭代门禁](../../docs/development/beta-iteration-guards.md)只保护一个源码切片；
默认不把旧任务路径白名单套给所有新功能。Windows 重步骤串行，证据和缓存放仓库外。

当前状态：[执行记录](../../docs/plans/2026-11-13-v0.6-beta-execution.md)、
[Beta09以来盘点](../../docs/plans/2026-11-19-beta09-beta14-work-audit.md)、
[Beta14](../../docs/plans/2026-11-18-beta14-attachments-and-field-sync.md)、
[Beta15](../../docs/plans/2026-11-19-beta15-overlay-network-routes.md)。

旧来源缺证明、间歇身份失败、其他黑影、能源归因和完整 Android/EasyTier 矩阵仍未闭合。
早期 B1 README 的 Main-only、peer/model 未实现等说明已失效；历史原文由 Git 保留，
不能据其旧状态重新实现或删除当前能力。
