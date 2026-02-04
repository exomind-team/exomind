# 执行日志

> Ralph Loop 每轮执行记录
> 记录有价值的问题、解决方案、流程优化点

---

## [2026-02-03] Ralph Loop - 重构 CLAUDE.md

### 执行摘要
- **任务**：整合知识库内容，重构 CLAUDE.md
- **结果**：完成 v3.2 版本，明确双轨制 Git 工作流
- **主要变更**：
  - 重写项目概述（认知生命科学原型）
  - Ralph Loop 流程序号理顺（0-12 步）
  - 架构设计 vs 模块规格功能区分
  - 添加架构文档文件夹方案

### 遇到的问题

| 问题 | 原因 | 解决方案 | 优化建议 |
|------|------|----------|----------|
| 流程序号有小数点 | 之前 2.5 步设计 | 改为 0-12 连续整数，第3步为模块规格 | 流程设计避免小数点，保持连续性 |
| 架构与 SPEC 界限不清 | 两者都涉及"设计" | 明确分层：architecture/（整体蓝图） vs specs/（施工图纸） | 文档开头用表格明确范围差异 |
| Git 工作流描述分散 | 多处提到提交 | 整合为"双轨制 Git 工作流"独立章节 | 复杂流程单独成章，避免重复 |

### 流程优化点

- [x] 大重构先用 agent-output 生成草稿，确认后再替换
- [x] 目录结构变化需在流程中明确说明
- [ ] 下次复杂修改先做结构大纲，再填充内容

### 有价值发现

1. **双轨制 Git 工作流**
   - Draft PR：创建分支即提，AI 自转，人类可见进度
   - 正式 PR：功能完成，请求人类审查
   - 人工合并：只有人类能点 merge，掌握最终决策权

2. **架构文档分层方案**
   ```
   docs/
   ├── architecture/     # 系统蓝图（整体怎么搭）
   │   ├── 7-LAYER.md
   │   └── DECISIONS/    # 架构决策记录 ADR
   └── specs/            # 施工图纸（模块怎么做）
       └── SPEC-XXX.md
   ```

3. **知识点管理**：需要单独维护可检索的经验库

---

## [2026-02-04] Ralph Loop - 移动端 WebSocket 客户端 + 多端消息同步

### 执行摘要
- **任务**：实现移动端 WebSocket 客户端 + 聊天 UI，实现完整的多端消息同步功能
- **结果**：完成 PR #10，提交 97 文件变更，+14,847 / -2,887 行代码
- **主要变更**：
  - 聊天 UI（ChatWindow、DevicePanel、MessageList）
  - WebSocket 客户端命令（ws_connect, ws_send, ws_disconnect）
  - 消息持久化（append_file, read_file）
  - 设备配对系统（generate_pairing_code, confirm_pairing）
  - 本地 IP 获取（原生 UDP Socket，排除 VPN）
  - GitHub Actions CI/CD（build/* / release/* tag 触发）

### 遇到的问题

| 问题 | 原因 | 解决方案 | 优化建议 |
|------|------|----------|----------|
| local-ip-address crate 返回 VPN IP | 198.18.x.x 是 TUN 虚拟接口 | 使用原生 UDP Socket 方案，添加 198.18.x.x 过滤 | 验证阶段用独立 test_ip.rs 测试 |
| GitHub Actions build-android 失败 | 缺少 bun 安装 | 添加 oven-sh/setup-bun@v1 | CI 脚本需要完整验证 |
| GitHub Actions build-windows 失败 | actions/setup-rust@v1 不存在 | 改用 dtolnay/rust-toolchain@stable | 使用官方推荐的 Action |
| Android tauri android init 缺失 | Android 项目未初始化 | 添加 tauri android init 步骤 | Android 构建需要完整流程 |
| TypeScript ViewType 类型错误 | switch 语句用了 'profile' 但类型只有 4 个值 | 移除 'profile' case | 保持类型定义与使用一致 |

### 有价值发现

1. **Tauri 命令设计模式**
   ```
   #[tauri::command]
   async fn ws_connect(url: String) -> Result<String, String>
   ```
   - 返回 Result<T, String>，错误信息用中文
   - 前端通过 invoke() 调用，Promise 包装

2. **原生 UDP 获取本机 IP**
   ```rust
   let socket = UdpSocket::bind(("0.0.0.0", port))?;
   socket.connect("8.8.8.8:53")?;
   let local_addr = socket.local_addr()?;
   // 排除 VPN (198.18.x.x) 和回环 (127.x.x.x)
   ```

3. **CI/CD Tag 触发规范**
   - `build/*` = 只构建，产出 Artifact
   - `release/*` = 构建 + GitHub Release
   - 使用 6 位 commit hash 区分版本

4. **文档更新计划**
   - API.md: 完整命令参考
   - README.md: 功能特性 + CI/CD 说明
   - BUILD.md: 本地构建 + GitHub Actions 流程

### 流程优化点

- [x] 文档更新与代码实现同步进行
- [x] 使用独立 Rust 测试程序验证 IP 获取逻辑
- [x] PR 保持 Draft 状态便于查看进度

### 待归档知识点

- [ ] GitHub Actions 工作流设计
- [ ] Tauri Android CI 构建流程
- [ ] 本地优先架构设计模式

---

## [2026-02-04] Phase 1 Round 1 - P2P 设置页面基础配置

### 执行摘要
- **任务**：初始化 shadcn/ui + Tailwind CSS + utils.ts
- **结果**：完成配置，17 测试通过
- **主要变更**：
  - 添加 clsx, tailwind-merge, autoprefixer 依赖
  - 创建 src/lib/utils.ts (cn 函数)
  - 创建 tailwind.config.js (Tailwind 配置)
  - 创建 src/index.css (CSS 变量)
  - 创建 components.json (shadcn 配置)
  - 创建 postcss.config.js (PostCSS 配置)
  - 更新 tsconfig.json paths 别名配置

### 遇到的问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 测试报错 Cannot find module '@/lib/utils' | tsconfig.json 未配置 paths 别名 | 添加 "paths": {"@/*": ["src/*"]} 配置 |
| tailwind.config.js 缺少 components 路径 | content 数组缺少 components 路径 | 添加 "./components/**/*.{js,ts,jsx,tsx}" |
| shadcn components.json tailwind 配置格式 | 期望布尔值，实际是对象 | 更新测试验证 config/css 属性 |
| PostCSS 缺失 | Tailwind 需要 PostCSS 处理 | 创建 postcss.config.js |

