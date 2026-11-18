# EasyTier、T3 Code 与外心的跨端连接和同步

2026-11-19。先核外心当前实现与现场，再读本地参考索引（未收录专门的EasyTier/T3连接参考），补EasyTier官方资料及T3本地源码。Luna只读调查固定T3 checkout `e313a122452835da330feef41d0b74a4d2eddbeb`，主代理综合外心接缝；未修改T3源码、运行它的构建或读取其运行数据库，不能据此断言已安装T3就是该版本。

本文是设计/实现判断与来源索引。外心本轮具体实现/验证见[覆盖网络修复记录](../plans/2026-11-19-beta15-overlay-network-routes.md)，此前工作见[Beta09–14盘点](../plans/2026-11-19-beta09-beta14-work-audit.md)。表中“建议”不是现有成品。

## 1. 当前现场说明了什么

用户Beta13在旧档案无法经EasyTier收平板新消息；随后另一个档案的邀请也加入失败。PC旧路由仍指Wi-Fi地址；新邀请截图只有Wi-Fi、代理TUN和loopback地址。通过官方同版CLI只读找到EasyTier平板节点，再对其外心peer端口做TCP连接成功。这证明覆盖网络到该端口可达，不能证明TLS身份、成员授权或数据补齐完成。

外心不是“协议只能走局域网”：peer监听通配IPv4，使用IP:端口连接。它当前主要靠邀请候选、已保存路由和LAN UDP发现获得地址；有覆盖网络却没有合适路由，仍会失败。完整worker已有约2秒接口重枚举，不能把它误写为只有启动快照。没有OS虚拟网卡的用户态覆盖地址也可能不在if_addrs里；平板实际接口枚举仍待取证。

因此要分开三个问题：网络能到哪；那个端点是不是原设备；双方是否有权复制某档案。EasyTier解决第一层的路径，不自动替外心产生稳定身份、档案授权、来源证明、DAG或原件。

## 2. 两种“跨端”有不同数据所有权

| 维度 | T3 Code参考实现 | 外心当前/目标 |
|---|---|---|
| 用户打开手机时在操作什么 | 手机/桌面/网页客户端连接一个environment服务 | 每台设备运行自己的Host/Core，也可另设远程控制面 |
| 真值在哪里 | 每个environment服务拥有线程、文件、provider和事件；客户端是投影/缓存 | 每端本地事实库可离线提交，联网后按来源和授权归并 |
| 离线 | 缓存可读；此在线RPC路径不等价离线写命令合并 | 本机记录/计时在合法本地状态下继续；恢复后同步 |
| 即时感来源 | 一个服务向多个客户端推事件；snapshot+sequence replay | 本地立即保存、对端及时获知head变化，再补可验证事实并更新本地投影 |
| peer/link | 服务端以受限MCP身份调用另一个environment、跟踪远端任务 | 数据复制成员与Agent grant分开，不能照搬MCP link作为事实授权 |
| 地址变化 | 同一environmentId有多route，学新地址、回退和回切 | 同一设备公钥/身份对应多route，更新地址不应重配对或换身份 |
| 身份保证 | 公开descriptor先比environmentId，再按连接方式授权；公开ID本身不是签名主机证明 | 保持TLS pin、当前成员/代次及签名事实的密码学边界 |

可以学习T3的连接管理和反馈。不能为了看起来实时而把外心改成“电脑一离线，手机就只能看缓存”的薄客户端。

## 3. Luna追到的实际路径

**客户端连接：**onboarding取公开descriptor、核目标ID/协议并兑换配对 → registry为该environment持有一个supervisor → driver逐条route做身份预检/授权/单次连接 → RpcSession等待首份server-config snapshot才ready → shell/thread各自获取snapshot、按sequence补齐并进入live。

**切网与恢复：**服务端配置流报告directEndpoints → registry学习并保存route → supervisor统一处理网络/前台唤醒、健康探测、带抖动退避 → 当前route失败时换后备，优先route恢复后经验证和冷却再回切 → 数据订阅从各自cursor补齐，超出有界replay窗口改取snapshot。

