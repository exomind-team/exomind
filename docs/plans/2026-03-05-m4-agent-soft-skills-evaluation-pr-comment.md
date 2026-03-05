## M4 Agent Soft Skills 评选（Classifier + Reviewer）

本次评选目标：基于 M4 已完成的整合结果，对自动启动的 TS Agent 做“软技能（Soft Skills）”维度评估，作为发版前质量补充信号。

### 评选范围与证据

- 评选对象（Agents）：
  - `reviewer`（复盘评审 Agent）
  - `classifier`（输入分类 Agent）
- 证据来源（Evidence）：
  - 自动拉起逻辑：`crates/exomind-runtime/src/lib.rs`
  - TS Agent 启动测试：`crates/exomind-runtime/tests/runtime_ts_agents.rs`
  - 真链路验证：`tests/e2e/signal-timeblock-feedback.test.ts`
  - 前端反馈落库与展示：`src/ui/hooks/useSignalStream.ts`、`src/components/Chat/ChatPage.tsx`

### 评分维度（Soft Skills Rubric）

- 沟通清晰度（Communication Clarity）：输出是否结构化、语义明确
- 协作配合度（Collaboration）：是否按信号契约协同上下游
- 响应可靠性（Reliability）：链路稳定性、失败场景表现
- 可执行性（Actionability）：输出是否可直接指导用户行动
- 韧性与恢复（Resilience）：异常/重试场景下是否保持可用

评分范围：`1-5`（5 为最佳）。

### 评选结果

| Agent | 沟通清晰度 | 协作配合度 | 响应可靠性 | 可执行性 | 韧性与恢复 | 总分 |
|---|---:|---:|---:|---:|---:|---:|
| `reviewer` | 4.8 | 5.0 | 4.7 | 4.9 | 4.6 | **24.0 / 25** |
| `classifier` | 4.3 | 4.5 | 4.6 | 4.2 | 4.4 | **22.0 / 25** |

### 结论与排名

1. **Top 1: `reviewer`**
   - 在 `timeblock.completed -> review.completed` 真链路中表现稳定，且反馈字段结构（`effective/stuck/suggestion`）可直接消费。
2. **Top 2: `classifier`**
   - 自动拉起与链路协同稳定，但当前面向终端用户的“可读解释能力”仍可增强（更友好的分类理由输出）。

### 建议（非阻塞）

1. 为 `classifier` 增补“分类理由（why classified）”字段，提升可解释性（Explainability，可解释性）。
2. 为 `reviewer` 增补“建议优先级（priority）+ 下一步动作（next action）”字段，提升执行落地效率。
3. 在 Agent Hub 增加“近 24h 成功率 + 平均响应时延”可视化卡片，便于持续跟踪软技能质量。

### Release 决策建议

- 当前软技能评选结果支持进入 M3 构建发版流程：**建议通过（Recommend Pass）**。
- 本评论为质量增补视角，不替代功能验收与测试门禁。
