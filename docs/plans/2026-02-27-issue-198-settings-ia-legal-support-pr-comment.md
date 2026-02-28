# Issue #198 - 设置页 IA 调整（一级关于 + 二级法律与支持）执行记录

## 1. 已批准方案（Plan）
- 桌面端保持 `Sidebar`，设置页保持分段大卡片结构。
- 一级 `关于` 仅保留轻入口：`官网`、`赞助开发者`、`法律与支持` 入口。
- `帮助中心`、`反馈建议` 放在 `更多`（非法律页）。
- 新增二级页 `/settings/legal-support`。
- 二级页仅保留法务三项：`用户协议`、`隐私政策`、`开源声明`。

## 2. TDD 执行链路
- RED（先失败）：
  - 新增/调整单测与 E2E 断言，覆盖 IA 迁移边界。
  - 先运行确认失败（含 Playwright 的二级页路由失败）。
- GREEN（最小实现）：
  - 新增 `LegalSupportPage` 与路由。
  - 重排 `NewSettingsPage` 关于分段。
  - `LegalSection` 收敛到法务三项。
  - `MoreSection` 补入帮助与反馈。
- REFACTOR：
  - 路由壳层统一 `/settings/*` 在桌面端保持 Desktop Layout。

## 3. 代码变更摘要
- `src/ui/new/pages/LegalSupportPage.tsx`
  - 新增二级“法律与支持”页面。
- `src/routes-new.tsx`
  - 新增 `/settings/legal-support` 路由。
  - 桌面设置壳层判断由 `=== '/settings'` 扩展为 `startsWith('/settings/')`。
  - 桌面侧栏与移动底部导航对 `/settings/*` 保持设置态。
- `src/ui/new/pages/NewSettingsPage.tsx`
  - 一级关于改为轻入口（官网/赞助/法律与支持）。
  - 移除一级页直出的法务三项。
- `src/ui/new/components/LegalSection.tsx`
  - 仅保留 `隐私政策` / `用户协议` / `开源软件使用声明`。
- `src/ui/new/components/MoreSection.tsx`
  - 增加 `帮助中心` / `反馈建议`。

## 4. Pencil 同步结论
- 使用 Pencil MCP 核验：当前 `pencil/eventlog-ui-design.pen` 已满足目标结构。
- 关键节点截图核验：
  - `RKpX0`：关于卡片为帮助/反馈/官网/赞助/法律与支持入口。
  - `YfVDQ`：独立“法律与支持”桌面页，且仅法务三项。
- 本次分支内 `.pen` 文件无新增差异（结构已对齐）。

## 5. 测试与构建证据
```bash
bunx vitest run tests/unit/components/settings/LegalSection.test.tsx tests/unit/components/settings/MoreSection.test.tsx tests/unit/settings/new-settings-desktop-vc-tabs.issue198.test.tsx tests/unit/ui/new-desktop-settings-shell.issue198.test.ts
# 结果：4 files passed, 16 tests passed

bun run test:e2e:issue198
# 结果：5 passed

bun run build
# 结果：build 成功（存在既有 chunk/warning，无新增阻塞错误）
```

## 6. 提交记录（本轮）
- `4c389f1` docs: add issue198 settings IA refinement plan
- `f3c95de` test: add failing tests for settings legal-support IA
- `440f6cb` feat: add legal-support subpage and refine settings IA

## 7. 评审结论（Review）
- 结论：通过（Ready for review）
- 未发现阻塞项（blocking issue）。
- 残余风险：
  - “赞助开发者”当前仍为 `Coming soon` 占位，后续可替换为真实目标链接。
