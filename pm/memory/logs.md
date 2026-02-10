# 执行日志

> Ralph Loop 每轮执行记录
> 记录有价值的问题、解决方案、流程优化点

---

## [2026-02-09] ExoMind Web 端功能集成

### 执行摘要
- **任务**：时间块功能 Web 端适配 + 语音输入组件化
- **结果**：全部完成
- **主要变更**：
  - 添加 `/timeblock` 路由，移除 `/test/record`
  - 侧边栏"记录"移至第2位
  - 创建 `VoiceMessageInput` 通用组件
  - 替换 ChatPage 和 RecordPage 输入框

### 遇到的问题

| 问题 | 原因 | 解决方案 | 优化建议 |
|------|------|----------|----------|
| RecordPage 状态同步 | VoiceMessageInput 内部管理 inputValue | 使用 useRef 跟踪输入值，onVoiceResult 回调同步 | 组件设计时考虑外部状态同步需求 |
| Playwright 检测 | 组件编译后无 HTML 标记 | 通过 input 元素存在性验证 | 验证组件时检查功能而非 DOM 标记 |

### 有价值发现

1. **两步走战略有效**
   - 第一步：路由适配（快速验证）
   - 第二步：组件抽象（复用提升）
   - 每步独立提交，便于回滚

2. **语音输入组件设计**
   ```
   VoiceMessageInput
   ├── Input（文本输入）
   ├── SendButton（发送）
   └── VoiceInputButton（语音）
   ```
   - Props 最小化设计
   - 支持 ASR 适配器注入
   - onVoiceResult 回调支持标签同步

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

---

## [2026-02-04] Phase 1 Round 3-5 - 路由系统 + 布局 + P2P 设置页面

### 执行摘要
- **任务**：@tanstack/react-router 路由、侧边栏布局、P2P 设置页面
- **结果**：全部完成，49 测试通过
- **主要变更**：
  - @tanstack/react-router 路由系统
  - Layout 组件（Sidebar + 主布局）
  - P2PSettings 页面（设备/配对/连接 三个 Tab）

### 遇到的问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 路由导入路径错误 | routeTree.tsx 在 src/ 而非 src/routes/ | 修复测试导入路径为 @/routeTree |
| 路由树导出格式 | routeTree 导出多个对象而非单一 named export | 修改测试验证多个导出 |

### 测试结果
- ✅ routes.test.ts: 10 pass
- ✅ Layout.test.ts: 5 pass
- ✅ Settings.test.ts: 7 pass
- **总计**: 22 pass / 0 fail（新增）

### 有价值发现
1. **@tanstack/react-router 文件路由**：`createFileRoute("/")` 自动映射文件路径
2. **路由树结构**：`rootRoute.addChildren([...])` 构建树形结构，支持嵌套
3. **Tab 组织页面**：使用 Tabs 将复杂页面分为多个逻辑区域

### 完成文件清单
| 文件 | 类型 | 说明 |
|------|------|------|
| `src/routes.ts` | 新建 | 路由根配置 + RouterProvider |
| `src/routeTree.tsx` | 新建 | 路由树导出 |
| `src/routes/index.tsx` | 新建 | 首页路由 |
| `src/routes/settings.tsx` | 新建 | 设置页路由 |
| `src/components/Layout/Layout.tsx` | 新建 | 侧边栏布局 |
| `src/components/Settings/P2PSettings.tsx` | 新建 | P2P 设置主页 |
| `src/components/Settings/DeviceList.tsx` | 新建 | 设备列表组件 |
| `src/components/Settings/PairingCode.tsx` | 新建 | 配对码组件 |
| `tests/routes.test.ts` | 新建 | 路由测试 |
| `tests/Layout.test.ts` | 新建 | 布局测试 |
| `tests/Settings.test.ts` | 新建 | 设置页面测试 |

---

## [2026-02-08] exomind-refactor 团队 - 模块重构 + 测试 + 移动端适配

### 执行摘要
- **任务**：重构 4 个核心模块 + E2E 测试 + MVP 程序验证 + 移动端适配
- **结果**：全部完成
- **主要变更**：
  - FileStorage 模块重构（抽象存储接口 + 统一错误处理）
  - P2P Connection 模块重构（连接状态追踪 + libp2p 架构）
  - WebSocket 模块重构（重连机制 + 消息队列）
  - Device Pairing 模块重构（流程标准化 + 超时处理）
  - E2E 测试 4/4 通过
  - MVP 程序 35/35 测试通过
  - 移动端响应式布局适配

