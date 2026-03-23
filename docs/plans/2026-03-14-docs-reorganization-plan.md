# 文档体系重组实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将分散在 docs/ 和 pm/ 的 850+ 文件整理为结构清晰、双入口（人类 + AI）的统一文档体系。

**Architecture:** 废除 pm/ 目录，全部迁入 docs/。已完成/废弃计划删除并建立归档索引。4 份架构文档合并为 1 份。创建 README.md 导航索引 + AI-CONTEXT.md 通用 AI 入口。精简 CLAUDE.md 架构部分为索引。

**Tech Stack:** Git, Markdown, shell commands. No code changes — documentation only.

**Related:** Issue #529, Design doc: `docs/plans/2026-03-14-docs-reorganization-design.md`

---

### Task 1: 创建目录结构 + 骨架文件

**Files:**
- Create: `docs/product/` directory
- Create: `docs/ARCHIVE-INDEX.md` (skeleton)
- Create: `docs/AI-CONTEXT.md` (skeleton)

**Step 1: 创建新目录**

```bash
mkdir -p docs/product
```

**Step 2: 创建 ARCHIVE-INDEX.md 骨架**

Create `docs/ARCHIVE-INDEX.md`:

```markdown
# 文档归档索引

已删除文档的历史记录。原文件可通过 git 历史查看。

## 计划文档（已完成）

| 原路径 | 摘要 | 关联 Issue/PR | 删除提交 |
|--------|------|---------------|----------|

## 计划文档（已废弃）

| 原路径 | 摘要 | 关联 Issue/PR | 删除提交 |
|--------|------|---------------|----------|

## 架构文档（已合并）

| 原路径 | 摘要 | 合并去向 | 删除提交 |
|--------|------|----------|----------|

## 项目管理文档（已迁移或删除）

| 原路径 | 摘要 | 迁移去向 | 删除提交 |
|--------|------|----------|----------|

## 临时文档（已删除）

| 原路径 | 摘要 | 删除提交 |
|--------|------|----------|
```

**Step 3: 创建 AI-CONTEXT.md 骨架**

Create `docs/AI-CONTEXT.md`:

```markdown
# ExoMind AI Context

> 通用项目上下文，供任何 AI 工具加载。具体 AI 指令见 CLAUDE.md / AGENTS.md。

## 项目定位

（待填充）

## 文档索引

→ [docs/README.md](README.md)
```

**Step 4: Commit**

```bash
git add docs/product docs/ARCHIVE-INDEX.md docs/AI-CONTEXT.md
git commit -m "docs: 创建文档重组骨架目录和索引文件 (#529)"
```

---

### Task 2: pm/ → docs/product/ 迁移

**Files:**
- Move: `pm/PRD.md` → `docs/product/PRD.md`
- Move: `pm/roadmap.md` → `docs/product/roadmap.md`
- Move: `pm/COMPLETED_FEATURES.md` → `docs/product/completed-features.md`

**Step 1: 移动文件**

```bash
git mv pm/PRD.md docs/product/PRD.md
git mv pm/roadmap.md docs/product/roadmap.md
git mv pm/COMPLETED_FEATURES.md docs/product/completed-features.md
```

**Step 2: 更新 ARCHIVE-INDEX.md**

在「项目管理文档（已迁移或删除）」表格中添加：

```markdown
| pm/PRD.md | 产品需求文档 v2.0 | docs/product/PRD.md | (本次提交) |
| pm/roadmap.md | 产品路线图 v2.0 | docs/product/roadmap.md | (本次提交) |
| pm/COMPLETED_FEATURES.md | 已完成特性清单 | docs/product/completed-features.md | (本次提交) |
```

**Step 3: Commit**

```bash
git add docs/product/ docs/ARCHIVE-INDEX.md
git commit -m "docs: 迁移 PRD/roadmap/completed-features 到 docs/product/ (#529)"
```

---

