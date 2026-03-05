# [GH#245f] M2 Sub-Agent 评审结果（Superpowers Code Review）

评审方式：
- 子代理（Sub-agent）: Claude Sonnet（superpowers code-reviewer）
- 评审范围（Review range）: `4008cafaa99f1dea079ae805105eafe6672aaef4..5c9e0c6c09a56304aa427a6a911a932c08ef9c41`
- 评审重点：Signal routes 列表、React Flow 拓扑、暗色适配、runtime/mock fallback、测试覆盖

## Strengths（优点）

1. 图构建逻辑纯函数化清晰：`buildSignalGraph` / `buildSignalRouteRows` 与 UI 解耦，便于测试与复用。  
2. 回退链路完整：`useMockData -> configured host -> direct runtime candidates`，无 runtime 时仍有可视化结果。  
3. 测试覆盖全面：单测覆盖聚合逻辑边界，E2E 覆盖桌面/移动/暗色/mock fallback/直连 fallback。  
4. 旧拓扑硬编码清理干净：静态布局常量与废弃节点绘制逻辑已移除。  
5. 异步安全处理到位：关键异步刷新流程包含 `isDisposed` 守卫，避免卸载后 setState。  

## Issues（问题）

### Important

1. 暗色模式切换响应性不足（Theme switching not reactive）
- 文件：`src/ui/app/pages/AgentsPage.tsx`
- 问题：`isDarkMode` 通过 `documentElement.classList.contains('dark')` 快照读取，主题切换后颜色可能不立即更新。
- 建议：接入现有主题状态（theme store/context）或监听 class 变化触发重渲染。

2. `RuntimeClient` 生命周期管理可加强（Client lifecycle）
- 文件：`src/ui/app/pages/AgentsPage.tsx`
- 问题：`tryLoadRoutesFromHost` 每次都创建 `new RuntimeClient()`；若内部有长连接/计时器，存在资源浪费风险。
- 建议：确认 `RuntimeClient` 是否无状态；若非无状态，改为组件级单例并在卸载时清理。

3. 直连端口探测串行执行（Sequential probing latency）
- 文件：`src/ui/app/pages/AgentsPage.tsx`
- 问题：候选 host 串行探测在超时场景下会拉长首屏等待。
- 建议：并行探测（`Promise.allSettled` / `Promise.race`）并加短超时（如 1~1.5s）。

### Minor

1. 测试路由样例在多个文件重复，建议提取到共享 fixture。  
2. `@xyflow/react` mock 在两个单测文件中重复，建议统一 mock 模块。  
3. 个别测试缩进风格不一致，可顺手格式化。  
4. `proOptions={{ hideAttribution: true }}` 需确认许可合规（License compliance）。  
5. 节点色值常量有分散定义，可集中到统一常量表。  

## Assessment（结论）

- Blocking issues: 无（None）
- Merge readiness: **Yes, with follow-up fixes（可合并，建议跟进修复）**
- 评审结论：本次 M2 目标已满足，建议保留后续 follow-up issue 跟进上述 Important 项（优先 I-1、I-3）。
