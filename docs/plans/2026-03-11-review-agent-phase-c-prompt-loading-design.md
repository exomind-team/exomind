# Review Agent Phase C Prompt Loading Design

## 背景

阶段 A / B1 / B2 主要解决的是：
- 远端真相优先的唤醒链
- stale selected PR 恢复问题
- 主评论身份从本地缓存回到 GitHub 远端识别

但统一入口 prompt 目前仍保留“每轮冷启动先全量预读所有文档”的执行方式。实际试运行表明，这会让 Agent 在还没运行 router 之前，就先加载 discovery / review / comment / state-worktree 的全部材料，形成额外的 Explore 成本，并削弱 `router` 作为唯一阶段入口的设计意图。

阶段 C 的目标，是把统一入口改造成：

```text
最小启动契约
    ↓
运行 router
    ↓
根据 router.action 按需加载 phase-specific 文档
    ↓
执行 discovery / review
```

## 目标

1. 将统一入口从“每轮全量预读”改为“最小启动契约 + router 后按需加载”。
2. 保留跨阶段硬约束，但不再要求每轮冷启动先打开全部文档。
3. 只在脚本输出层增加“当前必须再读哪些详细文档”的显式提示字段，不改动阶段判断或 review 核心逻辑。
4. 让阶段 C 的文档分层更贴近真实自动化系统的分工：先判 phase，再加载 phase 规则。

## 非目标

1. 不在本阶段修改 discovery / review / merge 的核心逻辑。
2. 不在本阶段解决 `viewerCanMerge`、英文 gate、`#479` 等后续行为问题。
3. 不在本阶段引入新的状态机抽象或新的配置系统。
4. 不在本阶段修改 worktree 生命周期策略本身，只调整文档与输出提示的加载时机。

## 选定方案

采用方案 B：

```text
文档分层重构 + 脚本输出 referencesMustRead
```

原因：
- 相比纯文档方案，它能把“按需加载”显式体现在脚本输出中，而不是只停留在 prompt 文本里。
- 相比建立额外 profile / map 的方案，它更轻，不会给阶段 C 引入新的抽象层。
- 它满足本阶段边界：脚本只改输出层，不碰核心逻辑。

## 设计原则

### 1. phase 判断优先于 phase 规则加载

统一入口不应在 phase 未知时就把 discovery/review 两套细则都提前装入上下文。

正确顺序应是：
- 先理解最小启动契约
- 先运行 `router.ts`
- 再根据输出的 `action` 读取对应执行文档

### 2. GitHub-first 不只是判定规则，也应体现在加载顺序上

既然当前架构已经明确：
- GitHub 远端状态 + 人类当前指令是第一真相源
- router 是唯一阶段入口

那么统一入口的执行链也应该先运行 router，再决定加载哪类细则。

### 3. 文档职责要可独立理解

- `review-agent.prompt.md`：冷启动契约
- `router-and-recovery.md`：phase 判断契约
- `discovery-loop.md`：discovery 规则
- `review-loop.md`：review 规则
- `comment-policy-and-templates.md`：评论动作规则
- `state-files-and-worktrees.md`：恢复/辅助验证规则
- `common-contract.md`：总契约参考，不再作为每轮冷启动必读

## 具体设计

### A. 统一入口 prompt 重构

`docs/agents/review-agent/review-agent.prompt.md` 调整为：

1. 启动前只要求阅读：
   - `AGENTS.md`
   - prompt 内联的最小启动契约
2. 立即运行：
   - `npx tsx Scripts/review-agent/router.ts`
3. 根据 `router.action` 再读取：
   - `discovery-loop.md`
   - 或 `review-loop.md`
4. 只有在 review 里真的要发布/更新评论时，再读取：
   - `comment-policy-and-templates.md`
5. 只有在需要状态恢复/创建 worktree 时，再读取：
   - `state-files-and-worktrees.md`

其中 prompt 内联保留的最小契约只包含跨阶段硬规则，例如：
- 不依赖上轮记忆
- router 是唯一阶段判断入口
- 本地状态与 GitHub 冲突时以 GitHub 为准
- 不手工切换 phase
- 非明确任务时不修改仓库正式代码
- `./temp/` 仅作临时状态与草稿目录

### B. `common-contract.md` 降级为参考总契约

`docs/agents/review-agent/common-contract.md` 继续保留，但从“每轮必读”改为“参考总契约”。

处理方式：
- 将其中真正必须冷启动立即生效的规则压缩回 prompt
- 保留其作为设计总览、术语定义、状态集合、审批边界的参考文档价值

### C. phase 文档后置加载

`docs/agents/review-agent/discovery-loop.md` 与 `docs/agents/review-agent/review-loop.md` 在阶段 C 后应满足：
- 在 phase 已知的前提下，可以独立支撑执行
- 不默认要求“你在冷启动时已经把 comment/state/worktree 文档也读过一遍”

### D. 评论与状态/worktree 文档降级为动作层材料

`comment-policy-and-templates.md`：
- 明确改为“只有在 review 动作层要发/改评论时才必须读取”

`state-files-and-worktrees.md`：
- 明确改为“只有在恢复失败上下文、解释本地状态、创建/复用 worktree 时才必须读取”

### E. 脚本输出层增加 `referencesMustRead`

允许的脚本改动仅限输出字段增强：
- `router.ts`
- `discovery.ts`
- `review-loop.ts`

增加字段：
- `referencesMustRead: string[]`

设计意图：
- 把“当前下一步必须读哪些详细文档”写入机器可见输出
- 降低 Agent 仅靠 prompt 文本记忆去补读文档的负担
- 不改 action / state / queue / retry / merge 的任何核心逻辑

建议输出规则：
- `router -> discovery`：`["docs/agents/review-agent/discovery-loop.md"]`
- `router -> review`：`["docs/agents/review-agent/review-loop.md"]`
- `discovery` 成功或失败输出：继续附带 `discovery-loop.md`
- `review summary` 输出：附带 `review-loop.md`
- `review action` 输出：
  - 至少附带 `review-loop.md`
  - 若涉及评论发布/校验，再附带 `comment-policy-and-templates.md`
  - 若输出提示需要 worktree/恢复，再附带 `state-files-and-worktrees.md`

## 影响评估

### 正向影响

1. 冷启动更轻
- 每轮不再先 Explore 全套文档

2. router 角色更清晰
- 真正成为 phase 判断的唯一入口

3. 上下文噪音更少
- discovery 轮次不再默认装入 comment/worktree 细则

4. 更符合 GitHub-first
- 先跑 router，再按事实进入对应子流程

5. 更利于后续试运行
- 输出里直接带上 `referencesMustRead`，更容易观察 Agent 是否按 phase 正确补读材料

### 风险与缓解

风险：入口精简后漏掉跨阶段硬规则。
缓解：把这些硬规则直接内联到 `review-agent.prompt.md`，而不是散落在后置文档里。

风险：phase 文档仍隐含依赖“之前已读其他文档”。
缓解：阶段 C 同时检查并收缩各文档职责边界。

风险：新增输出字段后影响现有测试或使用者。
缓解：只新增字段，不删现有字段；补充对应单测与烟测。

## 验收口径

阶段 C 完成后，应满足：

1. 统一入口不再要求冷启动先阅读 discovery/review/comment/state 全套文档。
2. `router` 先运行，再决定 discovery/review。
3. 各 phase 文档能在 phase 已知前提下独立支撑执行。
4. 脚本输出里能明确告诉 Agent 当前必须补读哪些文档。
5. 不因入口精简而丢失跨阶段硬约束。
6. 相关单测与 smoke 命令通过。

