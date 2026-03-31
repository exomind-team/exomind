# 2026-03-30 mDNS + Link Proof 手工验收清单

## 目标

验证桌面端与 Android 端在零状态下，仅依赖 mDNS 完成：

1. 首次发现
2. PIN 配对
3. 自动双向互通验证
4. Signal History（信号历史）记录 proof request / ack
5. 设备页手动 `测试互联` 再次成功

---

## 0. 环境前提

- 桌面端与 Android 端都运行当前工作分支
- 两端位于同一局域网 / 同一二层网络
- 两端都使用 `embedded / 内嵌 RT`
- 两端都切到 `LAN / 局域网` 监听模式
- 验收过程中禁止手工添加 `host:port`

### 0.1 Android Emulator 说明

- Android Emulator（安卓模拟器）不应作为“双向 mDNS 首发发现”的最终验收环境。
- 当前工作分支下，`桌面 -> Android Emulator` 的 mDNS 发现已可复现，但 `Android Emulator -> 桌面` 仍不满足“同一二层网络”的严格前提。
- 如果要验收“双方都能在响应配对里互相看到对方”，请优先使用：
  - 一台真实 Android 手机 + 一台桌面端
  - 或两台位于同一局域网 / 同一二层网络的桌面端
- 模拟器仍可用于验证：
  - 桌面侧候选节点展示
  - PIN 配对流程
  - link proof / Signal History / 手动测试互联

---

## 1. 清理零状态

### 1.1 清理前端本地状态

在桌面端与 Android 端各自的 WebView DevTools / 浏览器控制台中，清掉以下 key：

```js
localStorage.removeItem('agent_runtime_hosts_v1');
localStorage.removeItem('exomind:runtimeTargetMode');
localStorage.removeItem('exomind:runtimeExternalAddress');
localStorage.removeItem('exomind:embeddedRuntimeNetworkMode');
localStorage.removeItem('exomind:embeddedRuntimeStatus');
```

然后刷新页面。

### 1.2 清理 Runtime mesh peers（运行时 mesh peer）

对桌面端和 Android 端各自的本机 RT 执行：

1. 先 `GET /mesh/peers`
2. 对返回的每个 peer id 执行 `DELETE /mesh/peers/:peer_id`

如果当前 RT 启用了 admin secret（管理密钥），需要携带：

```text
Authorization: Bearer <authSecret>
```

`authSecret` 可从 `localStorage["exomind:embeddedRuntimeStatus"]` 中读取。

### 1.3 清理 UI 侧残留设备

打开 `设备 / Device` 页面，确认：

- `已确认节点` 为空
- `已发现节点` 为空
- `高级 / 兼容模式` 中没有手工录入地址

如果 `高级 / 兼容模式` 仍有历史地址，先删除，确保本轮验收不依赖 manual seed（手工种子地址）。

---

## 2. 启动与基础状态

### 2.1 启动桌面端与 Android 端

使用当前分支的 manager / 管理器实例启动，保证不是别的分支或旧构建。

### 2.2 校验两端的设备页基础状态

两端都进入 `设备 / Device` 页面，确认：

- `当前运行 / Current Runtime` 为 `running`
- `目标监听 / Bind Address` 为 `0.0.0.0:9124`
- `节点可达性 / Bind mode` 显示为 `LAN`
- 页面没有出现 `自动重启并切换` 一类的错误提示

---

## 3. 首次发现（mDNS only）

在不手工输入任何地址的前提下，确认：

- 桌面端能在 `已发现节点` 看到 Android
- Android 端能在 `已发现节点` 看到桌面端
- 如果一端先完成连接，另一端至少能在对应区块看到对方，不需要手动加地址

建议同时记录：

- `/mesh/discovered` 返回中是否已出现对方
- 设备页卡片上显示的 `host_id / 节点 ID`

---

## 4. PIN 配对

任选一端作为发起方：

1. 点击 `设备配对`
2. 记录 PIN
3. 在另一端选择发现到的设备并输入 PIN

### 4.1 配对完成的通过标准

本轮功能里，“配对成功”不只是 PIN 正确，而是必须同时满足：

