# [GH#245f] M2 代码评审结果（人工 Review）

评审范围：`origin/vk/245f-m2-agent-hub-rea..HEAD`  
BASE: `57bb4b09fb7fb9ac8dd97d1a47d745371e46ce6f`  
HEAD: `8b923bf58cfd9522d8d09565f499d14f1ad34cc7`

## Findings（按严重度）

### 1. Minor: 拖拽位置会在轮询刷新后回到布局初始值
- severity: Minor
- file:line:
  - `src/ui/app/pages/AgentsPage.tsx:1141`（8s 轮询刷新）
  - `src/ui/app/pages/AgentsPage.tsx:1247`（`buildSignalGraph` 重新生成节点）
  - `src/ui/app/pages/AgentsPage.tsx:312`（`setFlowNodes(nextFlowNodes)` 覆盖当前位置）
- evidence:
  - 轮询会刷新 runtime snapshot 与 signal routes；
  - `TopologyView` 每次接收新 `graph.nodes` 后会把 `flowNodes` 重置为生成布局，用户拖拽位置不持久。
- recommendation:
  - 若产品希望“拖拽后保持布局”，建议引入 `positionByNodeId`（内存或本地存储）并在构图时合并已有位置；
  - 或仅在节点集合发生增删时重置，而不是每次轮询都重置。

### 2. Minor: E2E 对“节点可拖拽”的断言当前是能力断言而非位移断言
- severity: Minor
- file:line:
  - `tests/e2e/agent-hub.signal-routes.issue245f.test.ts:198`
- evidence:
  - 当前断言为 `toHaveClass(/draggable/)`，可证明节点具备拖拽能力标记，但未验证位移结果。
- recommendation:
  - 后续可在 React Flow 上暴露 `onNodeDragStop` 事件状态，或读取节点 transform/position 做强位移断言，进一步提高交互验收强度。

## 结论
- 无阻塞问题（No blocking issues）
- 合并建议：`ready`

## 评审说明
- 本次为实现后独立人工评审，重点检查功能正确性、回归风险和测试覆盖缺口。
- 已结合自动化验证结果（unit/e2e/tsc/build）进行交叉确认。