### Task 3: pm/ → docs/development/ 迁移（Git 规范合并）

**Files:**
- Read: `pm/git-spec.md`, `pm/GIT_WORKTREE_SPEC.md`
- Create: `docs/development/git-spec.md` (merged)
- Delete: `pm/git-spec.md`, `pm/GIT_WORKTREE_SPEC.md`

**Step 1: 读取两份文件，分析重叠**

读取 `pm/git-spec.md` 和 `pm/GIT_WORKTREE_SPEC.md`。两者内容高度重叠（同 v1.0，同日期），以 `git-spec.md`（使用 `main` 分支名）为主体，将 `GIT_WORKTREE_SPEC.md` 中独有的 worktree 细节合并。

**Step 2: 创建合并后文件**

Write `docs/development/git-spec.md`：以 `pm/git-spec.md` 为基础，合并 `GIT_WORKTREE_SPEC.md` 中的 worktree 专属内容（如有独有段落）。确保使用 `main` 作为主分支名。

**Step 3: 删除原文件，更新归档索引**

```bash
git rm pm/git-spec.md pm/GIT_WORKTREE_SPEC.md
```

在 ARCHIVE-INDEX.md 中记录迁移。

**Step 4: Commit**

```bash
git add docs/development/git-spec.md docs/ARCHIVE-INDEX.md
git commit -m "docs: 合并 Git 规范到 docs/development/git-spec.md (#529)"
```

---

### Task 4: pm/memory/ → docs/memory/ 迁移

**Files:**
- Move: `pm/memory/README.md` → `docs/memory/README.md`
- Move: `pm/memory/project-overview.md` → `docs/memory/project-overview.md`
- Move: `pm/memory/logs.md` → `docs/memory/logs.md`
- Move: `pm/memory/知识点-Git工作流.md` → `docs/memory/知识点-Git工作流.md`
- Move: `pm/memory/知识点-文档分层.md` → `docs/memory/知识点-文档分层.md`
- Delete: `pm/memory.md` (旧索引，内容已在 README.md 中)
- Delete: `pm/memory/phase3-plan.md` (已完成)
- Delete: `pm/memory/signal-pool-phase2-plan.md` (已完成)
- Delete: `pm/memory/日报-2026-02-09.md` (已沉淀进 logs.md)

**Step 1: 创建目录并移动文件**

```bash
mkdir -p docs/memory
git mv pm/memory/README.md docs/memory/README.md
git mv pm/memory/project-overview.md docs/memory/project-overview.md
git mv pm/memory/logs.md docs/memory/logs.md
git mv "pm/memory/知识点-Git工作流.md" "docs/memory/知识点-Git工作流.md"
git mv "pm/memory/知识点-文档分层.md" "docs/memory/知识点-文档分层.md"
```

**Step 2: 合并 pm/memory.md 内容进 docs/memory/README.md**

读取 `pm/memory.md`，将其中独有的内容（如有）合并进 `docs/memory/README.md`。

**Step 3: 删除不再需要的文件**

```bash
git rm pm/memory.md
git rm pm/memory/phase3-plan.md
git rm pm/memory/signal-pool-phase2-plan.md
git rm "pm/memory/日报-2026-02-09.md"
```

**Step 4: 更新归档索引，记录删除的文件**

**Step 5: Commit**

```bash
git add docs/memory/ docs/ARCHIVE-INDEX.md
git commit -m "docs: 迁移记忆系统到 docs/memory/，清理过期计划 (#529)"
```

---

### Task 5: pm/ 剩余文件清理 + 删除 pm/ 目录

**Files:**
- Delete: `pm/lock-mechanism-design.md` (已被 docs/specs/SPEC-pr-lock-mechanism.md 取代)
- Delete: `pm/PR20-REVIEW.md` (历史 PR 审核)
- Delete: `pm/issue-120-plan.md`, `pm/issue-40-dark-mode-plan.md`, `pm/issue-95-plan.md` (已完成)
- Delete: `pm/input.md` (内容为空，已废弃)
- Delete: `pm/tasks_plan.md` (v0.1 历史)
- Delete: `pm/plans/issue-73-meditation-countdown-end-sound.md` (已完成)