- mDNS 已发现
- PIN 已通过
- 自动 link proof（链路验证）已完成

设备页最终应表现为：

- 对方进入 `已确认节点`
- `互通验证` 状态显示 `已验证互通`
- 显示 `本端 RTT`
- 显示 `对端 RTT`

如果只显示 `已连接`，但还是 `未验证互通`，本轮验收判定为 **未完成**。

---

## 5. Signal History 证据

两端都打开 `信号历史 / Signal History`，点击 `链路验证` 过滤器，确认：

- 能看到 `system.link_proof.request`
- 能看到 `system.link_proof.ack`
- proof 条目带有 `系统信号` 标识

展开 payload 后至少应看到：

- `proof_session_id`
- `attempt_id`
- `initiated_by_peer_id`
- `target_peer_id`

如果是 `ack`，还应能看到：

- `ack_kind`
- `completed_at_ms`
- 若为 result，则应包含 `observed_rtt_ms`

---

## 6. 手动测试互联

在 `已确认节点` 卡片上点击 `测试互联`。

### 6.1 通过标准

- 状态短暂进入 `正在验证互通`
- 最终回到 `已验证互通`
- RTT 数值更新或保持有效
- Signal History 中新增一轮 proof request / ack

### 6.2 失败标准

出现以下任一项都算失败，需要记录日志与截图：

- 停在 `未验证互通`
- 显示 `在线，但互通验证失败`
- 只出现 request，没有 ack
- 只有一端历史有 proof，另一端没有

---

## 7. 建议记录的证据

每轮至少保留以下证据：

- 桌面端设备页截图
- Android 端设备页截图
- 桌面端 `链路验证` 历史截图
- Android 端 `链路验证` 历史截图
- 一次手动 `测试互联` 成功后的截图
- manager 日志摘录

---

## 8. 本轮验收结论模板

```text
分支:
设备组合:
是否零状态:
是否仅依赖 mDNS:
首次发现是否成功:
PIN 配对是否成功:
自动验证是否成功:
手动测试互联是否成功:
Signal History 是否有 request/ack:
是否出现手工地址依赖:
备注:
```

---

## 9. 2026-03-31 零状态联调记录（Desktop + Android Emulator）

### 9.1 环境

- 分支：`feature/issue-773-network-node-first`
- 工作区：`D:\project\exomind-issue-773-network-node-first`
- 设备组合：Windows Desktop + Android Emulator
- 是否零状态：是
- 是否仅依赖 mDNS：是
- 是否保留手工地址：否

### 9.2 清理动作

- 停止 manager 受管实例后重新启动当前分支实例
- 删除桌面隔离 profile：`.tmp/zero-state/desktop`
- 清空 Android App 数据：`adb shell pm clear com.exomind.app`
- 保持两端都使用 `embedded RT（内嵌运行时）` + `LAN（局域网）`

### 9.3 基础发现结果

- 桌面端可在 `/mesh/discovered` 看到 Android Emulator
- Android 端 `/mesh/discovered` 仍为空
- 该现象符合当前 emulator 不满足严格“双向同二层网络”前提的已知限制
- 两端 `/mesh/peers` 最终都建立了 confirmed peer

### 9.4 自动验证结果

- PIN 配对成功
- 自动 `pairing_auto` proof 成功
- 两端设备页都显示 `已验证互通`
- RTT 结果：
  - Desktop：`本端 RTT 1304 ms`，`对端 RTT 2778 ms`
  - Android：`本端 RTT 2778 ms`，`对端 RTT 1304 ms`
- 证明自动 proof 已经不再出现 `0 ms RTT`

### 9.5 手动复测结果

- 早期失败 session：`81489577-d510-40d5-be8a-30a365d0ad04`
  - 现象：`manual_retry（手动测试互联）` 后两端进入 `在线，但互通验证失败`
  - 失败点：桌面侧迟迟没完成对端结果收敛，最终表现为 `等待对端验证结果超时`
- 修复后成功 session：`2eae2f62-7143-452e-aea2-d1838cb79511`
  - 两端都出现完整的双向 `request / receipt / result`
  - Desktop 成功发出自己的 `result ack`
  - 两端设备页重新回到 `已验证互通`
  - RTT 结果：
    - Desktop：`本端 RTT 1855 ms`，`对端 RTT 2764 ms`
    - Android：`本端 RTT 2764 ms`，`对端 RTT 1855 ms`

