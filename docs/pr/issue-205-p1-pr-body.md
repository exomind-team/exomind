# [GH#205-P1] Agent Hub 扩展能力拆分（独立 PR）

## 背景
当前 #205 主 PR 已按 P0 收敛为“真实可验收闭环”（真实信号读写、真实对话、真实在线状态）。
为避免主 PR 范围膨胀，将后续扩展能力拆分为 P1 独立 PR。

## P1 范围
1. Agent 级健康指标面板（token/cost/latency/heartbeat）。
2. 多 RuntimeHost 调度与故障切换（failover）。
3. 高级信号路由策略（retry/replay/priority）。
4. 多模型路由与成本策略。

## 不在本 PR
- 不改 P0 验收定义。
- 不引入与 P0 无关 UI 重构。

## 计划文档
- `docs/plans/2026-02-27-issue-205-p1-split-plan.md`

## 验证要求
- Unit + 必要 E2E 通过。
- `bun run build` 通过。

## 关联
- 主线 PR（P0）：#251
- 关联 Issue：#205