**Step 1: 删除所有剩余 pm/ 文件**

```bash
git rm pm/lock-mechanism-design.md pm/PR20-REVIEW.md
git rm pm/issue-120-plan.md pm/issue-40-dark-mode-plan.md pm/issue-95-plan.md
git rm pm/input.md pm/tasks_plan.md
git rm pm/plans/issue-73-meditation-countdown-end-sound.md
```

**Step 2: 确认 pm/ 目录为空后删除**

```bash
# 检查是否还有残留文件
ls pm/
# 如果为空，git 会自动删除目录
```

**Step 3: 更新归档索引，记录所有删除**

**Step 4: 更新 CLAUDE.md 中对 pm/ 的引用**

搜索 CLAUDE.md 中所有 `pm/` 引用，替换为新路径：
- `pm/git-spec.md` → `docs/development/git-spec.md`
- `pm/prd.md` → `docs/product/PRD.md`
- `pm/roadmap.md` → `docs/product/roadmap.md`
- `pm/memory/README.md` → `docs/memory/README.md`
- `pm/memory/logs.md` → `docs/memory/logs.md`
- `pm/memory/知识点-Git工作流.md` → `docs/memory/知识点-Git工作流.md`

**Step 5: Commit**

```bash
git add -A pm/ docs/ARCHIVE-INDEX.md CLAUDE.md
git commit -m "docs: 废除 pm/ 目录，更新所有引用 (#529)"
```

---

### Task 6: 已完成计划文档清理（批量删除 + 归档索引）

这是最大的清理任务。以下已完成计划文件全部删除，摘要记入 ARCHIVE-INDEX.md。

**Files to delete (COMPLETED plans):**