### 测试结果
- ✅ cn.test.ts: 5 pass / 0 fail
- ✅ tailwind-config.test.ts: 3 pass / 0 fail
- ✅ css-variables.test.ts: 5 pass / 0 fail
- ✅ components.test.ts: 4 pass / 0 fail
- **总计**: 17 pass / 0 fail

### 有价值发现
1. **TDD 流程**：先写测试（红）→ 写代码（绿）→ 运行验证
2. **路径别名**：Vite 已配置 @ 别名，需同步更新 tsconfig.json
3. **shadcn 配置**：tailwind 配置在 JSON 中是对象格式 `{config: ..., css: ...}`
4. **PostCSS 必需**：Tailwind CSS 需要 postcss.config.js + autoprefixer

### Round 1 完成文件清单
| 文件 | 类型 | 说明 |
|------|------|------|
| `src/lib/utils.ts` | 新建 | cn() 函数 |
| `tailwind.config.js` | 新建 | Tailwind 配置 |
| `src/index.css` | 新建 | CSS 变量 |
| `components.json` | 新建 | shadcn 配置 |
| `postcss.config.js` | 新建 | PostCSS 配置 |
| `tsconfig.json` | 修改 | 添加 paths 别名 |
| `package.json` | 修改 | 添加依赖 |
| `tests/unit/utils/cn.test.ts` | 新建 | cn 函数测试 |
| `tests/unit/ui/tailwind-config.test.ts` | 新建 | Tailwind 配置测试 |
| `tests/unit/ui/css-variables.test.ts` | 新建 | CSS 变量测试 |
| `tests/unit/shadcn/components.test.ts` | 新建 | shadcn 配置测试 |

---

## [2026-02-04] Phase 1 Round 2 - shadcn 组件手动创建

### 执行摘要
- **任务**：手动创建 10 个 shadcn/ui 基础组件
- **结果**：完成，10 测试通过
- **主要变更**：
  - 手动创建组件（避免 shadcn CLI 配置冲突）
  - Button, Card, Input, Switch, Label, Tabs, Badge, Dialog, Toast, Avatar
  - 添加 Radix UI primitives 和 class-variance-authority 依赖

### 遇到的问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| shadcn CLI 报错 Invalid configuration | components.json 格式与 CLI 期望不一致 | 改为手动复制组件源码 |
| React.forwardRef 返回对象而非函数 | 测试期望 typeof === 'function' | 改为检查 displayName 属性 |
| Toast/Toaster 分散在多个文件 | 组件分布在 toast.tsx, toaster.tsx, toast-hook.tsx | 创建 index.ts 统一导出 |

### 测试结果
- ✅ components.test.ts: 10 pass / 0 fail
- **总计**: 10 pass / 0 fail

### 有价值发现
1. **Radix UI primitives**：无头组件，只提供交互逻辑，所有样式由 Tailwind CSS 定制
2. **class-variance-authority (cva)**：用于管理组件 variant（default/destructive/outline 等）
3. **手动复制 vs CLI 安装**：复制方式让我们完全掌控组件代码，便于定制和调试

### Round 2 完成文件清单
| 文件 | 类型 | 说明 |
|------|------|------|
| `src/components/ui/button.tsx` | 新建 | Button 组件 (cva + Slot) |
| `src/components/ui/card.tsx` | 新建 | Card 组件系列 |
| `src/components/ui/input.tsx` | 新建 | Input 组件 |
| `src/components/ui/switch.tsx` | 新建 | Switch (Radix) |
| `src/components/ui/label.tsx` | 新建 | Label (Radix + cva) |
| `src/components/ui/tabs.tsx` | 新建 | Tabs (Radix) |
| `src/components/ui/badge.tsx` | 新建 | Badge (cva variants) |
| `src/components/ui/dialog.tsx` | 新建 | Dialog (Radix + lucide) |
| `src/components/ui/toast.tsx` | 新建 | Toast (Radix) |
| `src/components/ui/toast-hook.tsx` | 新建 | useToast hook |
| `src/components/ui/toaster.tsx` | 新建 | Toaster 组件 |
| `src/components/ui/avatar.tsx` | 新建 | Avatar 组件 |
| `src/components/ui/index.ts` | 新建 | 统一导出入口 |
| `tests/unit/ui/components.test.ts` | 新建 | 组件导入测试 |

---

*格式模板：时间、摘要、问题表、测试结果、发现*
