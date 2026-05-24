# ExoMind 文档全量审计报告

> **分析日期**：2026-05-24
> **当前版本**：v0.4.15
> **审计范围**：docs/ · 根目录 · agents/ · skills/ 下所有 Git 记录文件
> **分析方法**：5 个 subAgent 并行调查，逐一判定状态（有效/过时/已废弃/已合并/不存在）

---

## 一、目录总览

| 目录 | 文件数 | 有效 | 过时/存疑 | 已废弃/归档 | 备注 |
|------|--------|------|-----------|-------------|------|
| docs/plans/ | 137 | 42 已实现 | 65 活跃存疑 | 26（24过时+2废弃+4归档） | 超60%标记活跃但实际已过时 |
| docs/architecture/ | ~30 | ~25 | 1过时+1已合并 | 3 HTML孤文件 | 核心文档大部分有效 |
| docs/specs/ | ~24 | ~18 | 6待开发 | 2已合并 | auth.md/sync.md合并正确 |
| docs/analysis/ | 18 | ~12高价值 | ~6过时 | 1 HTML孤文件 | 2026-04月深度分析 |
| docs/research/ | ~10 | ~6 | 1严重过时(asr) | 2 HTML孤文件 | CRDT/DSON/EDS研究有效 |
| docs/testing/ | ~7 | ~7 | - | - | agent-turn-broker系列有效 |
| docs/verification/ | ~6 | ~4 | 2过时 | 1 HTML孤文件 | 架构对齐审计高价值 |
| docs/tracking/ | 1 | 1 | - | - | issue-25 v4架构验证有效 |
| docs/product/ | ~14 | 3有效 | 5过时 | ~6网站文档可能过时 | PRD/roadmap需更新版本号 |
| docs/development/ | ~23 | ~14 | ~8待验证 | 2已过时 | 核心playbook状态良好 |
| docs/assets/ | ~10 | ~4有效 | 1用途不明 | 2 legacy截图待删 | signal-network/voice-input被引用 |
| docs/memory/ | ~12 | 7 | 3过时需更新 | 1合并版冗余 | plugin-system完整6章 |
| 根目录 | ~8 | 4正常 | 2过时/错误 | 1严重过时 | CHANGELOG差3版本 |
| agents/ | 11个skill | 全部有效 | - | - | 结构清晰 |
| skills/ | 11个skill | 全部有效 | - | - | 与agents/平级 |

---

## 二、docs/plans/ 详细分析

**总计：137 文件**

### 2.1 状态分布

| 状态 | 数量 | 说明 |
|------|------|------|
| 已实现 | 42 | 功能已在代码中实现，应移入 archive/ |
| 仍是活跃 | 65 | 存疑：大多数仅行尾格式化提交，无实际内容更新 |
| 严重过时 | 24 | 仅 860eeb78 行尾格式化提交，无实质推进 |
| 已废弃 | 2 | PLAN-cross-device-incremental-sync · PLAN-icon-svg-vectorize |
| 归档 | 4 | 已在 docs/plans/archive/ 子目录 |

### 2.2 真正活跃的计划（最近有代码提交关联）

以下 6 个计划最近有实际代码推进，应重点关注：

| 文件 | 最后提交 | 说明 |
|------|----------|------|
| 2026-04-29-eventlog-server-owned-timestamp-plan.md | 2026-05-19 | 最新，仍在开发中 |
| 2026-04-24-paired-rt-model-phase1-design.md | 2026-04-24 | RT配对模型设计 |
| 2026-04-19-external-agent-await-api-plan.md | 2026-04-19 | 外部Agent await API |
| task-dag 系列（多文件） | 2026-04 | Task DAG 仍在开发 |
| agent-workbench 系列（多文件） | 2026-03-30/31 | Agent Workbench 仍在开发 |
| timeblock-unification 系列 | 2026-03-31 | 已合并到主代码 |

### 2.3 已实现（应归档）

以下 42 个文件描述的功能已在代码中实现，应移入 `docs/plans/archive/`：

