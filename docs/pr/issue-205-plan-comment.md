# [GH#205] Agent Hub RuntimeHost + Tauri 托管实施计划（待审批）

## 先说结论（推荐方案）
采用 **方案 B：RuntimeHost 管理 + Tauri 内置服务托管（单 PR）**。  
本轮先解决“电脑端可运行 Agent，设备页可接入多主机”：
1. `/agents` 设备页可手动录入 `IP + Port`，并连接多个局域网 `RuntimeHost`。  
2. Tauri 桌面端托管后端服务（先 `sync-server`，预留 `agent-runner`），不再依赖命令行单独起服务。  
3. 设置页可配置 `Host/Port/AutoStart`；设备页可实时展示服务状态（running/stopped/error）。  

---

## 我对现有实现的调研结论

### 现状
1. `src/ui/new/pages/AgentsPage.tsx` 设备页为静态卡片展示，暂无“新增 RuntimeHost”交互与连接探测。  
2. `src-tauri/src/lib.rs` 仅注册文件、WS、EventLog 命令，尚无服务生命周期命令（start/stop/status）。  
3. `server/pouchdb-server.js` 目前通过脚本手动启动，未被 Tauri 进程统一托管。  

### `packages/ts-agent-cli` 可复用点
1. `Agent`（编排层）与 `ClaudeClient`（协议/流式层）职责清晰，适合在 ExoMind 继续“Service + Adapter”分层。  
2. `State` 的会话和健康信息模型可作为后续 `RuntimeHost health` 结构参考。  

---

## 本轮范围（单 PR，TDD + 分步 commit）

1. **RuntimeHost 领域模型与配置模型**
   - 文件：`src/lib/types/agent-hub.ts`（扩展）或新增 `src/lib/types/runtime-host.ts`
   - 增加：`RuntimeHostConfig`、`RuntimeHostConnectionState`、`RuntimeServiceStatus`
   - 目标：明确“手动地址、连接状态、最近探测时间、错误信息”契约

2. **前端服务层：RuntimeHost 管理（Web/Tauri 通用接口）**
   - 新增：`src/lib/services/runtime-host.service.ts`
   - 能力：`addHost/removeHost/listHosts/probeHost`
   - 存储：localStorage（`*_v1` key）+ 订阅机制（storage/custom event）

3. **Tauri 服务托管命令（核心）**
   - 新增：`src-tauri/src/commands/runtime_commands.rs`
   - 注册到：`src-tauri/src/commands/mod.rs`、`src-tauri/src/lib.rs`
   - 命令：`runtime_service_start`、`runtime_service_stop`、`runtime_service_status`
   - 托管对象：`sync-server`（本轮落地）+ `agent-runner`（接口预留）

4. **设置页：运行时配置（Config）**
   - 修改：`src/ui/new/pages/NewSettingsPage.tsx`
   - 增加分组：`Agent Runtime（运行时）`
   - 字段：`Host`、`Port`、`AutoStart`、`Service Target`
   - 行为：保存配置 -> 触发状态刷新

5. **设备页：多 RuntimeHost 连接管理（Device View）**
   - 修改：`src/ui/new/pages/AgentsPage.tsx`
   - 增加：手动输入 `IP:Port`、连接按钮、列表状态徽标、错误提示
   - 验收：连续添加多台主机并显示连接状态

6. **测试（先失败再实现）**
   - Unit：
     - `tests/unit/services/runtime-host.service.issue205.test.ts`
     - `tests/unit/settings/new-settings-runtime-host.issue205.test.tsx`
     - `tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`
     - `tests/unit/tauri/runtime-commands.issue205.test.ts`（命令注册与契约）
   - E2E：
     - `tests/e2e/agent-runtime-host.issue205.test.ts`
     - `tests/e2e/playwright.issue205.config.ts`（独立端口）

7. **PR 文档与评审**
   - 更新：`docs/pr/issue-205-progress-comment.md`
   - 更新：`docs/pr/issue-205-review-comment.md`
   - 每阶段提交后同步 PR 评论，最终附评审结论与风险清单

---

## 验收标准（对应你的要求）
1. `/agents` 设备页可手动录入并连接多台局域网 `RuntimeHost`。  
2. 设置页可修改运行时 `IP/Port` 等配置并持久化。  
3. 设备页可实时看到服务状态（替代命令行手动观察 DB 启停）。  
4. 单 PR 同时交付“服务集成 + 配置/状态页”。  
5. 全链路证据：Unit + Playwright + `bun run build`。  

---

## 分步提交策略（每步都 commit）
1. `test(issue-205): add failing tests for runtime host models and service`
2. `feat(agent-hub): add runtime host service and storage contracts`
3. `feat(tauri): add runtime service lifecycle commands for desktop host`
4. `feat(settings): add runtime host config section and persistence`
5. `feat(agent-hub): add device runtime host connect UI and status badges`
6. `test(e2e): cover multi-runtimehost connect flow on agents device view`
7. `docs(issue-205): add progress and review comments for PR evidence`

---

## 风险与处理
1. **子进程生命周期泄漏风险**：Rust state 统一持有 child handle，应用退出时显式 stop。  
2. **端口冲突**：状态接口返回结构化错误（`port_in_use`），前端直接提示。  
3. **跨端差异**：先保证桌面端（Tauri）闭环，移动端/Web 仅保留接口不强耦合。  

---

## 需要你审批的一句话
请确认是否按此计划执行（回复关键词：`批准执行 RuntimeHost 方案`）。  
你一批准，我就按 TDD 开始：先写失败测试，再逐步实现，并在每个任务后提交 commit + 更新 PR 评论。
