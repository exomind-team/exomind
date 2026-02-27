# [GH#205-P1] 拆分任务评论

已从 #205 主 PR 中拆分 P1 扩展任务，避免影响 P0 交付节奏。

## P1 任务列表
1. Agent 级健康指标面板（token/cost/latency/heartbeat）
2. 多 RuntimeHost 调度与故障切换
3. 高级信号路由（retry/replay/priority）
4. 多模型路由与成本策略

## 对应计划文档
- `docs/plans/2026-02-27-issue-205-p1-split-plan.md`

## 说明
- #205 主 PR 保持 P0 验收闭环不变。
- P1 在独立 PR 迭代，不与 P0 互相阻塞。