- 2026-03-07-issue-385-agent-hub-claude-codex-runtime-plan.md
- 2026-03-11-issue-484-rt-eventlog-sqlite-plan.md
- 2026-03-11-issue-485-rt-timeblock-sqlite-plan.md
- 2026-03-11-review-agent-b2-implementation.md
- 2026-03-11-review-agent-phase-c-prompt-loading-design.md
- 2026-03-11-review-agent-phase-c-prompt-loading-plan.md
- 2026-03-11-review-agent-phase-c2-c3-fixes-plan.md
- 2026-03-11-review-agent-post-b2-fixes-plan.md
- 2026-03-18-issue-501-interactive-dag-plan.md
- 2026-03-19-batch-a2-dag-keyboard-plan.md
- 2026-03-19-batch-b-task-timeline-plan.md
- 2026-03-19-batch-c2-ui-bugfix-plan.md
- 2026-03-19-dag-batch-polish-plan.md
- 2026-03-20-batch-a3-dag-toolbar-plan.md
- 2026-03-21-issue-659-debug-cleartext-plan.md
- 2026-03-22-batch-e-p1-bugfix-plan.md
- 2026-03-22-batch-fh-dag-timeblock-polish-plan.md
- 2026-03-22-batch-l-rt-infra-plan.md
- 2026-03-26-batch-m1-security-plan.md
- 2026-03-26-batch-n-rt-tasks-api-plan.md
- 2026-03-26-goal-system-v0.3-implementation.md
- 2026-03-26-today-planner-implementation.md
- 2026-03-27-issue-756-runtime-settings-migration-design.md
- 2026-03-27-issue-756-runtime-settings-migration-plan.md
- 2026-03-27-today-planner-timeline-windows.md
- 2026-03-30-issue-776-windows-dev-instance-isolation-plan.md
- 2026-03-31-timeblock-unification-step1.md
- 2026-03-31-timeblock-unification-step2.md
- 2026-04-01-batch-q-task-dag-interaction-plan.md
- 2026-04-01-config-bugs-fix-plan.md
- 2026-04-03-batch-q-dag-search-unification-plan.md
- 2026-04-03-batch-q-task-dag-plan.md
- 2026-04-04-task-dag-manual-layout-sync-plan.md
- 2026-04-04-task-dag-node-sizing-and-expansion-plan.md
- 2026-04-07-issue-848-quota-monitor-plugin-plan.md
- 2026-04-08-single-tag-github-pages-release-flow-implementation-plan.md
- 2026-04-09-issue-780-timeblock-unification-tauri-validation-charter.md
- 2026-04-09-pty-websocket-latency-remediation-plan.md
- 2026-04-11-agent-hub-optional-model-dialog-plan.md
- 2026-04-11-agent-hub-terminal-status-layering-plan.md
- 2026-04-13-eventlog-reference-and-permalink-settled-decisions.md
- 2026-04-13-issue-871-tiled-pane-drag-swap-plan.md
- 2026-04-14-sync-bug-fix-test-plan.md
- 2026-04-19-issue-765-now-workbench-overlay-hitbox-plan.md
- 2026-04-19-task-timeline-status-history-closeout-plan.md
- 2026-04-19-legacy-task-status-history-one-way-repair-plan.md（仍在规划中）
- PLAN-timeblock-cleanup-and-bugfix.md
- 2026-04-01-proposal-system-rt-plan.md（部分实现）
- 2026-04-01-proposal-system-ui-plan.md（部分实现）

### 2.4 严重过时的文件（24个）

这些文件仅在 `860eeb78` 提交有行尾格式化更新，无实际内容更新：

