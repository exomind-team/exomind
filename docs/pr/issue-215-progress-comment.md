# GH#215 进展同步（Me 三视图）

## 已完成
- 新增 `Me` 领域模型与契约  
  - `src/lib/types/me.ts`  
  - `src/lib/environment/interfaces/me.port.ts`  
  - `src/lib/adapters/mock/fixtures/me.ts`
- 新增 Adapter 并接入运行时注入  
  - `src/lib/adapters/me-web-adapter.ts`  
  - `src/lib/adapters/mock/me-mock-adapter.ts`  
  - `src/lib/environment/bootstrap.ts`（新增 `me` 注入）  
  - `src/lib/environment/environment.ts`（Environment 能力新增 `me`）
- 新增 Service  
  - `src/lib/services/me.service.ts`  
  - `src/lib/services/index.ts`（导出 `getMeService`）
- 完成 UI 与路由  
  - `src/ui/new/pages/NewMePage.tsx`  
  - `src/routes-new.tsx`（新增 `/me`，底部导航新增 `Me`，图标 `UserRound`）
- 自动化测试  
  - 单测：
    - `tests/unit/me/me-types-contract.issue215.test.ts`
    - `tests/unit/services/me.service.issue215.test.ts`
    - `tests/unit/ui/me-pages.issue215.test.tsx`
    - `tests/unit/ui/me-routing.issue215.test.ts`
    - `tests/unit/environment/bootstrap.test.ts`（扩展 me 注入断言）
  - E2E：
    - `tests/e2e/me-ui.issue215.test.ts`
    - `tests/e2e/playwright.issue215.config.ts`
    - `package.json` 新增脚本 `test:e2e:issue215`

## 端口约束
- 本工作区自动化测试 Web 端口已固定为 `1423`。  
- Playwright 配置已设置 `WEB_PORT=1423`，并支持复用当前工作区在 1423 运行的 Vite 服务（`reuseExistingServer: true`）。

## 测试证据
```bash
bunx vitest run tests/unit/me/me-types-contract.issue215.test.ts tests/unit/environment/bootstrap.test.ts tests/unit/services/me.service.issue215.test.ts tests/unit/ui/me-pages.issue215.test.tsx tests/unit/ui/me-routing.issue215.test.ts
# 结果：5 files / 13 tests 全部通过

bun run test:e2e:issue215
# 结果：2 passed（chromium）

bun run build
# 结果：构建成功（仅有既有 chunk 警告）
```