```
docs/plans/2026-03-14-unified-logger-logpanel-redesign.md
docs/plans/2026-03-14-legacy-data-migration-design.md
docs/plans/2026-03-13-issue-514-instance-diagnostics-plan.md
docs/plans/2026-03-13-pr-506-closeout-plan.md
docs/plans/2026-03-12-settings-inline-enum-alignment-plan.md
docs/plans/2026-03-12-settings-group-overlay-plan.md
docs/plans/2026-03-12-settings-dialog-alignment-plan.md
docs/plans/2026-03-12-settings-danger-action-plan.md
docs/plans/2026-03-11-settings-registry-implementation-plan.md
docs/plans/2026-03-11-pr499-review-regressions.md
docs/plans/2026-03-11-review-agent-b1-implementation.md
docs/plans/2026-03-11-issue-481-rt-task-sqlite-plan.md
docs/plans/2026-03-10-review-agent-unified-entry-plan.md
docs/plans/2026-03-10-voice-overlay-live-preview-design.md
docs/plans/2026-03-09-review-agent-prompts-and-loop-plan.md
docs/plans/2026-03-09-review-agent-discovery-plan.md
docs/plans/2026-03-09-review-agent-bootstrap-plan.md
docs/plans/2026-03-09-phase1-agent-body-plan.md
docs/plans/2026-03-08-life-demo-energy-tick.md
docs/plans/2026-03-07-embedded-runtime-agent-host-sync-plan.md
docs/plans/2026-03-07-ecs-381-acceptance-report.md
docs/plans/2026-03-07-ecs-381-remaining-work-plan.md
docs/plans/2026-03-06-ecs-data-sync-mvp-plan.md
docs/plans/2026-03-06-ecs-phase3-test-baseline-plan.md
docs/plans/2026-03-06-release-v0.3.5-finalization-plan.md
docs/plans/2026-03-06-agent-hub-voice-signal-integration.md
docs/plans/2026-03-06-ecs-phase2-mesh-relay-plan.md
docs/plans/2026-03-06-ecs-phase1-transport-plan.md
docs/plans/2026-03-05-m4-agent-soft-skills-evaluation-pr-comment.md
docs/plans/2026-03-04-m4-rt-agent-hub-review-comment.md
docs/plans/2026-03-04-m4-rt-agent-hub-progress-comment.md
docs/plans/2026-03-04-m4-rt-agent-hub-pr-body.md
docs/plans/2026-03-04-m4-rt-agent-hub-plan-comment.md
docs/plans/2026-03-04-m4-rt-agent-hub-integration-plan.md
docs/plans/2026-03-04-ci-bun-install-selfhosted-stabilization.md
docs/plans/2026-03-04-m1-review-followup-comment.md
docs/plans/2026-03-04-m1-final-pr-comment.md
docs/plans/2026-03-04-m1-embedded-runtime-tauri-plan.md
docs/plans/2026-03-04-m1-embedded-runtime-pr-comment.md
docs/plans/2026-03-04-issue-245f-m2-agent-hub-signal-routes-plan.md
docs/plans/2026-03-04-issue-245f-m2-agent-hub-followup-fix-plan.md
docs/plans/2026-03-04-v034-milestone-plan.md
docs/plans/2026-03-01-issue-104-timeblock-multi-device-sync-plan.md
docs/plans/2026-03-01-signal-pool-sse-runtimehost-mvp-mlp-plan.md
docs/plans/2026-02-27-issue-205-p0-runtimehost-acceptance-plan.md
docs/plans/2026-02-27-build-artifact-r2-update-system.md
docs/plans/2026-02-26-issue-198-desktop-settings-plan.md
docs/plans/2026-02-23-settings-iteration.md
docs/plans/2026-02-23-issue-213-task-ui-mock-plan.md
docs/plans/2026-02-23-issue-204-agent-hub-implementation-plan.md
docs/plans/2026-02-19-semver-beta-versioning-proposal.md
docs/plans/2026-02-18-android-asr-minimal-diff-plan.md
docs/plans/2026-02-12-issue-65-eventlog-lazy-loading.md
docs/plans/2026-02-11-issue-79-port-env-config.md
docs/plans/2026-02-11-issue-77-import-export-plan.md
docs/plans/2026-02-11-issue-27-eventlog-sync-mvp-plan.md
docs/plans/2026-02-10-multi-device-sync-fix.md
docs/plans/2026-02-09-event-log-scroll-direction.md
docs/plans/2026-02-05-event-log-lan-mvp-plan.md
docs/plans/2026-02-04-multi-device-e2e-testing.md
docs/plans/2026-02-04-chat-ui-integration.md
docs/plans/460-eventlog-http-prompt.md
docs/plans/304-voice-global-shortcut-spec.md
```

**Step 1: 批量删除已完成计划**

```bash
git rm docs/plans/2026-03-14-unified-logger-logpanel-redesign.md \
       docs/plans/2026-03-14-legacy-data-migration-design.md \
       # ... (all files listed above)
```

**Step 2: 为每个删除的文件添加归档索引条目**

在 ARCHIVE-INDEX.md 的「计划文档（已完成）」表格中，为每个文件添加一行：

```markdown
| docs/plans/2026-03-14-unified-logger-logpanel-redesign.md | 双写日志接口 + LogPanel 新 UI | #525, PR #526 | (本次提交) |
| docs/plans/2026-03-14-legacy-data-migration-design.md | PouchDB → RT SQLite 迁移 Modal | PR #524 | (本次提交) |
| ... |
```

**Step 3: Commit**

```bash
git add docs/plans/ docs/ARCHIVE-INDEX.md
git commit -m "docs: 清理 60+ 已完成计划文档，建立归档索引 (#529)"
```

---

### Task 7: 废弃计划文档清理

**Files to delete (ABANDONED plans):**