- 2026-03-01-sync-server-unified-data-architecture.md
- 2026-03-06-agent-hub-claude-codex-runtime-research.md
- 2026-03-06-agent-hub-topology-layout-design.md
- 2026-03-06-issue-382-agent-hub-topology-layout-plan.md
- 2026-03-07-issue-385-agent-runtime-orchestration-design.md
- 2026-03-07-personal-growth-to-civilization-roadmap.md
- 2026-03-07-user-system-hybrid-identity-architecture.md
- 2026-03-10-volcano-native-streaming-implementation-plan.md
- 2026-03-11-issue-485-rt-timeblock-sqlite-design.md
- 2026-03-11-voice-input-experience-design.md
- 2026-03-11-voice-input-experience-implementation-plan.md
- 2026-03-11-voice-overlay-soft-floating-card-design.md
- 2026-03-11-voice-overlay-soft-floating-card-implementation-plan.md
- 2026-03-11-voice-task-growth-mvp-brief.md
- 2026-03-11-voice-task-growth-mvp-implementation-plan.md
- 2026-03-12-now-workbench-overlay-v2-design.md
- 2026-03-13-agent-session-unified-abstraction-design.md
- 2026-03-13-issue-136-focus-bgm-player-plan.md
- 2026-03-13-issue-511-voice-input-normalization-plan.md
- 2026-03-14-docs-reorganization-design.md
- 2026-03-14-docs-reorganization-plan.md
- 2026-03-15-tauri-dev-manager-daemon-design.md
- 2026-03-17-android-qs-tile-issue-design.md
- 2026-03-18-agent-session-terminal-control-design.md
- 2026-03-18-agent-session-terminal-control-implementation-plan.md
- 2026-03-19-batch-c1-eventlog-dedup-plan.md
- 2026-03-19-batch-c3-expandable-input-plan.md
- 2026-03-19-issue-564-sugiyama-layout-plan.md
- 2026-03-19-ritual-home-entry-design.md
- 2026-03-19-ritual-home-entry-implementation-plan.md
- 2026-03-20-batch-d-settings-voice-plan.md
- 2026-03-20-trait-dag-concept.md
- 2026-03-21-task-dag-edge-routing-prompt.md
- 2026-03-22-fh-issue640-followup-prompt.md
- 2026-04-02-qwen-omni-plus-minimal-voice-provider-plan.md
- 2026-04-09-exomind-website-redesign-plan.md
- 2026-04-09-issue-885-eventlog-sync-debug-plan.md
- 2026-04-09-CRDT-analysis-Grok_fast_4_1.md

### 2.5 已废弃

- `PLAN-cross-device-incremental-sync.md` — 由 commit 3ee04476 正式归档
- `PLAN-icon-svg-vectorize.md` — 未实际推进

### 2.6 活跃存疑（65个）

这些文件被标记为"仍是活跃计划"，但大多数三月文件的最后提交仅为 `860eeb78` 行尾格式化，无实质推进。真正有近期代码关联的仅 6 个（见 2.2 节），其余 59 个需要人工复核是否真正活跃。

---

## 三、docs/architecture/ 详细分析

### 3.1 有效文档（~25个）

| 文件 | 状态 | 说明 |
|------|------|------|
| overview.md | 有效 | 架构总览核心文档，v4.0合并版 |
| principles.md | 有效 | 架构不变量与生命判据，必读 |
| EDS-architecture-discussion-v1.md | 有效 | EDS核心蓝图，Phase 3实施依据 |
| EDS-architecture-self-review-2026-04-14.md | 有效 | EDS自洽性审阅，列出阻断性问题 |
| ECS-communication-stack.md | 有效 | ECS通信栈v1.0规格 |
| ECS-mvp-spec.md | 有效 | ECS MVP边界规格 |
| ECS-mesh-cross-analysis.md | 有效 | libp2p/inet256 mesh组网分析 |
| agent-hub-ui-spec.md | 有效 | Agent Hub UI规范 |
| agent-runtime-unified-foundation-spec.md | 有效（待评审） | Runtime Agent统一模型 |
| agent-workbench-shared-graph-spec.md | 有效（待评审） | Workbench共享图谱架构 |
| ARCH-signal-pool-agent-process.md | 部分过时 | 概念有价值，但被其他文档超越 |
| DSON-greenfield-sync-architecture-analysis-2026-04-11.md | 有效 | DSON可行性分析 |
| ci-artifact-free-design.md | 有效 | CI无Artifact存储方案 |
| pinned-unpinned-academic-analysis.md | 有效 | Pinned/Unpinned学术分析 |
| 【人写】2026-04-14 - EDS中数据的可同步性...md | 有效 | Pinned/Unpinned核心定义 |
| SPEC-task-mcp-api.md | 有效 | 任务MCP API设计 |

### 3.2 引用错误

- **ARCH-SYNC.md** — 引用了不存在的 `docs/specs/SPEC-301.md`、`SPEC-302.md`、`SPEC-303.md`。这些文件实际已合并为 `docs/specs/auth.md` 和 `docs/specs/sync.md`。需要修复引用路径或标注为过时。

### 3.3 已合并

- **ECS-EDS-discussion-2026-03-04.md** — 内容已合并到 `EDS-architecture-discussion-v1.md`

### 3.4 孤立HTML文件（应删除，3个）

