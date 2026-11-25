# ExoMind 文档导航

第一次接手 0.6，先选要运行的程序，再沿一次用户动作找实现和测试。产品阶段、候选提交和制品核验记录集中在[版本状态](AI-CONTEXT.md)。

## 五分钟找到入口

| 我要做什么 | 从这里开始 |
|---|---|
| 用外心保存第一条图文，在另一台设备读回 | [首次使用 Beta](product/beta-first-session.md) |
| 运行 Beta 前端，使用可重置的合成档案 | [开发快速上手](development/quickstart.md) |
| 运行真实 Beta Host，写入独立测试档案 | [Beta Host 使用说明](../crates/exomind-beta-host/README.md) |
| 取得或核对原生候选、处理平台安装问题 | [构建指南](../BUILD.md) · [macOS 安装与核验](macos-install.md) |
| 理解一次记录为何能跨端接力 | [架构与术语](architecture/README.md) · [多来源复制合同](development/beta-multiorigin-sync.md) |
| 选择接下来应做的工作 | [迭代与待审计划](plans/README.md) |
| 了解为什么做外心 | [产品愿景](product/vision.md) · [架构原则](architecture/principles.md) |

## 按用户任务维护

| 用户动作 | 当前 0.6 Beta 的维护资料 |
|---|---|
| 记录、搜索、引用、更正和标签 | [Beta 前端维护入口](../src/beta/README.md) · [引用与定位](development/beta-message-references.md) · [记录组织](development/beta-record-organization.md) · [范围历史与回顾](development/beta-core11-history-and-review.md) |
| 主窗口与浮窗接续、切换档案 | [Native 工作区与草稿](development/beta-native-workspace.md) · [档案切换就绪条件](development/beta-profile-switch-readiness.md) |
| 找到设备、加入档案、换网络后补齐 | [发现](development/beta-nearby-discovery.md) · [返拨路径](development/beta-peer-return-routes.md) · [事件、投影与原件完整度](development/beta-multiorigin-sync.md) |
| 读取、取回、打开或释放附件 | [媒体预览](development/beta-media-preview.md) · [原件状态与诊断](development/beta-original-diagnostics.md) · [原件生命周期](development/beta-original-lifecycle.md) · [系统文件交付的恢复](development/beta-original-export-recovery.md) |
| 备份一个档案、导出选中的内容 | [用户导出入口](development/beta-user-exports.md) · [档案往返格式和接纳规则](development/beta-profile-archives.md) |
| 接入外部 Agent 或理解模型读取范围 | [Agent Skills 与安装源](development/agent-skills.md) · [档案授权](development/beta-agent-grants.md) · [只读等待与 bundle](development/beta-agent-read-tools.md) · [选件与模型外发同意](development/beta-summary-originals.md) |
| 修改界面或查运行故障 | [前端设计规范](development/ui-spec.md) · [Beta UI 用户需求](development/beta-ui-user-requirements.md) · [本机运行诊断](development/beta-local-diagnostics.md) · [Windows Tauri 排障](development/tauri-mcp-windows-playbook.md) |
| 开发、测试、审阅、交付 | [仓库执行规则](../AGENTS.md) · [Beta 回归门禁](development/beta-iteration-guards.md) · [Termux](development/termux-environment.md) · [Git](development/git-spec.md) · [Repo 工作流](development/repo-agent-workflow.md) |

## 专题与历史

- 架构的长期约束、旧 Runtime 和 EDS 研究各有自己的索引。产品 PRD 和早期路线图记录长期方向。按候选查询实现与验收，请从版本状态和日期记录进入。[架构索引](architecture/README.md) · [产品文档](product/) · [方案与验收记录](plans/README.md)
- 研究、专项测试和项目交接材料保留其来源版本与运行条件。用户侧人格契约、仓库审核程序分别有维护入口。[研究](research/) · [测试记录](testing/) · [验证记录](verification/) · [用户侧 Agent 契约](agents/README.md) · [审核 Agent](../agents/review-agent/references/index.md)
- 旧模块规格、分析、历史项目记忆和已移动文档用于追查原设计。已有归档保留原始标题或提交线索。[规格索引](specs/README.md) · [分析](analysis/) · [项目笔记](memory/README.md) · [归档索引](ARCHIVE-INDEX.md)
- 供应商资料按接口版本查阅，Beta 内部回顾读取范围见上方任务表。[Omni Runtime 资料](Omni-runtime-qwen3.5-api.md) · [Qwen Omni API 资料](qwen3.5-omni-api.md)
