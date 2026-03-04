# [GH#245f] Follow-up 修复评审结果（人工 Review）

评审范围：`origin/vk/245f-m2-agent-hub-rea..HEAD`  
重点：暗色模式拓扑可见性、MiniMap 关闭、无 host 回退链路、1950 端口可用性

## Findings（按严重度）

### 1. Minor: 直连回退会增加一次轮询期探测流量
- severity: Minor
- files:
  - `src/ui/app/pages/AgentsPage.tsx`
- detail:
  - 当没有已保存 runtime host 且未开启 mock 时，会按候选端口探测 `/signal-routes`；
  - 当前轮询周期 8s，探测请求会重复发生（直到用户配置 host 或端口可达）。
- risk:
  - 开发环境网络日志噪音增加，但不影响功能正确性。
- recommendation:
  - 后续可增加“探测冷却窗口（cooldown）”或“成功后持久化 host”减少重复探测。

## 结论

- Blocking issues: 无
- Functional result: 满足本轮反馈项（暗色适配、MiniMap 关闭、空白回退修复）
- Merge readiness: 代码可用，但按需求保持 Draft，待人工复测通过后再转 Ready