```
docs/plans/2026-03-07-user-system-hybrid-identity-implementation-plan.md
docs/plans/2026-03-06-tasks-today-timeblock-view.md
docs/plans/2026-02-27-issue-205-p1-split-plan.md
docs/plans/2026-02-27-issue-198-settings-ia-legal-support.md
docs/plans/2026-02-27-issue-198-settings-ia-legal-support-pr-comment.md
docs/plans/2026-02-26-issue-205-agent-hub-backend-plan.md
docs/plans/2026-02-23-issue-215-me-ui-plan.md
docs/plans/2026-02-11-issue-25-epic-subtasks-plan.md
docs/plans/2026-02-21-user-management-ui.md
docs/plans/2026-02-21-mcp-auth-impl-plan.md
docs/plans/2026-01-30-ralph-loop-enhanced.md
```

**Step 1: 删除废弃计划**

```bash
git rm docs/plans/2026-03-07-user-system-hybrid-identity-implementation-plan.md \
       docs/plans/2026-03-06-tasks-today-timeblock-view.md \
       # ... (all files listed above)
```

**Step 2: 更新归档索引「计划文档（已废弃）」表格**

**Step 3: Commit**

```bash
git add docs/plans/ docs/ARCHIVE-INDEX.md
git commit -m "docs: 清理废弃计划文档 (#529)"
```

---

### Task 8: 已完成 DESIGN 文档清理

已完成功能的设计文档，关键决策已体现在代码和权威文档中，原文件可删除。

**Files to delete (stale DESIGN docs):**

```
docs/plans/2026-03-12-settings-inline-enum-alignment-design.md
docs/plans/2026-03-12-settings-group-overlay-design.md
docs/plans/2026-03-12-settings-dialog-alignment-design.md
docs/plans/2026-03-12-settings-danger-action-design.md
docs/plans/2026-03-10-review-agent-unified-entry-design.md
docs/plans/2026-02-21-mcp-auth-design.md
docs/plans/2026-02-05-event-log-design.md
```

**保留的 DESIGN 文档**（仍有活跃 Issue）：

```
docs/plans/2026-03-14-docs-reorganization-design.md          # 本次工作
docs/plans/2026-03-13-agent-session-unified-abstraction-design.md  # Issue #515 OPEN
docs/plans/2026-03-12-now-workbench-overlay-v2-design.md     # Issue #516 OPEN
docs/plans/2026-03-11-review-agent-phase-c-prompt-loading-design.md  # Issue #479 OPEN
docs/plans/2026-03-11-issue-485-rt-timeblock-sqlite-design.md  # Issue #485 OPEN
docs/plans/2026-03-11-voice-overlay-soft-floating-card-design.md  # Issue #480 OPEN
docs/plans/2026-03-11-voice-task-growth-mvp-brief.md         # Issue #480 OPEN
docs/plans/2026-03-11-voice-input-experience-design.md       # Issue #480 OPEN
docs/plans/2026-03-07-personal-growth-to-civilization-roadmap.md  # 长期战略
docs/plans/2026-03-07-issue-385-agent-runtime-orchestration-design.md  # Issue #385 OPEN
docs/plans/2026-03-07-user-system-hybrid-identity-architecture.md  # 架构参考
docs/plans/2026-03-06-agent-hub-topology-layout-design.md    # Issue #382 OPEN
docs/plans/2026-03-06-agent-hub-claude-codex-runtime-research.md  # Issue #385 OPEN
docs/plans/2026-03-01-sync-server-unified-data-architecture.md  # 架构参考
docs/plans/product-plan.md                                    # 长期战略
```

**Step 1: 删除过时 DESIGN 文档**

**Step 2: 更新归档索引**

**Step 3: Commit**

```bash
git add docs/plans/ docs/ARCHIVE-INDEX.md
git commit -m "docs: 清理已过时的设计文档 (#529)"
```

---

### Task 9: 架构文档合并（4 → 1）

