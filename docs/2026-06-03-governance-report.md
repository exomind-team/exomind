# ExoMind 仓库治理规则报告

> **调查日期**：2026-06-03
> **仓库**：exomind-team/exomind（dev 分支）

---

## 1. Git Hooks（本地提交钩子）

### 当前状态：**无本地 Git Hooks**

- `.husky/` 目录不存在
- `package.json` 中无 `lint-staged`、`commitlint`、`husky` 相关配置
- `pre-commit`、`commit-msg`、`pre-push` 等钩子均未配置

**结论**：开发者在本地提交时没有任何自动化检查（代码格式、commit message 格式、测试等）。所有质量门禁完全依赖 CI 流水线。

---

## 2. Branch Protection（分支保护规则）

### 当前状态：**main 分支无保护规则**

通过 GitHub API 查询 `repos/{owner}/{repo}/branches/main/protection` 返回 404：

```json
{"message":"Branch not protected","status":"404"}
```

**这意味着**：
- 任何人都可以直接 push 到 `main` 分支
- 不要求 PR review
- 不要求 CI 检查通过
- 不要求线性历史
- 不限制 force push
- 不限制删除分支

**建议**：至少为 `main` 分支启用：
- 要求 PR review（至少 1 人）
- 要求 status checks 通过
- 限制 force push
- 限制分支删除

---

## 3. CI/CD Pipeline（GitHub Actions）

### 3.1 工作流文件列表

| 文件 | 触发条件 | 用途 |
|------|----------|------|
| `release.yml` | push to main/dev, workflow_dispatch, tag push | 全量构建（Rust + Tauri + Web），生成 release artifacts |
| `release-pages.yml` | push to main/dev, workflow_dispatch | 构建并部署 devlog 到 GitHub Pages |
| `pr-review.yml` | pull_request | PR 审查自动化 |
| `runtime-ci.yml` | push to main/dev | Rust Runtime CI（cargo check/test） |
| `website-tests.yml` | push to main/dev | Website 测试 |

### 3.2 CI 检查项

| 检查项 | 工作流 | 说明 |
|--------|--------|------|
| Rust 编译检查 | `runtime-ci.yml` | `cargo check` + `cargo test` |
| TypeScript 类型检查 | `release.yml` | `tsc --noEmit` |
| Vite 构建 | `release.yml` | `vite build` |
| Playwright E2E 测试 | `release.yml` | 多个 issue-specific 测试配置 |
| Website 测试 | `website-tests.yml` | Website 相关测试 |
| Release 版本检查 | `release.yml` | 版本号一致性验证 |
| Android 元数据检查 | `release.yml` | `check:android:meta` |

### 3.3 触发分支

- `main` 和 `dev` 分支 push 触发 CI
- PR 触发 `pr-review.yml`
- Tag push 触发 release 构建

---

## 4. PR 模板

**文件**：`.github/pull_request_template.md`

模板内容包含：
- 变更说明
- 关联 Issue
- 测试计划
- 检查清单

---

## 5. Issue 模板

**目录**：`.github/ISSUE_TEMPLATE/`

---

## 6. 代码质量工具

### 当前状态：**无本地自动化**

- 无 `.editorconfig`
- 无 `.prettierrc` / `.eslintrc`（在 package.json 中也未找到）
- 无 `rustfmt.toml` / `clippy.toml`
- 无 `lint-staged` 配置
- 无 `commitlint` 配置

### 代码格式化

Rust 代码格式化依赖开发者自觉使用 `cargo fmt`，无 pre-commit 钩子强制执行。

---

## 7. 发布流程

### 7.1 版本管理

- 当前版本：`0.4.15`
- 版本号在 `package.json` 和 `src-tauri/Cargo.toml` 中同步
- CI 中有版本一致性检查脚本

### 7.2 Release 流程

1. 开发者 push 到 `main` 或 `dev`
2. `release.yml` 自动构建所有平台 artifacts
3. `release-pages.yml` 更新 GitHub Pages 上的 devlog
4. Tag push 触发正式 release 构建

---

## 8. 问题总结与建议

### 当前缺失

| 优先级 | 缺失项 | 影响 |
|--------|--------|------|
| **高** | main 分支无保护规则 | 任何人都可以直接 push 到 main，绕过 review |
| **高** | 无本地 Git hooks | 开发者提交前无自动化检查 |
| **中** | 无 commitlint | commit message 格式不统一 |
| **中** | 无 lint-staged | 提交时未运行 lint/format |
| **低** | 无 .editorconfig | 编辑器配置不统一 |

### 建议改进

1. **启用分支保护**（GitHub Settings）：
   - 要求至少 1 人 review
   - 要求 CI 检查通过
   - 限制 force push
   - 限制直接 push 到 main

2. **添加 Git Hooks**（可通过 husky 或 lefthook）：
   - `pre-commit`：运行 lint-staged（Rust fmt + TypeScript lint）
   - `commit-msg`：运行 commitlint（Conventional Commits 格式）
   - `pre-push`：运行测试

3. **添加代码格式化工具**：
   - `.editorconfig` 统一编辑器配置
   - `rustfmt.toml` 配置 Rust 格式化规则
   - ESLint/Prettier 配置 TypeScript 格式化

4. **统一 Commit Message 格式**：
   - 采用 Conventional Commits 规范
   - 添加 commitlint 配置

---

## 9. 当前工作流的优势

尽管本地钩子缺失，项目仍有以下优势：

1. **CI 覆盖全面**：Rust 编译、TypeScript 类型检查、E2E 测试、构建验证
2. **PR 模板存在**：引导开发者提供变更说明和测试计划
3. **自动化发布**：CI 自动生成 release artifacts 和 devlog
4. **多平台支持**：CI 构建 Windows、macOS、Linux、Android 产物

---

*报告生成工具：Claude Code (glm-5.1)*
*数据来源：GitHub API + 本地代码库分析*