**environment peer/link：**持久化配对请求卡 → 用户在受控入口提供配对材料 → PeerLinks验证目标/能力并通过MCP OAuth建受限会话 → 凭据进secret store，路由/权限元数据分开 → PeerForwarding转发工具及mode限制 → RemoteDelegation记录远端child并在重启/断网后续跟踪。它不复制整库。

这些路径不是“换成WebSocket”一个决定。关键是唯一重连所有者、稳定身份、正确快照边界、可恢复游标及可解释状态。

## 4. 外心应按什么边界接入覆盖网络

建议维持四个独立对象：

1. **设备身份**：稳定device ID、公钥/指纹、版本/能力；安装后身份变更明确区分。
2. **连接路由**：一个设备有LAN、EasyTier、手工或其他已验证地址，带来源、有效性/最后探测、优先级和当前使用标记；地址不是权限。
3. **档案成员**：按P记录双方能力、代次、撤销及确认状态；换路由不重发邀请，真正换身份/授权才走配对合同。
4. **数据进度**：各origin事实/证明前缀、时间块解释资格、原件字节和校验；它们不是连接绿色指示灯的派生假值。

候选地址可来自OS接口、覆盖网络管理信息、已认证对端通告和用户明确输入。EasyTier节点名/IP只能作为路由线索；尝试连接后仍用外心TLS指纹确认身份，不能凭同一个EasyTier网络自动授予档案访问。没有集成某管理源就说明未接入，不用扫描整个网段冒充发现。

本轮最小接缝是“原邀请不变，可另给拨号地址”。它能让接收端使用已知覆盖地址，先验证原邀请的设备pin，再发送加入材料；不是编辑带签名的candidates，也不是降低TLS校验。后续还须给已授权设备提供更新/验证route的入口，避免为了地址变化反复重新授权。

## 5. 怎样达到更顺滑的同步

| 机制 | 外心应做什么 | 回归反例 |
|---|---|---|
| 一个连接所有者 | Native按设备/P协调连接，不由各页各起重试 | 主窗隐藏/切页使其他控制面掉线；重复订阅重连风暴 |
| 多route与身份分离 | 有界选择、先试可用路径；成功后提升路由，带失败原因/冷却 | DHCP旧IP给了另一台主机仍发送邀请材料 |
| 主动变化通知+补偿 | 本地成功提交后唤醒同步；保留低频有界校验与恢复补齐，不为“实时”持续全量轮询 | 当前peer没自己的新事实，就漏掉从第三端收到的head |
| 身份先于敏感材料 | TLS pin通过后才进行邀请/成员业务 | 一个错误覆盖地址诱导凭据或授权泄露 |
| 连接与数据分别确认 | TCP/TLS/成员/事实证明/投影/原件逐层显示最后确认 | 一条socket连上就显示“所有设备已同步” |
| 有界续接 | 沿每来源cursor补页，保字节预算/公平性/幂等；必要修复仍不丢本地离线事实 | 照搬服务端权威snapshot覆盖了手机离线新记录 |
| 前后台/切网唤醒 | 网络变化、回前台、明确重试触发资格/会话探测，失败才重建 | 系统报offline就摧毁仍工作的本机连接；旧socket半死不恢复 |
| UI保持连续 | 先呈现已有本机内容，后台追赶；不抢阅读锚点/输入焦点 | 每次补页清空列表、抖动按钮、输入被迟到状态覆盖 |
| 对端回执可定位 | 针对刚发事件给“本机保存/对方事实确认/对方解释状态” | 用户只能凭自己在另一台找不到文字猜是否丢失 |
| 原件独立调度 | 小件策略自动、大件按需、自动找授权持有端，文字不被大文件阻塞 | 无关旧证明缺口阻断已授权小图片 |
| 可诊断且低成本 | 记录非凭据阶段/attempt/route/耗时/字节，自成本有界 | 一条“网络失败”无恢复入口；面板自己每帧全库扫描 |