**Files:**
- Read: `docs/architecture.md` (30K)
- Read: `docs/architecture/UNIFIED-ARCHITECTURE-v3-DRAFT.md` (59K)
- Read: `docs/architecture/MVP-ARCHITECTURE.md` (25K)
- Read: `docs/architecture/MVP.md` (13K)
- Create: `docs/architecture/overview.md` (merged, authoritative)
- Delete: the 4 original files

**Step 1: 读取所有 4 份文档**

逐一读取，标记每份独有的内容。以 `UNIFIED-ARCHITECTURE-v3-DRAFT.md`（最新最全）为骨架。

**Step 2: 合并为 overview.md**

结构：
```markdown
# ExoMind 架构总览

> 本文档是 ExoMind 架构的唯一权威描述。

## 1. 系统定位
## 2. 分层架构模型（v4.0）
## 3. Port 定义
## 4. Environment 职责
## 5. Actor / Agent 模型
## 6. 信号池架构
## 7. 渐进式实施路线（Phase 1-5）
## 8. 设计模式总览

---

## 附录：架构演化历史

简要记录从 MVP → v3 → v4 的演化脉络。
```

合并原则：
- 以 UNIFIED-v3 为主体
- 从 MVP.md / MVP-ARCHITECTURE.md 提取演化历史独有内容
- 从 architecture.md 提取如有独有的 Port/Service 细节
- 去除重复内容，保持叙述连贯

**Step 3: 删除原文件**

```bash
git rm docs/architecture.md
git rm docs/architecture/UNIFIED-ARCHITECTURE-v3-DRAFT.md
git rm docs/architecture/MVP-ARCHITECTURE.md
git rm docs/architecture/MVP.md
```

**Step 4: 更新归档索引**

**Step 5: Commit**

```bash
git add docs/architecture/overview.md docs/ARCHIVE-INDEX.md
git commit -m "docs: 合并 4 份架构文档为 architecture/overview.md (#529)"
```

---

### Task 10: docs/ 根目录清理

**Files:**
- Delete: `docs/overview.md` (30K, 内容已在架构 overview 和 AI-CONTEXT 中)
- Delete: `docs/stack.md` (3K, 技术栈信息已在 CLAUDE.md 中)
- Move: `docs/quickstart.md` → `docs/development/quickstart.md`

**Step 1: 移动 quickstart**

```bash
git mv docs/quickstart.md docs/development/quickstart.md
```

**Step 2: 删除冗余文件**

```bash
git rm docs/overview.md docs/stack.md
```

**Step 3: 更新归档索引**

**Step 4: Commit**

```bash
git add docs/ docs/ARCHIVE-INDEX.md
git commit -m "docs: 清理 docs/ 根目录冗余文件 (#529)"
```

---

### Task 11: docs/fixes/ 和 docs/pr/ 清理

**Files:**
- Read: `docs/fixes/` 全部文件
- Read: `docs/pr/` 全部文件
- Delete: both directories

**Step 1: 检查是否有通用修复模式值得保留**

读取 `docs/fixes/` 中 4 个文件。如果发现通用的修复经验模式（而非特定 PR 的状态跟踪），提取到 `docs/development/` 中的合适位置。

**Step 2: 删除两个目录**

```bash
git rm -r docs/fixes/ docs/pr/
```

**Step 3: 更新归档索引**

**Step 4: Commit**

```bash
git add docs/ARCHIVE-INDEX.md
git commit -m "docs: 清理临时性 PR/fix 文档 (#529)"
```

---

### Task 12: Specs 合并

