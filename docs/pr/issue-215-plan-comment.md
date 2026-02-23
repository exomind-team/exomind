# GH#215 实施计划（已落地）

## 目标
- 基于新 UI 增加 `Me` 页面，支持三视图：`状态(Status)` / `学习(Learn)` / `内隐(Implicit)`。
- 补齐 `Me` 领域 mock 架构：`types + port + adapter + service + fixtures`。
- `bootstrap` 按 `useMockData` 注入 `MeMockAdapter` / `MeWebAdapter`。
- 完成自动化测试：Vitest + Playwright（本工作区 Web 端口固定 `1423`）。

## 验收链路
1. 单测：领域契约、bootstrap 注入、service 行为、页面交互、路由接线。  
2. E2E：`/me` 默认状态页展示，切换到学习/内隐，底部导航跳转到 Me。  
3. 构建：`bun run build` 通过。  

## TDD 顺序
1. 先写失败测试：`tests/unit/me/me-types-contract.issue215.test.ts`。  
2. 再补 `me.ts`、`IMePort`、fixtures。  
3. 继续失败测试：bootstrap/service/UI/routing。  
4. 最后补 E2E 配置与脚本并通过。  

