# 局域网节点优先（node-first）与单 RT 兼容指南

> 更新日期：2026-03-30
> 关联 issue：[#773](https://github.com/exomind-team/exomind/issues/773)、[#682](https://github.com/exomind-team/exomind/issues/682)
> 说明：文件路径仍保留 `lan-single-rt-guide.md`，用于兼容旧链接；正文已经切换到 node-first 产品叙事。

---

## 先说结论

当前 ExoMind 的推荐路径不再是“手机直接连接某一台电脑 RT（Runtime，运行时）”。

推荐主路径现在是：

- 每一台设备都运行自己的 **embedded RT（内嵌 RT）**
- 每一台设备在「网络 → 设备」页面里都被看作一个 **node（节点）**
- 节点之间先做 **discovery（发现）**
- 再做 **pairing / trust（配对 / 建立信任）**
- 配对完成后，在「已确认节点」里查看 peer（对等节点）与复制状态

旧的“单 RT host（单主机 RT）+ 其他设备直接连过去”的流程仍然支持，但它现在属于：

- `高级 / 兼容模式`
- `external RT（外部 RT）`
- `手工 host:port 录入`

也就是说：

- **主路径**：每设备一个节点，RT 与 RT 互联
- **兼容路径**：某个客户端直接使用别人的 RT

---

## 一张图理解现在的产品心智

### 1. 推荐主路径：每设备一个 embedded RT

```text
                 局域网 / ExoMind-Net

┌────────────────────┐            ┌────────────────────┐
│ 手机 App            │            │ 电脑 App            │
│ embedded RT         │◀──────────▶│ embedded RT         │
│ node: phone         │ discovery  │ node: desktop       │
└────────────────────┘ pairing     └────────────────────┘
            ▲                                  ▲
            │                                  │
            └──────────────▶ 平板 embedded RT ◀─┘
```

这里的关键不是“谁是主机”，而是“每个设备先成为一个节点”。

### 2. 兼容路径：单 RT host

```text
           局域网（兼容模式）

┌──────┐                 ┌──────┐
│ 手机  │── HTTP / SSE ──▶│ 电脑  │
│ 客户端 │                │ host RT│
└──────┘                 └──────┘
```

这个模式依然可用，但不再是设备页默认想让用户走的路。

---

## 第一部分：主路径使用指南（node-first）

### 前置条件

- 需要参与组网的设备在**同一个 WiFi / 局域网**
- 每台设备都安装 ExoMind，且具备本机 embedded RT 能力
- 至少有你希望被其他设备发现的节点切到 `局域网（LAN）` 模式

### Step 1：在每台设备上启动 embedded RT

1. 打开 ExoMind
2. 进入 `网络 → 设备`
3. 在「我的节点」卡片里确认当前设备的 node 状态
4. 如未运行，点击：
   - `Start`

你会看到：

- 当前运行地址
- 目标监听地址
- `node id`
- 当前状态 `running / stopped`

> 这里的 Start / Stop 控制的是“本机内嵌 RT”，不是远端设备。

### Step 2：决定这台节点是否要被其他设备发现

在「我的节点」里可以切换：

- `仅本机（local only）`
- `局域网（LAN）`

它们的区别是：

| 模式 | 监听地址 | 其他设备是否可发现 / 访问 |
|------|----------|----------------------------|
| 仅本机 | `127.0.0.1` | 否 |
| 局域网 | `0.0.0.0` | 是 |

推荐策略：

- 手机只想本机用：保持 `仅本机`
- 想让电脑、平板发现它：切到 `局域网`
- 常用协同设备建议都切 `局域网`

如果页面提示监听地址需要重绑（rebind，重新绑定），重新点击 `Start` 即可按目标地址重启。

### Step 3：从设备页主路径发起配对

现在配对入口已经上浮到设备页主区域。

操作：

1. 进入 `网络 → 设备`
2. 在「我的节点」卡片右上角点击：
   - `设备配对`
3. 选择目标节点并完成确认

这一步是从“发现到可信”的产品动作，不是简单输入一个 `host:port`。

### Step 4：查看“已发现节点”

设备页的「已发现节点」区域会列出：

- 当前局域网里已被发现、但还未确认的节点
- 它们的设备名 / OS / 地址 / 延迟 / 在线时长

这批节点默认只是：

- `待配对节点`

还不应该被当成可信 peer 使用。

### Step 5：查看“已确认节点”

完成配对后，可信节点会进入：

- `已确认节点`

页面会显示：

- peer 名称
- `host_id`
- 当前连接状态
- `复制状态`

当前文案映射为：

- `online -> 已连接`
- `offline -> 离线`
- 其他状态 -> `异常 / 待重试`

这块区域才是 node-first 组网下你应该重点看的地方。

### Step 6：如何理解“复制状态”

产品上可以把它理解为：

- 本机节点与已确认 peer 的链路状态
- 是否已经建立起可用的 RT-to-RT 连接

这里展示的是产品状态，不是要求用户手动操作底层协议细节。

---

## 第二部分：什么时候才去用“高级 / 兼容模式”

只有在下面这些场景，才建议进入设备页底部的：

- `高级 / 兼容模式`

适用场景：

- 你要临时接入一个旧的单 RT host
- 你需要手工录入某个 `host:port`
- 你在做桥接、调试、诊断
- 你当前的目标不是“每设备一个 embedded RT”，而是临时复用某个已有 RT

这里的典型能力包括：

- `external RT`
- `管理主机`
- 手工 probe / retry
- 兼容桥接

换句话说：

- **普通用户 / 正常产品路径**：看上面三块
  `我的节点 / 已发现节点 / 已确认节点`
- **开发者 / 兼容链路**：再往下看
  `高级 / 兼容模式`

---

## 第三部分：兼容路径使用指南（单 RT host 仍可用）

如果你现在就是想让“手机直接连电脑 RT”，那仍然可以，只是它已经不再是主路径。

### 兼容路径 Step 1：在 host 设备上开放局域网监听

1. 在电脑端打开 `网络 → 设备`
2. 在「我的节点」里把 bind mode 切到：
   - `局域网`
3. 如有需要，重新点击 `Start`

这会让 embedded RT 监听：

- `0.0.0.0:<port>`

默认 embedded RT 端口通常是：

- `9124`

### 兼容路径 Step 2：确认 host 的 IP 和健康状态

在 host 设备上查看局域网 IP。

**Windows / PowerShell**

```powershell
ipconfig
```

找到类似：

- `192.168.1.204`

然后在 host 本机验证：

```powershell
curl.exe -sS http://127.0.0.1:9124/health
```

再从另一台设备验证：

```powershell
curl.exe -sS http://192.168.1.204:9124/health
```

### 兼容路径 Step 3：在客户端切到 external RT

1. 打开客户端 ExoMind
2. 进入 `网络 → 设备`
3. 滚动到 `高级 / 兼容模式`
4. 将运行目标切到：
   - `外部 RT`
5. 输入 host 地址，例如：
   - `192.168.1.204:9124`
6. 点击：
   - `应用`

此时客户端会把运行目标切到那台 host，而不是继续使用本机 embedded RT。

### 兼容路径 Step 4：必要时使用“管理主机”

如果你想：

- 录入手工节点
- 做兼容调试
- 对某个历史 host 反复 probe

可以使用：

- `管理主机`

这个入口现在明确属于兼容层，不应替代主路径的 discovery / pairing。

---

## 第四部分：Agent / curl 如何接入

无论你走主路径还是兼容路径，本质上最终仍然是访问某个 RT 的 HTTP API。

### 快速健康检查

```powershell
curl.exe -sS http://127.0.0.1:9124/health
curl.exe -sS http://192.168.1.204:9124/health
```

### 常见端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/topology` | GET | 节点 / 主机拓扑信息 |
| `/eventlog` | GET/POST | 事件日志读写 |
| `/tasks` | GET | 任务列表 |
| `/tasks/:id` | GET/PUT | 任务详情 / 更新 |
| `/tasks/:id/transition` | POST | 任务状态迁移 |
| `/timeblocks` | GET | 时间块列表 |
| `/profiles` | GET | 档案列表 |
| `/signals/history` | GET | 信号历史 |

> 如果你是 agent / 自动化脚本，接谁的 RT，就等价于把那台节点当作 API 入口。

---

## 第五部分：当前产品页面如何对应到底层架构

### 设备页现在的四块主结构

| UI 分区 | 产品含义 | 对应心智 |
|--------|----------|----------|
| 我的节点 | 当前设备自己的 embedded RT | 先把自己变成 node |
| 已发现节点 | 已发现但未建立信任的节点 | discovery |
| 已确认节点 | 已确认的可信 peer | trust / pairing / replication |
| 高级 / 兼容模式 | 外部 RT、手工 host、桥接和诊断 | compatibility |

### 底层关键点

| 组件 | 文件 | 作用 |
|------|------|------|
| 设备页产品主路径 | `src/ui/app/pages/agents/DeviceView.tsx` | 展示 node-first 四分区 |
| 配对弹窗接线 | `src/ui/app/pages/AgentsPage.tsx` | 设备页主入口直接拉起配对 |
| 配对弹窗 | `src/ui/app/components/PeerPairingDialog.tsx` | 处理发现 / 选择 / 确认 |
| 网络模式配置 | `src/config/runtime-target.ts` | local / lan 与 external target 切换 |
| RT 启动参数 | `src-tauri/src/commands/runtime_commands.rs` | 决定 bind `127.0.0.1` 或 `0.0.0.0` |
| mDNS 发现 | `crates/exomind-runtime/src/discovery.rs` | LAN 模式下广播 `_exomind._tcp.local.` |

---

## 已知限制

| 限制 | 说明 | 追踪 |
|------|------|------|
| LAN 仍需信任网络 | 当前局域网暴露仍应视为受信私网能力，不适合公共 WiFi | [#670](https://github.com/exomind-team/exomind/issues/670) |
| token / 配对安全边界仍在收口 | 本轮主要做产品层接线，不重做完整安全模型 | [#768](https://github.com/exomind-team/exomind/issues/768) |
| Android / Desktop 实机联调仍需继续 | UI 主路径已接上，但真机端到端还要继续验证 | [#527](https://github.com/exomind-team/exomind/issues/527) |
| external RT 仍可能绕过 node-first 心智 | 这是兼容入口，不建议作为默认用法 | [#773](https://github.com/exomind-team/exomind/issues/773) |

---

## 常见问题

### Q：我到底该选“设备配对”还是“外部 RT”？

默认先选：

- `设备配对`

只有在你明确知道自己要：

- 直接连某个既有 RT
- 做兼容链路
- 手工录入 `host:port`

时，才去选：

- `外部 RT`

### Q：为什么我的节点发现不了别人？

优先检查：

1. 两台设备是否在同一个局域网
2. 对方是否已经启动 embedded RT
3. 对方是否切到了 `局域网（LAN）`
4. 防火墙是否放行对应端口

### Q：为什么我能看到“已发现节点”，但没有进入“已确认节点”？

因为 discovery（发现）和 pairing / trust（配对 / 信任）不是一回事。

你还需要完成：

- 配对确认

完成后它才会进入可信 peer 列表。

### Q：单 RT host 模式是不是被删了？

没有删。

只是从：

- 默认主路径

下沉到了：

- `高级 / 兼容模式`

---

## 结语

如果你要理解这一轮产品变更，最重要的一句话是：

> “设备页不再默认把用户带到某个 host RT，而是先把每一台设备都建模成一个 node，再通过 discovery / pairing / confirmed peer 去组织 ExoMind-Net。”
