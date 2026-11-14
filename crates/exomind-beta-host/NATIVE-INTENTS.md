# 本机 UI intent 存储

用于 Native 窗口的未发送草稿、固定提交快照和回执查证索引。它不生成 Core 事件、序号或同步事实，不属于远端 Agent、HTTP、peer 同步及默认资料导出的读取范围。Web 使用自己的 origin-local adapter。

Rust facade 仅接受当前 Host 的 owner Session：

```text
read_local_intent(owner, key) -> Option<String>
write_local_intent(owner, key, raw) -> ()
```

Native 的两个私有 IPC 是 `beta_read_local_intent` / `beta_write_local_intent`；仍核验实际 Beta 主窗口来源，前端不能传 owner 凭据或切换数据根。未注册 HTTP 路由。只有当前 device 的 capture key、当前 device/profile 的 timeblock key 合法；grant、旧 runtime、其它 Host、未知档案和任意 KV key 均拒绝。

## 存储与确认

`private-ui/intent.sqlite3` 位于独立 Beta root，SQLite DELETE/FULL。JSON 原字节字符串上限8 MiB，校验完整 SHA256，不重排序、不解析成业务事实。`private-ui.initialized` 保留 layout/device 锚点；文件与目录使用既有私有权限策略。

初始化先以一个 SQLite 事务提交 schema/application/layout/device，再写 create-new 锚点并同步；Unix 同步父目录。两个文件不是一个原子事务：完整、绑定正确但缺锚点的库可完成初始化；已有锚点却丢目录/主库、空主库、孤立 sidecar、错绑定、外来布局或坏 hash 必须明确失败。已坏行不能用新写入覆盖掉。不得通过空重建或旧 localStorage 回退把恢复故障伪装成空稿。

收到 write 成功，才代表完整快照事务已提交。前端仍须先提交不可变命令快照，再发业务 RPC；UI 暂存失败不等于请求没有其它副作用。所有调用在同一 Host admission gate 内复验资格，停止后排队写入拒绝；缓存连接先于 root 锁释放。

## 验证边界

Host 全套41项通过，包含实际子进程写入确认后 kill/重开、拒写保旧值、丢库/空库/绑定/hash 故障和 queued-stop。子进程 fixture 默认 ignored，但由父用例真实调用。Unix 目录同步随后加入，Windows专项6项再次通过；Android 交叉编译和完整新 APK 仍单独记证据。这些不是物理断电或损坏介质保证。

当前仅 Beta 主窗口可调用。将来浮窗接入必须保持单写者或增加明确的并发控制，不能让多个 renderer 用整份快照互相覆盖。