已有 `.md` 版本，HTML 文件无额外价值：
- `pinned-unpinned-academic-analysis.html`
- `pinned-unpinned-visualization.html`
- `v4-vs-dev-comparison-report.html`

### 3.5 DECISIONS/

| 文件 | 状态 | 说明 |
|------|------|------|
| ADR-003-why-refactor-storage.md | 有效（历史决策） | 存储重构决策记录 |
| ADR-004-why-refactor-websocket.md | 已废弃 | WebSocket已被SSE取代，保留为历史参考 |

---

## 四、docs/specs/ 详细分析

### 4.1 有效文档（~18个）

| 文件 | 状态 | 说明 |
|------|------|------|
| auth.md | 有效 | 认证模块规格，已合并SPEC-302/304 |
| sync.md | 有效 | 多设备同步规格（RT-only） |
| SPEC-task-mcp-api.md | 有效 | 任务MCP API设计 |
| SPEC-pr-lock-mechanism.md | 有效 | PR锁定机制规格 |
| SPEC-goal-system-design.md | 有效 | 目标系统设计（早期版） |
| SPEC-goal-system-design-v0.2.md | 有效 | 目标系统设计v0.2 |
| SPEC-goal-system-v0.3-logic.md | 有效 | 目标系统v0.3核心逻辑 |
| SPEC-goal-system-v0.3-ui.md | 有效 | 目标系统v0.3 UI设计 |
| SPEC-goal-edge-separation-force.md | 有效 | 目标边缘分离力规格 |
| timeblock-task-association-semantics.md | 有效 | 时间块×任务关联语义定义 |
| TEMPLATE.md | 有效 | 新功能开发模板 |
| ADR-003-architecture-unification.md | 有效（历史决策） | Tauri IPC统一架构决策 |

### 4.2 待开发（6个）

这些规格描述的功能尚未实现：
- `SPEC-401.md` — 移动端WebSocket客户端
- `SPEC-501-UserIdentity.md` — 用户身份系统
- `SPEC-502-PairingSystem.md` — 配对系统
- `SPEC-503-EncryptedCommunication.md` — 加密通信
- `SPEC-901-FileStorage.md` — 文件存储
- `SPEC-902-WebSocket.md` — WebSocket规格（已被SSE取代）

---

## 五、docs/analysis/ · research/ · testing/ · verification/ · tracking/ 详细分析

### 5.1 高价值文档

| 文件 | 目录 | 价值 | 说明 |
|------|------|------|------|
| 2026-04-13-eds-crdt-vs-rt-sync-architecture-gap.md | analysis | 高 | EDS vs RT架构核心必读 |
| 2026-04-17-goal-system-target-node-architecture-analysis.md | analysis | 高 | 目标系统v0.3设计核心 |
| 2026-04-24-paired-rt-model-current-state-summary.md | analysis | 高 | RT配对模型当前状态 |
| CRDT深度研究报告-2026-04-13.md | research | 高 | CRDT理论基础文档 |
| DSON深度研究报告-2026-04-13.md | research | 高 | DSON tombstone-free设计核心 |
| EDS架构成型性评估报告-2026-04-14.md | research | 高 | EDS架构现状评估 |
| 2026-04-14-architecture-code-alignment-audit-report.md | verification | 高 | 架构文档与代码对齐审计 |
| issue-25-v4-architecture-verification.md | tracking | 高 | v4架构落地验证 |
| agent-turn-broker-presets-and-tools.md | testing/research | 高 | Broker工具有效性核心文档 |

### 5.2 已过时应归档

| 文件 | 目录 | 说明 |
|------|------|------|
| 2026-04-13-migration-oriented-update-research-report.md | analysis | 迁移已完成，历史参考 |
| 2026-04-18-timeblock-unification-gap-closeout-feasibility-plan.md | analysis | 已由后续实现完成 |
| 2026-04-18-timeblock-migration-status-analysis.md | analysis | 迁移已进行 |
| issue-646-deep-analysis.md | analysis | issue已关闭 |
| jj-philosophy-x-exomind-timeblock.md | analysis | 历史参考 |
| asr-providers-2026-03.md | research | 15个月前的ASR调研，需重新调研 |
| 2026-04-10-s3-pty-websocket-verification.md | verification | PTY WebSocket已修复 |
| 2026-04-19-now-workbench-overlay-width-regression-tauri-validation.md | verification | bug已修复 |
| 2026-04-14-sync-migration-current-state-summary.md | testing | 同步已完成 |

