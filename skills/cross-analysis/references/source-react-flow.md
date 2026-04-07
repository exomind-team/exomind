# React Flow

本文件是 `React Flow` 的本地化搜索指南，不是库介绍页摘要。

它的目标是帮助 Agent 在遇到相关目的时，快速判断：

- 这个参考源值不值得纳入交叉分析
- 应该先从哪些入口开始检索
- 哪些主题适合参考它
- 哪些主题不应把它当作主参考

## 适合优先参考的目的

当用户目的涉及以下方向时，优先考虑 `React Flow`：

- React 技术栈下的节点编辑器 / 流程图画布
- DAG / workflow / agent topology / node graph 的前端呈现
- viewport、缩放、平移、fitView、center 等画布交互
- edge / node renderer 的扩展方式
- 自定义节点、自定义边、handle、selection、drag 等交互能力
- hooks / provider / store 风格的画布 API 组织方式
- 如何把布局库、搜索、过滤、状态高亮等能力接到图编辑器上

## 不要把它当成主参考的情况

以下场景里，`React Flow` 通常不应作为唯一主参考：

- 后端图数据库或图计算系统设计
- 非 React 技术栈的画布实现
- 产品级工作流语义与业务规则设计
- 自动布局算法本身的理论或底层实现
- 多人协作协议或实时同步架构

说明：

- 这里写的是“参考价值边界”，不是库优劣判断。
- 对实现问题，`React Flow` 更适合作为“前端画布能力与扩展边界参考”，而不是完整业务产品范式参考。

## 优先检索入口

### 1. 官方产品与文档入口

- 官网 / 文档入口：`https://reactflow.dev/`

适合先回答：

- React Flow 的能力边界是什么
- 官方如何组织 Learn、Examples、API Reference
- 它主要解决的是“图编辑器渲染与交互”还是“完整工作流产品”

优先关注：

- Custom Nodes
- Custom Edges
- Viewport
- Hooks
- Examples
- API Reference

### 2. 学习与指南文档

- Learn / Guides：`https://reactflow.dev/learn`

适合先回答：

- 官方推荐的接入方式是什么
- 常见扩展能力是怎样组织的
- 节点、边、viewport、状态管理在文档里如何分层

如果目的是 `DAG 画布`、`节点编辑器`、`自定义边与节点`、`viewport 交互`，优先检索这些关键词：

- custom nodes
- custom edges
- handles
- viewport
- hooks
- controlled flow
- selection

### 3. API 参考

- API Reference：`https://reactflow.dev/api-reference`

适合先回答：

- 哪些能力是稳定 API
- 哪些交互能力由 hooks / instance helper 提供
- node、edge、viewport、store 的接口边界是什么

### 4. GitHub 源码仓库

优先看这些入口：

- 仓库：`https://github.com/xyflow/xyflow`
- React package 源码：`https://github.com/xyflow/xyflow/tree/main/packages/react`
- React examples：`https://github.com/xyflow/xyflow/tree/main/examples/react`
- system styles / shared internals：`https://github.com/xyflow/xyflow/tree/main/packages/system`

如果目的是：

- 看 hooks / provider / state 组织：先看 `packages/react`
- 看 node / edge / viewport 真实实现：先看 `packages/react/src/components`
- 看交互与扩展接法：先看 `examples/react`
- 看动画 class、基础样式、edge 视觉：先看 `packages/system`

### 5. Playground / 示例集合

- 示例导航：`https://reactflow.dev/examples`

适合先回答：

- 官方最常拿哪些交互模式做示例
- 某个能力是否有现成示例可直接对照
- 是更适合作为“产品灵感”，还是“实现线索”

优先关注这些示例方向：

- Custom Nodes
- Custom Edges
- Dagre / Layouting
- Interaction
- Save and Restore
- UseReactFlow / Viewport helpers

## 面向常见目的的检索路线

### 目的：DAG / workflow / node editor 前端呈现

建议路线：

1. 官网与 Learn 看能力边界
2. Examples 看接近目标形态的交互模式
3. 再去 GitHub 源码确认具体实现位置

重点想确认的问题：

- React Flow 原生支持哪些图编辑器能力
- 哪些东西是内建能力，哪些要靠外部布局或业务逻辑补
- node、edge、viewport 分层是否清晰

### 目的：viewport 交互与画布镜头行为

建议路线：

1. API Reference 看 viewport 相关接口
2. Examples 看 fitView、setCenter、zoom 等示例
3. 源码里确认 helper 与组件边界

重点想确认的问题：

- 视口移动与节点位置是否分离
- fitView / center / zoom 这些动作通过什么 API 提供
- 用户交互、镜头行为、图元真相之间怎样解耦

### 目的：自定义节点 / 边 / renderer 扩展

建议路线：

1. Learn 看 custom nodes / custom edges
2. API Reference 看 Node、Edge、Handle 等接口
3. GitHub 源码看 edge wrapper、node wrapper、styles 与 examples

重点想确认的问题：

- 自定义节点与边的官方扩展面在哪里
- edge / node renderer 与业务数据如何解耦
- 样式、动画、class、交互状态各落在哪一层

## 适合从 React Flow 借鉴什么

通常适合借鉴：

- React 技术栈中的画布能力边界划分
- node / edge / viewport / hooks / instance helper 的清晰分层
- 自定义节点与边的扩展接口设计
- 视口辅助方法与图元真相的分离方式
- 用 examples 组织“功能能力 -> 实现线索”的文档方式

## 不要急着从 React Flow 借鉴什么

通常不要直接从它推导：

- 完整业务工作流产品的领域模型
- 服务端存储与同步策略
- 图算法或自动布局的底层实现
- 大型复杂业务下的所有交互规范
- 非 React 环境下的通用前端架构

## 一句话判断

如果用户目的是：

- “React 技术栈下的 DAG / workflow 画布怎么实现”
- “viewport、节点、边、自定义 renderer 这些能力怎样分层”
- “某个图编辑器能力在源码里大概落在哪”

那么 `React Flow` 应该进入优先参考源集合。