常连通知和新的地址交换若影响wire，必须能力协商/版本化，不向旧Beta13发送其不认识的帧。现有签名、代次/撤销和幂等合同继续保留；WebSocket或推送不是副本正确性的替代品。

## 6. 用户怎样纵览、探查、管理与整合

建议把现有“同步”推进成设备总览，与本机观测面板共用可信数据源，但分别表达网络与数据。

- **总览一眼**：设备可读名/本机与对端/平台版本，当前档案、连接方式、最后确认、新鲜度；同时看到文字、时间块、原件三项状态，不只一个红绿点。
- **按设备深入**：LAN/EasyTier等route列表，当前在用/来源/优先级、最近探测、身份核验、失败层和重试时间；能验证新地址、重试、暂停该连接、改备注及查看授权。
- **按档案深入**：同一P跨设备的来源/缺口和指定事件确认，不以显示名合并不同UUID的档案。相同事件只计一次；多份副本的容量分别列，不把副本数量当新事实数。
- **沿链路排障**：本机 → 网络/中继 → peer端口 → 身份 → 档案授权 → 事实/证明 → 时间块投影 → 原件；每层有成功/失败/未检查和可完成动作。IP可达和TLS失败保留不同解释。
- **整合与治理**：可配置一台常在线的授权副本作为中转/原件持有者，但其他端保留本地权威与离线能力。撤销停止未来访问，不宣称能抹除已保存他端副本；跨不同P整合必须另有显式来源保留设计。
- **本地可观测**：接续FlClash式总览与ARC渐进披露，按关注展开CPU/存储/队列/连接/阶段；非凭据本机信息可查，secret不显示/导出，未来遥测另行授权。

典型恢复操作应是“验证并换用这个地址”“补齐这个来源”“获取这个原件”。单纯地址失效不应逼用户清档案、重装应用或重新授权。

## 7. 源码与外部依据

Luna原始报告留仓库外：`G:/exomind-runs/beta09-beta14-audit-20261119-a/t3-luna-connection-research.md`。本表是可持续复查的精确参考，不把其他仓库的WIP当作发行能力。

| 参考位置 | 首读行 | 作用 |
|---|---:|---|
| T3 `packages/client-runtime/src/connection/driver.ts` | 148 | route预检、fallback、授权及单次session建立 |
| T3 `packages/client-runtime/src/connection/supervisor.ts` | 343 | 唯一重连/网络唤醒/优选探测/冷却 |
| T3 `packages/client-runtime/src/connection/registry.ts` | 561 | 环境scope、route学习与持久化 |
| T3 `apps/server/src/environment/DirectEndpoints.ts` | 43 | 地址来源、接口过滤和晚到更新；不能凭空发现未发布地址 |
| T3 `packages/client-runtime/src/rpc/session.ts` | 317 | 首份server-config与ready资格 |
| T3 `packages/client-runtime/src/state/threads.ts` | 504 | sequence去重、cursor与同步marker |
| T3 `apps/server/src/peer/PeerLinks.ts` | 559 | 受限跨环境会话及重新核身份 |
| T3 `apps/server/src/peer/PeerForwarding.ts` | 100 | 工具转发与调用者mode边界 |
| T3 `apps/server/src/peer/RemoteDelegation.ts` | 514 | 远端任务/重启跟踪与取消 |
| 外心 `crates/exomind-beta-host/src/peers/network.rs` | 214 | OS地址、发现、路由、有限同步的当前实现 |

T3行号对应上述固定提交。官方远程架构说明：[Remote architecture](https://github.com/pingdotgg/t3code/blob/e313a122452835da330feef41d0b74a4d2eddbeb/docs/internals/remote.md)、[Connection runtime](https://github.com/pingdotgg/t3code/blob/e313a122452835da330feef41d0b74a4d2eddbeb/docs/internals/connection-runtime.md)。EasyTier角色依据：[官方仓库](https://github.com/EasyTier/EasyTier)、[2.7.0发行](https://github.com/EasyTier/EasyTier/releases/tag/v2.7.0)；CLI实读而非仅凭“同网”判断当前端口可达。