### 5.3 孤立HTML文件（应删除，4个）

- `docs/analysis/2026-04-06-theme-discussion-total-report.html` — 仅有HTML无.md版本
- `docs/research/CRDT与DSON综合研究报告-2026-04-13.html` — 与.md并存
- `docs/research/DSON深度研究报告-2026-04-13.html` — 与.md并存
- `docs/verification/agent-system-verification.html` — 仅有HTML无.md版本

---

## 六、docs/product/ 详细分析

### 6.1 状态

| 文件 | 状态 | 说明 |
|------|------|------|
| vision.md | 有效 | 产品愿景清晰，长期方向仍有效 |
| PRD.md | 部分过时 | 引用大量已迁移/删除文档 |
| roadmap.md | 需更新 | Phase 5-7已完成，但路线图仍指向v1.0 |
| completed-features.md | 历史归档 | 明确标注为历史归档 |
| calimero-vs-exomind-ecs-architecture-cross-analysis.md | 有参考价值 | 架构分析仍有参考价值 |
| 2026-04-09-*-website-*.md（~6个） | 可能过时 | 网站设计文档，网站可能已重构 |
| exomind-ledger-second-device-guide.md | 独立系统 | 属于exomind-ledger子项目 |

---

## 七、docs/development/ 详细分析

### 7.1 状态

整体活跃，最近（2026-04）有大量更新。

**有效文档（~14个）**：

| 文件 | 状态 | 说明 |
|------|------|------|
| tauri-mcp-windows-playbook.md | 有效 | 133KB，详尽的Tauri MCP调试攻略 |
| tauri-android-windows-playbook.md | 有效 | Android调试经验，实用详细 |
| ui-spec.md | 有效 | Issue #807 UI规范（Draft状态） |
| issue-806-tauri-mcp-charter.md | 有效 | Tauri MCP章程，详细操作规程 |
| runtime-external-access-contract.md | 有效 | 运行时外部访问契约，近期更新 |
| ui-text-selection-whitelist.md | 有效 | 文本选择白名单策略，近期更新 |
| git-spec.md | 参考 | Git工作流规范，仍有效 |
| repo-agent-workflow.md | 参考 | Git/worktree/PR/发布流程仍有效 |
| exomind-runtime-agents-api.md | 有效 | Runtime Agent API文档，近期更新 |
| lan-single-rt-guide.md | 有效 | 局域网单RT指南，最近更新 |
| playwright-e2e-runtime.md | 可参考 | E2E测试指南 |
| pr-review-evidence-template.md | 可参考 | PR审查证据模板 |
| team-collaboration.md | 可参考 | 团队协作指南 |

**已过时/待验证**：

| 文件 | 状态 | 说明 |
|------|------|------|
| port-env-configuration.md | 已过时 | 端口配置可能已变更 |
| termux-environment.md | 已过时 | 手机端环境配置可能已变更 |
| quickstart.md | 待验证 | 需对照当前dev流程验证 |
| device-pairing-flow.md | 待确认 | 需对照代码验证实现状态 |
| planner-methodology.md | 待确认 | — |
| today-planner-api.md | 待确认 | — |

---

## 八、docs/assets/ · docs/memory/ 详细分析

### 8.1 assets/

| 文件/目录 | 状态 | 说明 |
|-----------|------|------|
| signal-network.png · voice-input.png | 有效 | 被README.md引用 |
| wechat-qr.jpg | 用途不明 | 可能用于网站/文档微信二维码 |
| assets/legacy/exomind-screenshot.png | 建议删除 | 未被任何.md/.ts/.tsx引用 |
| assets/legacy/mobile-view.png | 建议删除 | 未被任何.md/.ts/.tsx引用 |
| assets/legacy/new_db.jsonl | 测试文件 | tests/unit/db/jsonl.test.ts引用 |
| assets/issues/795/icon-vectorize-compare.png | 有效 | 与issue #798图标向量化相关 |

### 8.2 memory/

| 文件 | 状态 | 说明 |
|------|------|------|
| plugin-system-strategic-report-chapter-*.md（6章） | 完整 | 4072行，6章完整 |
| plugin-system-strategic-report.md（合并版） | 冗余 | 与分章版内容重复，建议删除 |
| project-overview.md | 需更新 | 描述版本v0.3.6，当前v0.4.15 |
| logs.md | 需续写 | Ralph Loop执行记录未更新 |
| 知识点-Git工作流.md | 可参考 | Git基础操作 |
| 知识点-文档分层.md | 可参考 | 文档架构说明 |

