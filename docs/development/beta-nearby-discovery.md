# Beta 附近设备：发现与加入

附近设备只表示收到 `exomind-discovery/1` 广播。Host 在与受信 route 分离的内存缓存中
保留设备 ID 和源 IP/监听端口，不读档案名、正文或权限。候选最多保留 30 秒、64 台设备、
每设备 4 个地址；停止或切换网络 generation 时清空。该缓存不进入复制、自动同步队列、
membership 或 grant，也不为探测设备而拨号。

Native 的 `beta_peer_nearby_candidates` 仅允许可信主窗口读取，无 profile 参数。
`BetaPeersPage` 可在空设备上开启同步与发现；选择候选后仍须取得完整邀请、检查邀请，
再明确确认加入。粘贴邀请保留已选择的候选地址；邀请 issuer 与候选设备不符时清空候选。
最终连接仍由既有 TLS pin、邀请、成员 generation 和确认协议裁决。发现和地址可达都不
构成已配对，也不能代替用户确认。已授权 Ready 设备仍沿用原重连路径。

Host 回归 `nearby_discovery_is_visible_bounded_and_never_becomes_peer_access` 用真实 UDP
接收测试广播，检查独立候选、无拨号、无成员/route、去重、容量与过期。UI/client 回归
位于 `tests/unit/beta/peers-{client,page}.test.ts*`，覆盖先选择再粘贴以及邀请身份不符。
这些源码检查不替代精确候选上的双 Host 或真设备发现验收。
