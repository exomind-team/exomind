# REVIEW - PM 目录二次评审

> 重点评估：内容重复、Agent 运行逻辑、精简优化、防幻觉约束

**评审日期**: 2026-02-03
**评审方法**: 7 SubAgent 并行评审

---

## 问题汇总统计

| 优先级 | 数量 | 定义 |
|--------|------|------|
| **P0 (严重)** | 27 | 阻断性问题，Agent 无法正常执行 |
| **P1 (重要)** | 44 | 影响执行质量，但不阻断流程 |
| **P2 (建议)** | 35 | 规范性建议，不影响功能 |

---

## 一、Agent 运行逻辑专项评估

> **核心问题**：当前 Agent 运行逻辑存在严重缺陷，无法在大模型有幻觉的情况下可靠完成任务

### 1.1 综合评估得分

| 评估维度 | 得分 | 说明 |
|----------|------|------|
| 流程可执行性 | 4/10 | 步骤数量矛盾、前置/退出条件不清晰 |
| 约束有效性 | 2/10 | 缺少强制验证机制、技术手段约束 |
| 防幻觉设计 | 1/10 | 无验证点、无强制检查、无不可绕过约束 |
| 流程闭环性 | 3/10 | 多处断点、循环触发机制缺失 |
| 自洽性 | 3/10 | 多处矛盾、引用失效、版本不一致 |
| 完整性 | 4/10 | 缺少关键步骤（需求确认、复现验证、能量检查） |

### 1.2 流程矛盾（高风险）

| 矛盾点 | 文件A | 文件B | 风险 |
|--------|-------|-------|------|
| Ralph Loop 步骤数 | development.md (10步) | agent.md/CLAUDE.md (9步) | Agent 无法确定权威版本 |
| 提交类型大小写 | development.md (大写) | git-spec.md (小写) | 提交信息不规范 |
| 测试覆盖率 | development.md (100%) | roadmap.md (>80%) | 要求不一致 |
| 分支命名 | CLAUDE.md (master) | git-spec.md (main) | 分支命名混乱 |

### 1.3 防幻觉能力缺失

| 约束类型 | 当前状态 | 风险 |
|----------|----------|------|
| 引用验证 | 多处引用不存在文件 | Agent 可能执行错误命令 |
| 版本检查 | 未强制执行 | Agent 可能使用过时流程 |
| 测试验证 | 未强制运行测试 | Agent 可能声称通过但实际未测试 |
| 路径白名单 | 无限制 | Agent 可能引用错误路径 |

### 1.4 流程断点

| 步骤衔接 | 问题 |
|----------|------|
| 2-3 (Spec→编码) | 缺少"Spec 评审通过"环节 |
| 4-5 (单元→集成) | "通过"标准未定义 |
| 8-9 (PR→自评) | PR 是否 merge 未定义 |
| 9-0 (自评→下一轮) | 循环触发机制缺失 |

---

## 二、内容重复问题

### 2.1 高度相似内容（>80%）

| 文件A | 文件B | 相似度 | 重叠内容 |
|-------|-------|--------|----------|
| agent.md (37-64行) | development.md (346-372行) | 95% | 修改即提交原则完整复制 |
| agent.md (97-116行) | memory.md (73-85行) | 90% | 双终端工作模式 |
| git-spec.md (62-81行) | development.md (327-332行) | 85% | Git 提交类型定义 |

### 2.2 主题重叠

| 主题 | 涉及文件 | 问题 |
|------|----------|------|
| Ralph Loop 流程 | agent.md, development.md, CLAUDE.md | 三处定义，版本不一致 |
| 修改即提交原则 | agent.md, development.md, memory.md | 三处完整定义 |
| Git 提交类型 | git-spec.md, development.md | 两处定义，格式矛盾 |
| 双终端模式 | agent.md, memory.md | 两处定义 |
| 测试覆盖率 | agent.md, long-term.md, development.md | 要求不一致 |

### 2.3 可合并建议

| 合并项 | 当前分布 | 建议 |
|--------|----------|------|
| 修改即提交原则 | agent.md + development.md + memory.md | 保留一份在 git-spec.md，其他引用 |
| Git 提交类型 | git-spec.md + development.md | development.md 简化为"参考 git-spec.md" |
| 双终端模式 | agent.md + memory.md | 保留 agent.md，memory.md 引用 |
| Ralph Loop | agent.md + development.md | 保留 development.md 为权威，agent.md 引用 |

---

## 三、引用失效问题

### 3.1 错误引用路径

| 文件 | 行号 | 错误引用 | 应为 |
|------|------|----------|------|
| prd.md | 19-87 (多次) | `docs/ExoMind-KNOWLEDGE-BASE.md` | `02_ExoMind-KNOWLEDGE-BASE.md` |
| prd.md | 325 | `docs/ExoMind/tasks/*.md` | 目录不存在 |
| agent.md | 71,135,177 | `~/ExoMind-Obsidian-HailayLin/...` | 外部路径不存在 |
| agent.md | 360 | `pm/PLAN.md` | `pm/tasks_plan.md` |
| input.md | 40 | `pm/PLAN.md` | `pm/tasks_plan.md` |
| roadmap.md | 7,350 | `../docs/ExoMind-KNOWLEDGE-BASE.md` | `../docs/02_ExoMind-KNOWLEDGE-BASE.md` |
| tasks_plan.md | 16 | `docs\VOICEIME_PRD.md` | 不存在 |

**总计**: 32 个引用问题

### 3.2 不存在的文件/目录