### 9.6 本轮结论

- `pairing_auto（自动验证）`：通过
- `manual_retry（手动复测）`：通过
- `Signal History（信号历史）`：通过
- `zero-state validation（零状态联调验证）`：通过
- 备注：本轮仍是 Desktop + Android Emulator 组合；若要验收严格双向 mDNS 首发发现，仍建议追加真机或同局域网双桌面验证

---

## 10. 2026-03-31 严格双向首发 mDNS 验收记录（Desktop + Desktop）

### 10.1 环境

- 日期：2026-03-31
- 分支：`feature/issue-773-network-node-first`
- 工作区：`D:\project\exomind-issue-773-network-node-first`
- 设备组合：Windows Desktop A + Windows Desktop B（同 worktree 下的双桌面隔离实例）
- 受管实例：
  - `issue-773-desktop-a`
  - `issue-773-desktop-b`
- 运行模式：两端均为 `embedded RT（内嵌运行时） + LAN（局域网）`
- 说明：当前机器无 Android 真机，因此这轮“严格双向首发 mDNS”最终验收采用双桌面同局域网链路完成

### 10.2 新发现的根因

- Runtime 侧：
  - Windows 多网卡环境下，mDNS 解析会返回多张网卡地址
  - 旧逻辑会把 VMware / TUN / overlay 地址错误保留为 peer 地址
- Frontend 侧：
  - `runtime host store` 在命中同一 `host_id` 后只更新 metadata，不刷新 `host / port / name`
  - 导致 `/mesh/discovered` 已经修正为真实 LAN 地址时，设备页仍显示旧虚拟网卡地址

### 10.3 本轮修复

- Runtime：
  - 在 `crates/exomind-runtime/src/discovery.rs` 引入本机接口打分与首选网段匹配
  - 同一 `host_id` 多次 `ServiceResolved` 时保留更优地址，不再被后续虚拟地址覆盖
- Frontend：
  - 在 `src/lib/services/runtime-mesh-host-sync.service.ts` 里，同步 discovered / confirmed peer 时刷新 `host / port / auto-generated name`
  - 在 `src/lib/services/runtime-host.service.ts` 里支持 endpoint 字段的持久化刷新

### 10.4 新鲜验收证据

- 首次发现：
  - Desktop A 设备页显示：`Node rt-c688f (192.168.101.5:27066)`
  - Desktop B 设备页显示：`Node rt-fbbf5 (192.168.101.5:27067)`
- `/mesh/discovered`：
  - `http://127.0.0.1:27067/mesh/discovered` 返回 `192.168.101.5:27066`
  - `http://127.0.0.1:27066/mesh/discovered` 返回 `192.168.101.5:27067`
- `/mesh/peers`：
  - `http://127.0.0.1:27067/mesh/peers` 返回 `http://192.168.101.5:27066`
  - `http://127.0.0.1:27066/mesh/peers` 返回 `http://192.168.101.5:27067`
- 自动配对 / proof：
  - PIN：`018470`
  - 两端均进入 `已确认 peer`
  - 两端设备页均显示 `已验证互通`
  - 触发来源：`自动配对`
- 手动复测：
  - 单侧点击 `测试互联` 后，两端均切换为 `触发：手动测试互联`
  - 两端重新回到 `已验证互通`
  - RTT 结果：
    - Desktop A：`本端 RTT 14 ms`，`对端 RTT 13 ms`
    - Desktop B：`本端 RTT 13 ms`，`对端 RTT 14 ms`

### 10.5 本轮结论

- `strict bidirectional first-discovery mDNS（严格双向首发 mDNS 发现）`：通过
- `pairing_auto（自动验证）`：通过
- `manual_retry（手动测试互联）`：通过
- `/mesh/discovered` 与设备页展示一致性：通过
- `/mesh/peers` confirmed peer 建立：通过
- 备注：这轮最终验收环境是双桌面，不是 `Desktop + Android`；Android 真机链路仍可作为后续补充验证