### 团队成员
| 角色 | 职责 |
|------|------|
| teammate-1 | 架构设计、类型定义 |
| teammate-2 | 状态管理、数据存储 |
| teammate-3 | UI 组件、样式 |
| teammate-4 | 测试、验证、自动化 |

### 完成的任务

| 任务 | 内容 | 状态 | 负责人 |
|------|------|------|--------|
| #1 | 重构 FileStorage 模块 | ✅ | - |
| #18 | 创建存储模块架构设计 | ✅ | teammate-1 |
| #19 | 重构 FileStorage 模块 | ✅ | teammate-1 |
| #2 | 重构 P2P Connection 模块 | ✅ | - |
| #20 | 实现 P2PManager 类 | ✅ | - |
| #21 | 重构 Rust 端 P2P 命令模块 | ✅ | - |
| #22 | 创建 P2P 模块导出和单元测试 | ✅ | - |
| #3 | 重构 WebSocket 通信模块 | ✅ | - |
| #24 | 重构 WebSocket 模块 | ✅ | - |
| #4 | 重构 Device Pairing 模块 | ✅ | - |
| #25 | 重构 Device Pairing 模块 | ✅ | - |
| #26 | 创建配对状态机类型定义 | ✅ | - |
| #30 | 运行 E2E 测试 | ✅ | - |
| #31 | 修复 p2p/manager.ts 类型错误 | ✅ | teammate-2 |
| #32 | 添加 E2E 测试所需的 data-testid | ✅ | teammate-4 |
| #33 | MVP 程序自动测试 | ✅ | teammate-4 |
| #34 | 创建 MVP 单元测试文件 | ✅ | - |
| #35 | 讲解 MVP 程序 | ✅ | - |
| #47 | 检查 web 应用当前状态 | ✅ | - |
| #48 | 添加保存数据功能 | ✅ | - |
| #51 | 适配手机端响应式界面 | ✅ | - |

### 新增文档
| 文档 | 说明 |
|------|------|
| `docs/architecture/MVP.md` | MVP 架构设计文档 |
| `docs/architecture/MVP-ARCHITECTURE.md` | MVP 详细架构文档 |

### 有价值发现

1. **任务分配优化**
   - Bug 修复：AI 快速处理
   - 新功能开发：分配给成员
   - 探索性任务：AI 先探索再分配

2. **任务颗粒度**
   - 小任务：1-2 小时完成
   - 中任务：1-2 天完成
   - 大任务：应拆分为子任务（不超过 3 个）

3. **工作流程**
   ```
   用户需求 → AI 理解记录 → AI 拆解任务 → 用户同意 → AI 分配 → 成员执行 → 成员报告 → AI 汇总
   ```

4. **报告机制**
   - 成员完成后向 AI 报告
   - 格式：任务编号 + 完成情况 + 是否需要检查
   - AI 汇总后向用户汇报

### 流程优化点

- [x] 快速响应用户需求
- [x] 代码质量保证（无新错误）
- [x] 及时文档更新

- [ ] 任务分配及时性（避免问题出现才分配）
- [ ] 任务颗粒度一致性
- [ ] 等待成员报告时保持耐心

### 待改进

1. 不应太急于自己动手，应等待成员完成
2. 任务拆解应更细致，避免过粗或过细
3. 紧急问题可快速处理，但应及时告知成员

---

## [2026-02-10] Cycle 2 - 密码安全（多设备同步功能）

### 执行摘要
- **任务**：多设备同步功能 - Cycle 2：密码哈希模块 + sync 模块重构
- **结果**：Cycle 2 完成，E2E 测试通过
- **主要变更**：
  - `crypto-adapter.ts`: SHA-256 + PBKDF2 密码哈希实现 (+180 行)
  - `pouch-sync.ts`: 重构使用 sync.port.ts 类型定义
  - `sync-store.ts`: 集成密码哈希模块
  - `SPEC-302`: 密码哈希模块设计文档
  - `SPEC-303`: sync 模块架构设计文档
  - `SPEC-304`: 用户认证模块重构设计文档

### 团队结构
| 角色 | 职责 | 贡献 |
|------|------|------|
| team-lead | 协调、知识记录 | logs.md, CLAUDE.md 更新 |
| architect | 架构设计 | SPEC-302/303/304 |
| developer | 编码实现 | crypto-adapter, pouch-sync, sync-store |
| developer-2 | 协助测试 | bun test 运行 |
| tester | 单元测试 | bun test 通过 |
| reviewer | 代码审核 | 安全性、架构合规 |
| e2e-tester | 浏览器测试 | 页面加载、控制台检查 |

