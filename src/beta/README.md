# 0.6 Beta 维护入口

> 当前实现地图，更新于 2026-11-19。完整候选、设备和能源验收尚未完成。
> 候选身份来自 `src-tauri/tauri.beta.conf.json`，不是本 README 或默认 package 版本。

## 接手先区分三条来源

| 对象 | 入口/身份 | 不能推导的结论 |
|---|---|---|
| 既有日用 0.5 | 已安装软件及不可移动的历史 tag；用户数据独立 | 当前 HEAD 不等于已装版本，不自动升级或导入其档案 |
| 0.6 Alpha05 | 默认 `index.html` → `src/main.tsx`；默认 Tauri config / `.v06` | Alpha 的旧 Runtime/UI 验收不能代替 Beta 新协议 |
| 0.6 Beta | `beta.html` → `src/beta-main.tsx` → `BetaApp`；Beta overlay config / `.v06.beta` | overlay 版本、Core schema、Host API、peer 协议是不同维度 |

默认 `package.json` 仍是 Alpha05，这是隔离构建的有意选择。Beta 构建沿用
[精确候选工作流](../../.github/workflows/beta-build-validation.yml)的版本环境与配置；
自定义构建漏传 `VITE_APP_VERSION` 会显示默认 package 值。不要为统一文字而更改数据身份。

Native 有两个互斥的编译模式。默认 `alpha-legacy-runtime` 保留 Alpha Runtime、旧命令和
身份播种路径；当前默认构建仍可按 Beta identifier 选择 Native Host。需要排除旧 Runtime
时显式使用 `--no-default-features --features custom-protocol,beta-native-only`，并传入
Beta Tauri 配置。Beta-only 在创建业务状态前拒绝非 Beta identifier；同时启用两个模式或
两个都不启用会编译失败。移动全屏、Beta 托盘退出及隔离 WebView 路径仍是共享平台接缝。

例如在已有前端资产的环境下验证 Beta-only：

```text
cargo test -p exomind --no-default-features --features custom-protocol,beta-native-only --lib runtime_config_route_tests
```

此命令还需按本机链路提供 `TAURI_CONFIG`；它不是完整包构建入口。默认模式与 Beta-only
路由测试、默认路径/播种兼容回归，以及两种错误 feature 组合均已验证。依赖图中 Beta-only
不再包含 `exomind-runtime`；Web 资产未随之裁剪。最终包体差异需同源 A/B link-map 探针，
不能由 feature 名或依赖图推断尺寸、功耗或最终候选身份。冻结 Beta18 构建入口保持原样。

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
| 浮窗与共享草稿 | `native_workspace.rs`、`beta_overlay.rs`、`overlay/` | Host `tests/native_workspace.rs`、`main-workspace-client`、`presentation-independence` |
| 原件准备/获取/导出 | `drafts.ts`、Host sources/peers、Native originals/export | 字节/hash、取消/代际、搜索离场、系统打开分别验证 |
| 反馈与快捷键 | `BetaFocusTimer`、`BetaOverlayPage`、共享反馈Dialog | 固定 Ctrl/Cmd+Enter；草稿 ACK 前快速提交；IME 不误发；编辑不冒充提交忙 |
| 设置/外观 | Beta adapter + 共享组件/settings primitives | 先复用展示与语义 token，Alpha/Beta 状态仍隔离 |
| Android 生成物 | 对应 plugin crate + `beta-android-prepare.ts` | 修改维护源，fresh 构建后核最终 APK；真机外观另验 |

上表是找入口，不是自动选出的全量测试清单。CodeGraph 先用于定位；未覆盖或与当前源码冲突时
回查当前装配。调用图索引不是执行/可达性证明。

Android 系统选择器期间的进程回收、导出持久结果及重新选址，另见
[原件导出恢复合同](../../docs/development/beta-original-export-recovery.md)。任务面板只观察；
原件到达、另存为成功和操作回执分别验收。

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