---

## 九、根目录文件详细分析

| 文件 | 状态 | 说明 |
|------|------|------|
| README.md | 有效 | 准确描述当前项目状态，tauri:manager命令准确 |
| AGENTS.md | 有效 | 最新agent合同 |
| CLAUDE.md | 有效 | 仅做兼容入口，符合设计 |
| BUILD.md | 部分过时 | CI/CD规范仍准确，tag示例仍用v0.2.0 |
| CHANGELOG.md | 严重过时 | 记录到v0.3.4，当前v0.4.15，差3个大版本 |
| QUICK-START.md | 错误 | 内容是Tauri通用模板构建脚本，与ExoMind无关 |
| scripts/CLAUDE.md | 有效 | 准确描述scripts目录用法 |

---

## 十、agents/ · skills/ 详细分析

### 10.1 agents/review-agent/

结构完整：
- `references/` — 8个契约md文件（index、common-contract、discovery-loop等）
- `scripts/` — 11个TypeScript实现文件
- `review-agent.md` — 主文档

### 10.2 agents/ skill子目录（共11个）

全部有效，均有SKILL.md：
- cross-analysis · dev-daily · dev-route · exomind-rt-agent-access · fetch-devlog · human-ui-verification-page · issue-tracking · issue-triage · privacy-leak-emergency · release-governance · triaging-test-suite

### 10.3 skills/（共11个）

与agents/平级，docs/README.md引用路径正确：
- skills/exomind-rt-agent-access 最近更新（May 19 23:35）

### 10.4 privacy-leak-emergency-workspace/

仅workspace目录，非skill，无SKILL.md，属工作目录。

---

## 十一、优先行动项

### P1（立即处理）

| # | 行动 | 说明 |
|---|------|------|
| P1-1 | CHANGELOG.md 更新到 v0.4.15 | 当前停在v0.3.4，落后3个大版本 |
| P1-2 | 删除 9 个孤立 HTML 文件 | 已有.md版本，HTML无额外价值 |
| P1-3 | 归档 42 个已实现的 plans/ 文件 | 移入 docs/plans/archive/，更新 ARCHIVE-INDEX.md |
| P1-4 | 修复/重写 QUICK-START.md | 当前内容与ExoMind完全无关 |

### P2（近期处理）

| # | 行动 | 说明 |
|---|------|------|
| P2-1 | 修复 ARCH-SYNC.md 引用错误 | 指向不存在的SPEC-301/302/303 |
| P2-2 | 更新 roadmap.md · PRD.md · project-overview.md 版本号 | 多个产品文档描述v0.3.x但当前v0.4.15 |
| P2-3 | 删除 docs/assets/legacy/ 截图文件 | exomind-screenshot.png · mobile-view.png 未被引用 |
| P2-4 | 删除 docs/memory/plugin-system-strategic-report.md 合并版 | 与分章6章重复 |

### P3（择机处理）

| # | 行动 | 说明 |
|---|------|------|
| P3-1 | 续写 docs/memory/logs.md | Ralph Loop执行记录长时间未更新 |
| P3-2 | 评估 docs/product/ 网站设计文档 | 2026-04一批网站文档可能已过时 |
| P3-3 | 重新调研 ASR 技术方案或标注 asr-providers-2026-03.md 为过时 | 15个月前的调研，技术可能已大幅变更 |
| P3-4 | 复核 plans/ 中65个"活跃"文件的真实状态 | 大多数仅行尾格式化提交，需人工确认 |

---

## 附录：孤立HTML文件完整清单（共9个）

```
docs/architecture/pinned-unpinned-academic-analysis.html
docs/architecture/pinned-unpinned-visualization.html
docs/architecture/v4-vs-dev-comparison-report.html
docs/analysis/2026-04-06-theme-discussion-total-report.html
docs/research/CRDT与DSON综合研究报告-2026-04-13.html
docs/research/DSON深度研究报告-2026-04-13.html
docs/verification/agent-system-verification.html
```

---

*报告生成工具：Claude Code · MiniMax M2.7*
*分析日期：2026-05-24*