### Cycle 进度
| 循环 | 可用目标 | 状态 |
|------|---------|------|
| Cycle 1 | 页面可访问 | ✅ 完成 |
| **Cycle 2** | **密码安全** | ✅ **完成** |
| Cycle 3 | 架构就绪 | ⏳ 待命 |
| Cycle 4 | 架构合规 | ⏳ 待命 |
| Cycle 5 | 完整功能 | ⏳ 待命 |

### Git 提交记录
| 提交 | 内容 |
|------|------|
| 2e9d015 | feat: 实现密码哈希模块并重构 sync 模块架构 |
| a344a4b | fix: 修复类型错误并完善 PouchSyncAdapter |
| 8053225 | test: E2E 浏览器测试通过 |

### E2E 测试结果
| 页面 | 加载 | UI | 控制台 |
|------|------|-----|--------|
| /user-manage | ✅ | ✅ | ✅ |
| /sync-test | ✅ | ✅ | ✅ |

### 有价值发现
1. **E2E 测试必要性**：每个循环必须验证软件可被用户使用
2. **遗留测试清理**：ws-*.test.ts 文件已删除
3. **密码安全实现**：使用 Web Crypto API + PBKDF2

---

## [2026-02-10] Cycle 1 - 路由和页面（多设备同步功能）

### 执行摘要
- **任务**：多设备同步功能 - Cycle 1：路由配置 + 用户管理页面 + 同步测试页面
- **结果**：完成 Cycle 1，22 任务体系建立
- **主要变更**：
  - 路由配置完成 (`/user-manage`, `/sync-test`)
  - UserManagePage.tsx 和 SyncTestPage.tsx 已存在
  - 遗留测试文件清理 (ws-*.test.ts, conflict-resolution.test.ts)
  - 建立 4 角色 5 循环 22 任务开发体系

### 团队结构
| 角色 | 职责 | 任务分配 |
|------|------|---------|
| team-lead | 分配任务、协调流程、记录知识 | 整体协调 |
| architect | 架构设计 | #6, #7, #12, #16, #21 |
| developer | 编码实现 | #8, #13, #17, #22, #25 |
| developer-2 | 编码实现 | #9, #18 |
| tester | 测试 | #10, #14, #19, #23, #26 |
| reviewer | 代码审核 | #11, #15, #20, #24, #27 |

### Cycle 进度
| 循环 | 可用目标 | 状态 |
|------|---------|------|
| Cycle 1 | 页面可访问 | ✅ 完成 |
| Cycle 2 | 密码安全存储 | 进行中 |
| Cycle 3 | 架构就绪 | 待命 |
| Cycle 4 | 架构合规 | 待命 |
| Cycle 5 | 完整功能 | 待命 |

### 遗留问题处理
| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 明文密码存储 | sync-store.ts 直接存储密码 | Cycle 2 密码哈希模块 |
| sync-store 混合职责 | 同时处理 UI 状态和业务逻辑 | Cycle 4 重构调用 SyncService |
| 遗留测试文件 | WebSocket 模块删除后测试未清理 | Tester 删除 4 个无效测试 |

### 团队规则更新
- [x] 每位成员完成任务后 git commit + git push
- [x] Lead 每个循环更新 PR 描述
- [x] Lead 回写知识到 CLAUDE.md 和 logs.md

### 有价值发现
1. **4 角色并行工作**：architect + developer + tester + reviewer 同时工作，提高效率
2. **遗留问题不阻塞**：标记问题，后续循环处理，不阻塞当前循环
3. **清理先于开发**：先清理遗留测试，再开始新功能

---

## [2026-02-10] 团队工作实践总结（基于 Claude Code 官方文档优化）

### 执行摘要
- **任务**：总结多角色团队协作模式
- **目的**：规范化任务分配、沟通、问题处理流程
- **参考**：https://code.claude.com/docs/zh-CN/agent-teams.md

### 核心原则

1. **Agent Teams 架构**
   - **Team Lead（负责人）**：协调流程、分配任务、记录知识，不直接编码
   - **Teammates（队友）**：独立工作，各自的 context window，直接相互通信
   - **共享任务列表**：TaskList 管理，状态自动同步
   - **Mailbox 消息系统**：SendMessage 自动传递，队友空闲时自动通知

2. **Lead 职责**
   - 只分配任务、汇总结果
   - 不直接修改代码（除非紧急问题）
   - 等待队友完成，不抢活

### 团队结构

