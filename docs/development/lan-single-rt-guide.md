# 局域网单 RT 模式使用指南

> 分析日期：2026-03-24
> 基线提交：dev@`1ea4c12`
> 关联 issue：[#682](https://github.com/exomind-team/exomind/issues/682)

---

## 什么是"单 RT 模式"

一台设备运行外心 Runtime（简称 RT），局域网内的其他设备**直接连接**到这台 RT。所有数据集中在一处，其他设备只是客户端。

类似 Minecraft 的「对局域网开放」——不需要额外搭服务器，打开开关就能联机。

```
           局域网（同一 WiFi）
┌──────┐                 ┌──────┐
│ 手机  │─── HTTP ────────│ 电脑  │ ← 运行 RT
│(客户端)│                │(主机) │    监听 0.0.0.0:9124
└──────┘                 └──────┘
                           ↑
┌──────┐                   │
│ 平板  │─── HTTP ─────────┘
│(客户端)│
└──────┘
```

**不是**两台 RT 互联（那是 mesh 组网，本文不涉及）。

---

## 第一部分：用户操作指南

### 前置条件

- 所有设备连接到**同一个 WiFi / 局域网**
- 主机（运行 RT 的设备）已安装外心桌面版或正在运行独立 RT

### Step 1：主机开启局域网模式

1. 打开外心桌面应用
2. 进入**网络**页面（底部导航栏 → 网络）
3. 找到**设备**标签页
4. 在「本地 Runtime」区域，找到监听模式切换：
   - **仅本机**（默认）：只允许本机访问，监听 `127.0.0.1`
   - **局域网**：允许局域网内所有设备访问，监听 `0.0.0.0`
5. 切换到**局域网**

> **当前状态**（2026-03-24）：此入口位于较深层的设备管理页面，不够直达。[#682](https://github.com/exomind-team/exomind/issues/682) 正在优化为更显眼的快速入口。

切换后注意事项：
- 如果 RT 已在运行，可能需要**重启 RT** 才能生效（界面会提示）
- 选择会被记住——下次启动应用不用重新设置

### Step 2：确认主机 IP 和端口

主机需要知道自己的局域网 IP，告诉其他设备用来连接。

**Windows**：
```
# 在命令提示符或 PowerShell 中
ipconfig
# 找到 WLAN 适配器的 IPv4 地址，如 192.168.1.204
```

**macOS / Linux**：
```bash
# 终端中
ifconfig | grep "inet "
# 或
ip -4 addr show | grep inet
```

**Android (Termux)**：
```bash
ifconfig
# 从 wlan0 找 192.168.x.x 地址
```

默认端口：
- Tauri 桌面应用嵌入式 RT：**9124**
- 独立运行的 RT 进程：**1949**
- 可通过环境变量 `EXOMIND_RT_PORT` 自定义

### Step 3：验证 RT 可达

在主机上先自测：

```bash
curl -sS http://127.0.0.1:9124/health
# 应返回 {"status":"ok","version":"0.1.0"}
```

然后在另一台设备上测试局域网可达性：

```bash
curl -sS http://192.168.1.204:9124/health
# 应返回相同结果
```

如果超时或连接拒绝，排查：
- 两台设备是否在同一网段（`192.168.1.x` 前三段相同）
- 主机是否已切换到「局域网」模式
- 主机防火墙是否放行了 9124 端口
- RT 是否已启动（检查网络/设备页面的状态）

### Step 4：客户端连接主机 RT

#### 方式 A：另一台外心客户端（手机/平板/另一台电脑）

1. 打开外心应用
2. 进入**网络** → **设备**标签页
3. 将 Runtime 模式从「内嵌 RT」切换到「**外部 RT**」
4. 输入主机的 IP 和端口，如 `192.168.1.204:9124`
5. 确认连接

连接成功后，该客户端的所有数据操作（事件日志、任务、时间块）都将读写主机 RT 上的数据。

> **待验证**（2026-03-24）：手机端（Android）连接电脑端 RT 的完整流程尚未经过端到端验证。可能存在：
> - CSP（内容安全策略）限制导致 HTTP 请求被拦截
> - Android WebView 对局域网 HTTP（非 HTTPS）请求的限制
> - cleartext traffic 配置问题（[#659](https://github.com/exomind-team/exomind/issues/659) 已修复 debug 构建）

#### 方式 B：浏览器直连（Web 模式）

如果在电脑上运行了 Vite 开发服务器（`npx vite --host 0.0.0.0`），其他设备可以通过浏览器访问前端：

```
http://192.168.1.204:5173
```

前端会尝试连接 RT。如果 RT 也在监听局域网（0.0.0.0），数据链路即可打通。

### Step 5：验证数据同步

在主机上写一条事件：

```bash
# 在主机上
curl -sS "http://127.0.0.1:9124/eventlog?user_id=profile-argon&limit=1"
# 记下最新事件的 id
```

在客户端上检查是否能读到：

```bash
# 在客户端设备上
curl -sS "http://192.168.1.204:9124/eventlog?user_id=profile-argon&limit=1"
# 应返回相同的事件
```

如果两边看到一致的数据，局域网单 RT 模式就跑通了。

---

## 第二部分：高级——Agent curl 接入

对于 AI Agent 或开发者，可以通过 curl 直接操作主机 RT 的 HTTP API。

### 前置条件

- 主机已开启局域网模式
- 知道主机的局域网 IP 和 RT 端口
- 知道目标档案的 scope key（如 `profile-argon`）

### 快速接入

详见 [ExoMind RT Agent 接入 Skill](../../.claude/skills/exomind-rt-agent-access/SKILL.md)。核心三步：

```bash
# 1. 确认连接
curl -sS http://192.168.1.204:9124/health

# 2. 确认档案
curl -sS "http://192.168.1.204:9124/eventlog?user_id=profile-argon&limit=3"

# 3. 发送消息
curl -sS -X POST "http://192.168.1.204:9124/eventlog?user_id=profile-argon" \
  -H 'Content-Type: application/json' \
  --data-binary @message.json
```

### 可用端点

主机 RT 在局域网模式下暴露的端点与本机模式完全一致：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/topology` | GET | 主机信息（hostname, OS, IP） |
| `/eventlog` | GET/POST | 事件日志读写 |
| `/tasks` | GET | 任务列表 |
| `/tasks/:id` | GET/PUT | 任务详情/更新 |
| `/tasks/:id/transition` | POST | 任务状态迁移 |
| `/timeblocks` | GET | 时间块列表 |
| `/profiles` | GET | 档案列表 |
| `/signals/history` | GET | 信号历史（全局，无档案隔离） |

> 完整端点参考见 Skill 文档的 [API 速查](../../.claude/skills/exomind-rt-agent-access/SKILL.md#api-速查) 章节。

---

## 技术细节

### 局域网模式的底层机制

| 组件 | 文件 | 作用 |
|------|------|------|
| 网络模式配置 | `src/config/runtime-target.ts` | `local`/`lan` 切换，持久化到 localStorage |
| RT 启动参数 | `src-tauri/src/commands/runtime_commands.rs` | 根据模式决定 bind `127.0.0.1` 或 `0.0.0.0` |
| mDNS 发现 | `crates/exomind-runtime/src/discovery.rs` | LAN 模式下自动注册 `_exomind._tcp.local.` 服务 |
| RT 路由 | `crates/exomind-runtime/src/routes/mod.rs` | 所有 HTTP 端点的注册入口 |

### 监听模式切换的影响

| | 仅本机 (local) | 局域网 (lan) |
|---|---|---|
| 绑定地址 | `127.0.0.1` | `0.0.0.0` |
| 外部设备可访问 | 否 | 是 |
| mDNS 服务发现 | 禁用 | 启用 |
| 认证保护 | 无（本机安全） | 无（⚠️ 待 [#670](https://github.com/exomind-team/exomind/issues/670) 实现） |
| 持久化 | localStorage | localStorage |

### mDNS 自动发现

当 RT 以 LAN 模式启动时，会通过 mDNS 广播自己的存在：

- 服务类型：`_exomind._tcp.local.`
- TXT 记录：`host_id=<runtime-uuid>`
- 地址选择：优先 IPv4，避免 link-local IPv6

其他运行外心的设备可以在「网络」页面看到自动发现的 RT 实例。

---

## 已知限制

| 限制 | 说明 | 追踪 |
|------|------|------|
| 入口藏得深 | 局域网切换在设备管理页面里，不够直达 | [#682](https://github.com/exomind-team/exomind/issues/682) |
| 无认证保护 | 局域网内任何知道 IP 的设备都能读写数据 | [#670](https://github.com/exomind-team/exomind/issues/670) |
| 手机端流程待验证 | Android 连接电脑 RT 的完整流程未经端到端测试 | [#527](https://github.com/exomind-team/exomind/issues/527) |
| 跨网段不通 | 仅限同一局域网 / WiFi，不支持公网或 VPN 穿透 | — |
| 模式切换需重启 | 从 local 切到 lan 后 RT 可能需要重启才生效 | [#682](https://github.com/exomind-team/exomind/issues/682) |

---

## 常见问题

### Q: 连接超时怎么办？

1. 确认两台设备在同一网段（`ping 对方IP`）
2. 确认主机 RT 已切换到局域网模式（`curl http://主机IP:9124/health`）
3. 检查主机防火墙是否放行了端口
4. 尝试在主机上用 `0.0.0.0` 验证：`curl http://0.0.0.0:9124/health`

### Q: 数据安全吗？

当前局域网模式**没有认证**——任何知道 IP 和端口的设备都能访问。仅建议在**受信任的私有局域网**（如家庭 WiFi）中使用。公共 WiFi 环境下不建议开启。

per-agent token 认证正在设计中（[#670](https://github.com/exomind-team/exomind/issues/670)）。

### Q: 多个客户端同时连接会冲突吗？

不会。RT 的 HTTP API 是无状态的，多个客户端可以同时读写。事件日志是追加式的（append-only），不存在写冲突。任务和时间块的状态迁移由 RT 的状态机保证一致性。

### Q: 关闭主机后客户端会怎样？

客户端会失去与 RT 的连接。数据不会丢失（都在主机上），重新启动主机 RT 后客户端自动恢复。