| 引用 | 状态 |
|------|------|
| `docs\VOICEIME_PRD.md` | 不存在 |
| `DOCS/API.MD` | 不存在 |
| `DOCS/SOUL.MD` | 应为 `docs/SOUL.md` |
| `docs/ExoMind/tasks/*.md` | 目录不存在 |
| `time-blocks/*.md` | 目录不存在 |
| `~/ExoMind-Obsidian-HailayLin/...` | 外部路径不存在 |

---

## 四、精简优化建议

### 4.1 冗余内容（可删除）

| 文件 | 内容 | 建议 |
|------|------|------|
| development.md | 第418-488行：Telegram Bot 代理配置 | 删除（与当前架构无关） |
| development.md | 第545-561行：常用命令 | 精简，保留相关命令 |
| agent.md | 第177-209行：技术栈表格 | 删除，引用 CLAUDE.md |
| memory.md | 第41-51行：用户信息表格 | 与 long-term.md 重复，合并 |
| memory.md | 第54-86行：工作流程原则 | 删除，引用 agent.md |

### 4.2 过度设计

| 文件 | 内容 | 问题 | 建议 |
|------|------|------|------|
| git-spec.md | 第271-528行：worktree 规范 | 过于详尽 | 精简为核心流程 |
| prd.md | 第479-518行：文档溯源表 | 维护成本高 | 删除或简化 |

### 4.3 可合并文件

| 合并项 | 当前分布 | 建议 |
|--------|----------|------|
| roadmap.md + prd.md | 功能列表高度重叠 | 合并为一份 PRD |
| memory.md + long-term.md | 用户信息重复 | 统一到 long-term.md |

---

## 五、版本状态问题

| 文件 | 问题 |
|------|------|
| prd.md | v1.0 和 v2.0 同日（2026-02-03），违反版本演进逻辑 |
| roadmap.md | p0 基础框架已过期（2026-01-29），状态仍为"已完成" |
| agent.md | frontmatter v2.0，footer v1.4，版本不一致 |
| git-spec.md | 有 header 版本，footer 无版本声明 |

---

## 六、Frontmatter/格式问题

### 6.1 缺失字段

| 文件 | 缺失字段 |
|------|----------|
| tasks_plan.md | title, author |
| memory.md | title, created, author |
| memory/long-term.md | title, created, author |
| development.md | title, author, created |
| agent.md | title, author, created |
| input.md | title, author, created |
| roadmap.md | title, author, created |
| prd.md | 完全无 frontmatter |
| git-spec.md | title, author, created |

### 6.2 占位符

| 文件 | 行号 | 内容 |
|------|------|------|
| long-term.md | 36-41 | "待开始"（4处） |
| prd.md | 372-409 | "待实现"（4处） |

### 6.3 代码块无语言标记

- development.md: 5 处
- prd.md: 3 处
- long-term.md: 1 处

---

## 七、修复优先级

### P0 - 立即修复（防阻断）

1. **统一 Ralph Loop 权威版本**
   - 确定 `pm/development.md` 的 10 步为唯一权威
   - 更新 `pm/agent.md` 和 `CLAUDE.md`，删除矛盾描述

2. **修复所有失效引用**
   - `pm/agent.md`: 外部路径 → `pm/development.md`
   - `pm/agent.md`, `pm/input.md`: `PLAN.md` → `tasks_plan.md`
   - `pm/prd.md`: 修正所有 KNOWLEDGE-BASE 路径

3. **统一 Git 提交规范**
   - 统一使用小写（以 `git-spec.md` 为准）
   - 更新 `pm/development.md` 示例

4. **统一测试覆盖率**
   - `pm/roadmap.md`: >80% → 100%

5. **统一分支命名**
   - `CLAUDE.md`: `master` → `main`

6. **修复版本号不一致**
   - `pm/agent.md`: footer v1.4 → v2.0
   - `pm/prd.md`: frontmatter 添加 version

### P1 - 本周修复（提质量）

7. **定义防幻觉约束**
   - 添加路径白名单机制
   - 添加强制版本检查步骤
   - 实现 CI 引用验证

8. **明确流程步骤条件**
   - 定义每个步骤的进入/退出条件
   - 添加 Spec 验证机制
   - 定义测试"通过"标准

9. **补充缺失内容**
   - 添加 PR 模板
   - 定义自我评估标准
   - 补充 systemd 服务管理内容

10. **合并重复内容**
    - 修改即提交原则统一到一处
    - Git 提交类型简化为引用
    - 删除冗余的技术栈表格

### P2 - 后续优化（持续改进）

11. 精简 `git-spec.md` 的 worktree 规范
12. 删除 Telegram Bot 相关过时内容
13. 统一 Frontmatter 格式
14. 补充代码块语言标记
15. 清理占位符（待开始 → 具体任务）

---

## 八、Prd.md 日期矛盾详情

```
变更记录:
- v1.0 (2026-02-03): ...
- v2.0 (2026-02-03): ...
```

**问题**: v1.0 和 v2.0 同日创建，不符合版本演进逻辑（应 v1.0 在 v2.0 之前）。

**修复建议**:
- v1.0 创建日期改为 2026-01-XX
- 或删除 v1.0 变更记录（如果 v1.0 是初始版本）

---

## 引用来源

| SubAgent | 评审维度 | 问题数量 |
|----------|----------|----------|
| SubAgent 1 | 引用一致性 | 32 |
| SubAgent 2 | 流程逻辑矛盾 | 5 |
| SubAgent 3 | 内容完整性 | 23 |
| SubAgent 4 | 版本状态追踪 | 3 |
| SubAgent 5 | 内容重复 | 17 |
| SubAgent 6 | Agent 运行逻辑 | 45 |
| SubAgent 7 | 精简优化 | 18 |

---

*报告生成时间: 2026-02-03*
*评审方法: 7 SubAgent 并行评审*