**Files:**
- Read: `docs/specs/SPEC-301-多设备数据同步.md` (68K)
- Read: `docs/specs/SPEC-303-sync模块架构.md` (19K)
- Read: `docs/specs/SPEC-302-密码哈希模块.md` (15K)
- Read: `docs/specs/SPEC-304-用户认证模块重构.md` (19K)
- Read: `docs/superpowers/specs/2026-03-11-settings-registry-design.md` (23K)
- Read: `docs/superpowers/specs/2026-03-14-settings-registry-evolution.md` (9.2K)
- Create: `docs/specs/sync.md` (merged from 301+303)
- Create: `docs/specs/auth.md` (merged from 302+304)
- Note: settings-registry 暂不合并（superpowers/ 路径保留）

**Step 1: 合并同步相关 SPEC**

读取 SPEC-301 和 SPEC-303。以 SPEC-301（更全面，68K）为主体，合并 SPEC-303 中独有的架构细节。Write 到 `docs/specs/sync.md`。

**Step 2: 合并认证相关 SPEC**

读取 SPEC-302 和 SPEC-304。以 SPEC-304（更新的重构方案）为主体，合并 SPEC-302 中独有的密码哈希细节。Write 到 `docs/specs/auth.md`。

**Step 3: 删除原文件**

```bash
git rm "docs/specs/SPEC-301-多设备数据同步.md"
git rm "docs/specs/SPEC-303-sync模块架构.md"
git rm "docs/specs/SPEC-302-密码哈希模块.md"
git rm "docs/specs/SPEC-304-用户认证模块重构.md"
```

**Step 4: 更新归档索引**

**Step 5: Commit**

```bash
git add docs/specs/ docs/ARCHIVE-INDEX.md
git commit -m "docs: 合并 SPEC-301/303 → sync.md, SPEC-302/304 → auth.md (#529)"
```

---

### Task 13: 创建 docs/README.md 导航索引

**Files:**
- Rewrite: `docs/README.md`

**Step 1: 盘点 docs/ 下所有现存文件**

```bash
find docs/ -name '*.md' -not -path 'docs/plans/*' | sort
```

**Step 2: 编写导航索引**

Rewrite `docs/README.md` 为完整的导航索引，覆盖所有现存文件和目录。格式参见设计文档 §4.1。

确保：
- 每个 .md 文件都有对应链接
- 分类清晰（架构、规格、产品、开发、研究、Agent、计划、记忆）
- 链接使用相对路径
- 简短描述每个文件的内容

**Step 3: 验证所有链接存在**

```bash
# 提取所有 markdown 链接并检查文件是否存在
grep -oP '\]\(([^)]+\.md)\)' docs/README.md | tr -d ']()'  | while read f; do
  test -f "docs/$f" || echo "BROKEN: $f"
done
```

**Step 4: Commit**

```bash
git add docs/README.md
git commit -m "docs: 创建完整文档导航索引 (#529)"
```

---

### Task 14: 完善 docs/AI-CONTEXT.md

**Files:**
- Modify: `docs/AI-CONTEXT.md`

**Step 1: 编写通用 AI 上下文**

```markdown
# ExoMind AI Context

> 通用项目上下文，供任何 AI 工具加载。具体 AI 指令见 CLAUDE.md / AGENTS.md。

## 项目定位

ExoMind（外心）= 个人/集体的生命成长助手 + 认知生命科学原型。
探索：人作为生命如何主动掌控自己的力量？如何在计算机上实现生命/思维机器？

## 技术栈

Tauri 2.0 + React 18 + TypeScript + Rust | Zustand | Tailwind CSS + Radix UI | Bun | Vitest

## 核心架构

→ [docs/architecture/overview.md](architecture/overview.md)

快速参考：L1 Adapter → L2 Environment → L3 Service/Actor/Agent → L4 UI

## 当前阶段

Phase 2 完成（SignalPool L3-L5），Phase 3 进行中（资源管控 + 可观测性）

## 文档索引

→ [docs/README.md](README.md)

## 关键目录

| 目录 | 内容 |
|------|------|
| docs/architecture/ | 架构设计（权威） |
| docs/specs/ | 模块规格 |
| docs/product/ | PRD、路线图 |
| docs/development/ | 开发指南、Git 规范 |
| docs/plans/ | 活跃实施计划 |
| docs/memory/ | AI 对话记忆 |
| docs/agents/ | Agent 文档 |

## 活跃工作

→ docs/plans/ 中的所有文件均为进行中的计划
```

