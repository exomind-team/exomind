# GH#252 进展追加（桌面适配开关 + V-C 中间菜单）

本轮在既有 PR 基础上继续完成两项：

1. **新增桌面端适配开关（desktop adaptive toggle，桌面适配开关）**
   - 配置模块：`src/config/desktop-adaptive.ts`
   - 设置页入口：`功能开关` 抽屉新增 `桌面端适配` 开关
   - 行为：关闭后即使在桌面宽度也回退到移动壳层；开启后恢复桌面设置壳层

2. **中间菜单对齐 Pencil 的 `V-C 分段大卡片式`**
   - 文件：`src/routes-new.tsx`
   - 将中间菜单改为“分组标题 + 大卡片分段项”结构
   - 增加测试标识：`desktop-settings-nav-vc`、`desktop-settings-nav-card`

## 自动化验证

```bash
bunx vitest run tests/unit/ui/new-desktop-settings-shell.issue198.test.ts tests/unit/components/settings/DesktopAdaptiveToggle.test.tsx
# 结果：2 files / 6 tests passed

bunx vitest run tests/unit/components/settings/DeveloperSection.test.tsx tests/unit/ui/new-desktop-settings-shell.issue198.test.ts tests/unit/components/settings/DesktopAdaptiveToggle.test.tsx
# 结果：3 files / 12 tests passed

bun run test:e2e:issue198
# 结果：3 passed（新增“桌面适配开关回退移动壳层”场景）

bun run build
# 结果：构建成功（仅既有 warning）
```