| 角色 | 职责 | 任务 |
|------|------|------|
| **team-lead** | 协调流程、分配任务、记录知识 | 不直接编码，只分配和汇总 |
| **architect** | 架构设计 | 分析模块关系、编写架构文档 |
| **developer** | 编码实现 | 功能开发、Bug 修复 |
| **tester** | 单元测试 | 编写测试、验证代码 |
| **e2e-tester** | 端到端测试 | 浏览器测试、截图、控制台检查 |
| **reviewer** | 代码审核 | 代码质量、安全性检查 |
| **doc-writer** | 文档编写 | API 文档、用户手册 |
| **devops** | 运维部署 | CI/CD、环境配置 |

### 任务分配原则

1. **Lead 不干活**
   - Lead 只分配任务、汇总结果
   - 不直接修改代码（除非紧急问题）

2. **问题分类处理**
   - 架构问题 → @architect
   - 代码问题 → @developer
   - 测试问题 → @tester / @e2e-tester
   - 部署问题 → @devops
   - 文档问题 → @doc-writer

3. **任务分发流程**
   ```
   用户需求 → Lead 理解 → Lead 拆解任务 → SendMessage 分配 → 成员执行 → 成员报告 → Lead 汇总
   ```

4. **任务状态管理**
   - 使用 TaskList/TaskUpdate 管理共享任务
   - 状态：待处理（pending）→ 进行中（in_progress）→ 已完成（completed）
   - 支持任务依赖：被阻塞任务在依赖完成后自动解除

### 沟通方式

| 场景 | 方式 | 说明 |
|------|------|------|
| 分配任务 | SendMessage | 直接发送任务描述到成员 |
| 紧急问题 | SendMessage + 强调"立即" | 需要快速响应 |
| 完成报告 | SendMessage 回复 Lead | 成员向 Lead 汇报 |
| 全部通知 | Broadcast | 谨慎使用，成本随人数增加 |
| 代码审核 | Pull Request | GitHub PR 流程 |

### 问题处理流程

```
发现问题 → 分类 → 分配 → 执行 → 验证 → 关闭
   ↓         ↓        ↓       ↓      ↓
  Lead    按角色    SendMessage  成员   Lead
                              执行  验证
```

### 当前待处理任务

| ID | 任务 | 负责人 | 状态 |
|----|------|--------|------|
| #52 | ChatPage 集成 EventStorage | @developer | 进行中 |
| #55 | 审核 PR #20 代码 | @reviewer | 进行中 |
| - | 多设备同步架构分析 | @architect | 待开始 |
| - | ChatPage 单元测试 | @tester | 待开始 |
| - | EventStorage API 文档 | @doc-writer | 待开始 |
| - | 页面空白问题 E2E 测试 | @e2e-tester-1/2 | 进行中 |

### 最佳实践（来自官方文档）

1. **给队友足够的 context**
   - 队友自动加载 CLAUDE.md、MCP servers、skills
   - 不继承负责人的对话历史
   - 在 SendMessage 中包含任务详细信息

2. **适当调整任务大小**
   - 太小：协调开销超过收益
   - 太大：队友工作太久不检查，增加风险
   - 恰到好处：自包含单位，产生清晰可交付成果

3. **等待队友完成**
   - Lead 不应该自己开始实施
   - 告诉 Lead："等待队友完成他们的任务"

4. **从研究和审查开始**
   - 先做不需要编码的任务：审查、研究、调查
   - 展示并行探索的价值

5. **避免文件冲突**
   - 每个队友拥有不同的文件集
   - 分解工作，使任务边界清晰

6. **监控和引导**
   - 检查队友进度
   - 重定向不起作用的方法
   - 综合发现

### 有价值发现

1. **通讯方式问题**
   - 早期错误：使用 Task 工具创建任务给团队成员
   - 正确方式：使用 SendMessage 直接发送任务
   - 团队成员会收到消息通知

2. **紧急问题处理**
   - Lead 可以快速处理紧急问题
   - 但需要告知成员："Lead 快速处理，成员知晓即可"

3. **任务跟踪**
   - 使用 TaskList 查看所有任务状态
   - 每个任务有独立 ID、描述、负责人、状态

4. **启用 Agent Teams**
   - 需要设置环境变量：`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
   - 当前使用 SendMessage + TaskList 模式

### 流程优化点

- [x] 明确 Lead 只分配不编码
- [x] 问题按类型分配给对应角色
- [x] 使用 SendMessage 进行任务分配
- [x] 使用 TaskList/TaskUpdate 管理任务状态
- [ ] 等待成员报告时保持耐心
- [ ] 紧急问题处理后及时同步

---

*参考：https://code.claude.com/docs/zh-CN/agent-teams.md*
*格式模板：时间、摘要、任务表、文档、发现、优化点*