**Step 2: Commit**

```bash
git add docs/AI-CONTEXT.md
git commit -m "docs: 完善 AI-CONTEXT.md 通用 AI 加载入口 (#529)"
```

---

### Task 15: 精简 CLAUDE.md 架构部分

**Files:**
- Modify: `CLAUDE.md`

**Step 1: 定位架构部分**

找到 CLAUDE.md 中的 `## 核心架构` 章节（从 `### 分层架构模型（v4.0）` 开始到 `### 核心模块状态` 结束）。

**Step 2: 替换为索引**

将整个架构详述（约 3K 文字）替换为：

```markdown
## 核心架构

→ 详见 [docs/architecture/overview.md](docs/architecture/overview.md)

**快速参考**：L1 Adapter → L2 Environment → L3 Service/Actor/Agent → L4 UI

| 层级 | 职责 | 接口归属 |
|------|------|----------|
| L4 UI | React + Zustand | Service interface（L3 定义） |
| L3 Service/Actor/Agent | 业务逻辑 | ActorContext（L3 定义） |
| L2 Environment | 共享物理世界，持有 Port | Port interface（L2 定义） |
| L1 Adapter | 具体实现，按运行时替换 | — |
```

**Step 3: 更新 pm/ 路径引用**

确认所有 `pm/` 引用已在 Task 5 中更新。如有遗漏，在此修复。

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: 精简 CLAUDE.md 架构部分为索引 (#529)"
```

---

### Task 16: 多 Agent 质量评审

**Step 1: 链接完整性检查**

启动 Agent 遍历 docs/ 下所有 .md 文件中的内部链接（`[text](path)` 格式），验证目标文件存在。输出所有死链。

**Step 2: 内容一致性检查**

启动 Agent 检查：
- docs/architecture/overview.md 中的分层描述与 CLAUDE.md 精简版一致
- AI-CONTEXT.md 中的阶段描述与实际代码匹配
- docs/README.md 索引覆盖 docs/ 下所有 .md 文件

**Step 3: 索引覆盖度检查**

启动 Agent：
- 列出 docs/ 下所有 .md 文件
- 检查每个文件是否在 docs/README.md 中有链接入口
- 输出未被索引的文件

**Step 4: 修复评审发现的问题**

根据三个 Agent 的输出，修复所有死链、不一致和索引遗漏。

**Step 5: Commit**

```bash
git add docs/
git commit -m "docs: 修复评审发现的链接/一致性/索引问题 (#529)"
```

---

### Task 17: 最终验证 + 总结

**Step 1: 统计清理成果**

```bash
# 清理前后对比
find docs/ -name '*.md' | wc -l
du -sh docs/
```

**Step 2: 确认 pm/ 目录已完全删除**

```bash
test -d pm && echo "ERROR: pm/ still exists" || echo "OK: pm/ removed"
```

**Step 3: 确认 docs/plans/ 只含活跃计划**

```bash
ls docs/plans/
```

**Step 4: 在 Issue #529 上评论交付摘要**

包含：
- 清理前后文件数和体积对比
- 删除的文件数
- 合并的文档数
- 新建的索引文件
- 评审结果

**Step 5: Commit 并关联 Issue**

```bash
git add .
git commit -m "docs: 文档体系重组完成 (#529)

- 废除 pm/ 目录，全部迁入 docs/
- 清理 70+ 已完成/废弃计划文档
- 合并 4 份架构文档为 1 份 overview.md
- 合并 4 份 SPEC 为 sync.md + auth.md
- 创建 README.md 导航索引 + AI-CONTEXT.md
- 精简 CLAUDE.md 架构部分
- 多 Agent 质量评审通过

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```
