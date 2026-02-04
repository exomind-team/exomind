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

*格式模板：时间、摘要、问题表、优化点、发现*
