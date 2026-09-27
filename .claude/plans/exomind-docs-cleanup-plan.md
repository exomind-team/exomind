# ExoMind 文档清理执行计划

> 基于 2026-05-24 文档审计报告 + super-questioning 5 轮认知对齐
> 项目状态：搬迁式重构前夜（issue #906），旧骨架即将废弃

## 上下文

- ExoMind 处于**搬迁式重构**前夜——旧架构将被 EDS/RT/ECS 新骨架取代
- 文档整理不是"维护旧文档"而是**归档式清理**：基于最新架构认知，将过时内容归档处理，归档后只维护最新工作上下文
- 目标优先级：**理解 > 试一下 > 活项目**——这次先做到"让陌生人能看懂这是什么"
- 时间预算：一次性半天

## P1：立即执行

### P1-1：CHANGELOG.md 更新到 v0.4.15

- 当前停在 v0.3.4，落后 3 个大版本
- 需从 git log 提取 v0.3.5 ~ v0.4.15 的 release 要点
- 文件：`CHANGELOG.md`
- commit 风格参考已有 entry，保持格式一致

### P1-2：删除 9 个孤立 HTML 文件

清单（审计报告附录）：
- `docs/architecture/pinned-unpinned-academic-analysis.html`
- `docs/architecture/pinned-unpinned-visualization.html`
- `docs/architecture/v4-vs-dev-comparison-report.html`
- `docs/analysis/2026-04-06-theme-discussion-total-report.html`
- `docs/research/CRDT与DSON综合研究报告-2026-04-13.html`
- `docs/research/DSON深度研究报告-2026-04-13.html`
- `docs/verification/agent-system-verification.html`

注意：`docs/analysis/` 和 `docs/research/` 及 `docs/verification/` 中各有 1-2 个仅有 HTML 无 .md 版本的（`*-total-report.html`、`agent-system-verification.html`）——删除前先确认是否有 .md 版本或是否有未迁移的内容。

### P1-3：归档 42 个已实现 plans 文件

- 移入 `docs/plans/archive/`
- 创建 `docs/plans/archive/ARCHIVE-INDEX.md`，列出每个已归档文件及对应实现状态
- 方法：按审计报告 2.3 节清单逐文件操作
- 注意保留 PLAN-timeblock-cleanup-and-bugfix.md 等标记为"仍在规划中"或"部分实现"的文件在原位，归档时需区分

### P1-4：修复 QUICK-START.md

- 当前内容是 Tauri 通用模板构建脚本，与 ExoMind 无关
- 需替换为真正的 ExoMind 快速开始内容，或标注为过时并链接到 README.md
- 建议：直接替换成指向 README.md 和 BUILD.md 的简短入口

## P2：近期执行

### P2-1：修复 ARCH-SYNC.md 引用错误

- 当前引用不存在的 `SPEC-301.md`、`SPEC-302.md`、`SPEC-303.md`
- 这些已合并为 `docs/specs/auth.md` 和 `docs/specs/sync.md`
- 修复引用路径或标注 ARCH-SYNC.md 为过时

### P2-2：更新版本号（PRD.md / roadmap.md / project-overview.md）

- `docs/product/PRD.md` — 版本号从 v0.3.x 更新到 v0.4.15
- `docs/product/roadmap.md` — Phase 5-7 已完成状态更新
- `docs/memory/project-overview.md` — 描述版本从 v0.3.6 更新到 v0.4.15

### P2-3：删除 legacy 截图文件

- `docs/assets/legacy/exomind-screenshot.png`（未被任何 .md/.ts/.tsx 引用）
- `docs/assets/legacy/mobile-view.png`（未被任何 .md/.ts/.tsx 引用）

### P2-4：删除冗余合并版文档

- `docs/memory/plugin-system-strategic-report.md`（与 6 章分章版重复）

## P3（本次不执行，但需记录决策）

### P3-1：plans 上下文压缩 — 聚合为综述

- 同主题多个 plan 合并为一篇综述（如 timeblock 系列、voice-input 系列）
- 原始 plan 在合并后删除
- 这是用户明确要求的，但不在本次半天范围内
- **决策**：暂不执行，记录为待办

### P3-2：研究仓库分离

- 以「是否已公开到 issue」为判断维度
- 已明确的研究文档可搬至 `exomind-team/exomind-team`
- **决策**：暂不执行，等搬迁式重构推进后自然处理

### P3-3：内部计划文件迁移

- 内部决策/计划文件不在主仓库中暴露
- **决策**：暂不执行，关联 #906

## 执行顺序

```
P1-2（删 HTML）→ P1-3（归档 plans）→ P1-4（修 QUICK-START）
→ P1-1（CHANGELOG）→ P2-1（修引用）→ P2-2（版本号）→ P2-3/P2-4（删冗余）
```

理由：先做无风险的删除/移动操作，再做内容修改，最后做版本号等轻量更新。

## 验证方式

1. `git status` 确认操作范围可控
2. `git diff --stat` 确认涉及文件
3. README.md 中的引用不受影响（检查删除的 HTML 文件是否被引用）
4. 对 CHANGELOG：`git log --oneline v0.3.4..HEAD` 提取提交
