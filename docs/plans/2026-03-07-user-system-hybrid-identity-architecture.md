# 用户系统架构方案（Hybrid Identity / 混合式身份）

- 日期：`2026-03-07`
- 状态：`Draft / 讨论稿（可直接作为后续 implementation plan，实施计划 的上游设计）`
- 主题：`Local profile（本地档案）` 映射 `remote identity（远端身份）`
- 核心原则：**数据本地优先（local-first，本地优先）**；没有服务器登录也能完整运行个人模式；服务器登录只在**多人联邦（federation，联邦协作）/ 云同步（cloud sync，云同步）**时参与。

---

## 1. 结论先行

ExoMind 的用户系统不采用“纯本地用户”也不采用“纯服务器账号”，而采用 **Hybrid Identity（混合式身份）**：

1. **`LocalProfile`（本地档案）是第一身份**：
   - 应用首次启动即可创建；
   - 不依赖服务器；
   - 承载本地数据、偏好设置、设备级状态；
   - 断网、无账号、无云服务时仍能工作。

2. **`RemoteIdentity`（远端身份）是可选扩展身份**：
   - 只在云同步、多人协作、联邦共享空间时需要；
   - 由具体 `IdentityProvider`（身份提供者）提供，例如 ExoMind Cloud、局域网协作节点、未来联邦节点；
   - 不替代本地档案，只与本地档案建立绑定关系。

3. **同步和协作围绕“档案绑定的远端身份”运作，而不是围绕用户名字符串运作**：
   - 当前仓库里很多逻辑是 `username -> remote db`；
   - 新方案要升级为 `active profile -> linked identity -> remote space（远端空间）`；
   - 这样才能避免“本地密码哈希被误当远端密码”“同名即同人”等语义问题。

一句话总结：**ExoMind 的用户首先是“本机上的一个生命档案”，其次才可能是“网络上的一个协作身份”。**

---

## 2. 背景与现状

从当前代码看，现有“用户系统”已经具备一些雏形，但身份语义尚未拆清：

1. `src/ui/stores/sync-store.ts` 目前同时承担：
   - 本地注册/登录（local auth，本地认证）
   - 当前用户状态（active user，当前用户）
   - 同步凭据（sync credentials，同步凭据）

2. `src/adapters/crypto-adapter.ts` 已接入 `PBKDF2` 密码哈希，这说明本地认证不再是纯明文方案。

3. `src/adapters/pouch-sync.ts` 当前以 `username` 拼接远端数据库 URL，并在某些模式下把 `passwordHash` 传给远端 basic auth，这会把“本地凭据”和“远端凭据”混成一层。

4. `src/lib/storage/event-storage.ts`、`src/lib/storage/active-block-storage.ts` 已开始依据 `currentUser` 做本地分库，这说明“本地用户隔离”方向是对的，但当前键仍然偏向字符串用户名，而不是稳定的 `profileId`。

因此，当前系统的真正问题不是“没有用户系统”，而是：

- **本地身份（local identity，本地身份）** 和 **远端身份（remote identity，远端身份）** 还没有被正式区分；
- **同步空间（sync space，同步空间）** 仍过度依赖 `username`；
- “个人离线模式”和“网络协作模式”还没有被设计成同一套一致的模型。

---

## 3. 目标与非目标

## 3.1 目标（Goals，目标）

1. **单机可用**：没有服务器、没有网络、没有远端账号时，ExoMind 仍可完整运行。
2. **多档案隔离**：同一设备可以有多个 `LocalProfile`（本地档案），数据相互隔离。
3. **按需联网**：只有当用户显式启用同步/协作时，才需要链接 `RemoteIdentity`（远端身份）。
4. **身份语义清晰**：本地密码只用于本地解锁/认证，远端令牌只用于远端登录/刷新，不再混用。
5. **可扩展到多人联邦**：未来可支持 shared workspace（共享空间）、member（成员）、role（角色）、invite（邀请）、provider（提供者）。

## 3.2 非目标（Non-goals，非目标）

1. 不在本阶段引入复杂 IAM（Identity and Access Management，统一身份权限平台）。
2. 不在本阶段做跨提供者账号合并（account merge，账号合并）。
3. 不要求所有本地数据都必须加密；本阶段先明确边界，分层设计，再决定哪些域需要透明加密。
4. 不要求“服务器登录”成为产品默认入口；默认入口仍应是本地档案创建/选择。

---

## 4. 备选模型比较

## 4.1 方案 A：Local-only Identity（纯本地身份）

优点：

- 最符合 local-first；
- 实现简单；
- 离线体验最好。

缺点：

- 无法自然支撑多人协作；
- 云同步只能退化为“用户名共享远端库”；
- 无法表达 membership（成员关系）、workspace（协作空间）、invite（邀请）。

## 4.2 方案 B：Remote-first Identity（纯服务器账号）

优点：

- 权限模型统一；
- 多人协作、云同步容易扩展；
- 服务端可统一控制用户生命周期。

缺点：

- 违背“本地优先”；
- 首次使用必须联网或至少依赖服务端概念；
- 个人单机模式被绑到服务器。

## 4.3 方案 C：Hybrid Identity（混合式身份）【推荐】

核心做法：

- 本地永远先有 `LocalProfile`；
- 远端仅作为该档案的“网络投影（network projection，网络映射）”；
- 一个本地档案可以：
  - 不绑定任何远端身份；
  - 绑定一个远端身份；
  - 未来扩展为绑定多个远端身份（例如 Cloud + Federation）。

为什么推荐：

1. 它保留了 local-first 的产品哲学；
2. 它允许个人模式和协作模式共存；
3. 它能自然承接当前代码中已有的“本地分库 + 同步扩展”形态；
4. 它最适合 ExoMind 这种“先是个人生命档案，再是网络协作节点”的产品定位。

---

## 5. 核心概念模型

本方案建议把“用户系统”拆成 5 个一等概念（first-class concepts，一等概念）。

## 5.1 `LocalProfile`（本地档案）

表示“这台设备上的一个独立人格/使用者档案”。它是**本地真身（local source of truth，本地真实源）**。

建议字段：

```ts
type LocalProfile = {
  profileId: string;            // 稳定主键（stable id，稳定 ID）
  slug: string;                 // 本地可读标识（如 hailay）
  displayName: string;          // 展示名
  avatar?: string;              // 头像引用
  createdAt: string;
  updatedAt: string;
  authMode: 'none' | 'pin' | 'password' | 'biometric';
  state: 'active' | 'archived';
  defaultSyncPolicy: 'local-only' | 'manual-link' | 'auto-sync-when-linked';
};
```

说明：

- `profileId` 才是本地数据分库和内部关联的根键；
- `slug` / `displayName` 可变，不应用于底层存储主键；
- 当前 `currentUser` 概念后续应逐步迁移为 `activeProfileId`（当前激活档案 ID）。

## 5.2 `ProfileSecret`（档案机密）

表示与本地档案绑定的机密信息，用于本地解锁、令牌保护、未来端到端加密密钥封装。

建议字段：

```ts
type ProfileSecret = {
  profileId: string;
  localPasswordHash?: string;   // 本地密码哈希（PBKDF2/Argon2，密码学后续可升级）
  protectedKeys?: string;       // 被本地口令或系统安全模块保护的密钥包
  updatedAt: string;
};
```

关键原则：

- **本地密码 ≠ 远端密码**；
- **本地密码哈希绝不直接充当远端登录凭据**。

## 5.3 `RemoteIdentity`（远端身份）

表示某个 provider（身份提供者）上的真实网络身份。

```ts
type RemoteIdentity = {
  remoteIdentityId: string;     // provider 内稳定标识
  providerId: string;           // 如 exomind-cloud / self-hosted / federation-x
  providerUserKey: string;      // provider 侧用户键
  displayName?: string;
  capabilities: string[];       // sync / workspace / invite / federation ...
};
```

说明：

- 它不直接拥有本地数据；
- 它只表示“这个本地档案在某个网络上的身份投影”。

## 5.4 `IdentityLink`（身份绑定）

表示 `LocalProfile <-> RemoteIdentity` 的绑定关系，是本方案最关键的桥。

```ts
type IdentityLink = {
  linkId: string;
  profileId: string;
  providerId: string;
  remoteIdentityId: string;
  status: 'linked' | 'expired' | 'revoked';
  syncMode: 'disabled' | 'manual' | 'realtime';
  linkedAt: string;
  lastVerifiedAt?: string;
};
```

说明：

- 一个档案可以没有 link（纯本地）；
- 一个档案可以有一个 active link（单云同步）；
- 未来也可以有多个 link，但同一时刻通常只激活一个 `SyncTarget`（同步目标）。

## 5.5 `RemoteWorkspace`（远端协作空间）

多人联邦/云协作不应该直接绑定在“用户”上，而应该绑定在“空间（workspace，协作空间）”上。

```ts
type RemoteWorkspace = {
  workspaceId: string;
  providerId: string;
  name: string;
  membershipRole: 'owner' | 'admin' | 'member' | 'viewer';
  syncScopes: string[];         // event / task / config / agent-memory ...
};
```

这意味着：

- 个人模式：只需要 `LocalProfile`；
- 云同步个人空间：`LocalProfile + IdentityLink + personal workspace`；
- 多人协作：`LocalProfile + IdentityLink + shared workspace membership`。

---

## 6. 分层架构

建议把用户系统拆成 4 层，而不是继续把所有逻辑塞进 `sync-store`。

```text
UI Layer（界面层）
  ├─ Profile Picker（档案选择器）
  ├─ Profile Settings（档案设置）
  ├─ Link Remote Identity（连接远端身份）
  └─ Workspace & Sync Status（空间与同步状态）

Application Layer（应用层）
  ├─ ProfileSessionService（档案会话服务）
  ├─ IdentityLinkService（身份绑定服务）
  ├─ SyncTargetResolver（同步目标解析器）
  └─ WorkspaceMembershipService（空间成员关系服务）

Domain Layer（领域层）
  ├─ LocalProfile（本地档案）
  ├─ ProfileSecret（档案机密）
  ├─ RemoteIdentity（远端身份）
  ├─ IdentityLink（身份绑定）
  └─ RemoteWorkspace（远端空间）

Infrastructure Layer（基础设施层）
  ├─ Local profile repository（本地档案仓储）
  ├─ Secret vault（机密保管层）
  ├─ Identity provider adapter（身份提供者适配器）
  └─ Sync provider adapter（同步适配器）
```

### 关键重构点

当前 `useSyncStore` 未来应逐步拆为：

1. `useProfileSessionStore`：只关心当前活跃档案、解锁状态；
2. `useIdentityLinkStore`：只关心绑定状态、远端令牌、provider 能力；
3. `useSyncRuntimeStore`：只关心连接状态、冲突、同步统计。

这样本地身份、远端身份、同步运行时三类状态才不会互相污染。

---

## 7. 生命周期与主流程

## 7.1 首次启动（纯本地）

1. 用户打开 ExoMind；
2. 创建 `LocalProfile`；
3. 可选设置本地 PIN / password（口令）保护；
4. 立即开始写本地数据；
5. 系统处于 `local-only mode`（纯本地模式）。

此时**不存在远端身份，也不应该弹服务器登录**。

## 7.2 本地切换档案

1. 用户在 `Profile Picker`（档案选择器）切换档案；
2. `activeProfileId` 改变；
3. 本地数据仓储切换到新的 `profileId` 命名空间；
4. 若该档案存在 `active IdentityLink`，同步运行时再决定是否恢复远端连接。

这里的重点是：**先切本地档案，再决定要不要切远端连接**。

## 7.3 启用云同步 / 联邦协作

1. 用户在某个档案下点击“连接远端身份（link remote identity，连接远端身份）”；
2. 进入 provider 的登录/授权流程；
3. provider 返回 `RemoteIdentity + session token（会话令牌）`；
4. 本地创建 `IdentityLink`；
5. `SyncTargetResolver`（同步目标解析器）根据 `profileId + link + workspace` 决定远端同步空间；
6. 同步开始。

重点：

- 即使第 5 步失败，本地档案仍继续可用；
- 远端错误只能让系统“回落到 local-only”，不能让档案不可用。

## 7.4 多人联邦

1. 用户先有本地档案；
2. 绑定一个远端身份；
3. 加入一个 `RemoteWorkspace`；
4. 由 workspace 决定可同步的数据域与权限；
5. 本地仍保留完整个人数据主权，只有被明确标记的 scope（同步域）会进入共享空间。

这意味着：

- 个人日记未必自动进入团队空间；
- 任务、会议、共享事件流可以按 workspace policy（空间策略）显式选择同步。

---

## 8. 数据命名与命名空间

当前方案里很多地方还用 `username` 作为：

- 本地存储隔离键；
- 远端数据库名；
- UI 展示名；
- 逻辑身份标识。

这四者应该拆开。

## 8.1 本地命名空间

本地仓储统一改为以 `profileId` 作为主隔离键：

- `events_<profileId>`
- `active_blocks_<profileId>`
- `tasks_<profileId>`
- `config_<profileId>`

`displayName` 和 `slug` 只用于 UI 和导出可读性，不用于底层真实主键。

## 8.2 远端命名空间

远端同步空间不再直接使用裸 `username`，而改为 `remoteSpaceKey`（远端空间键）：

```ts
type RemoteSpaceKey = {
  providerId: string;
  remoteIdentityId: string;
  workspaceId: string;          // 个人空间也可视作 personal workspace
  scope: string;                // event / task / config ...
};
```

可以序列化为：

```text
spaces/<provider>/<workspace>/<scope>
```

或 provider 允许的等价 DB 名规则。

好处：

1. 不再把“名字相同”误判为“同一人”；
2. 个人空间与共享空间可以共存；
3. 后续可以支持“一个人多个空间、多种 scope”。

---

## 9. 安全边界

## 9.1 本地认证（Local Auth，本地认证）

本地认证只处理：

- 当前设备上谁可以解锁这个档案；
- 谁可以读取该档案下受保护的机密材料；
- 谁可以切换到该档案。

建议延续当前 `PBKDF2` 实现作为阶段一，后续可升级 `Argon2id`。

## 9.2 远端认证（Remote Auth，远端认证）

远端认证只处理：

- 该档案是否被授权连接某个 provider；
- 该档案是否有权加入某个 workspace；
- 会话令牌是否过期、撤销、刷新。

关键约束：

1. **不再复用 `localPasswordHash -> remote password`**；
2. 远端返回的 token 只存入 `Secret vault`（机密保管层）；
3. token 过期 ≠ 档案登出；只能让同步暂停。

## 9.3 数据同步安全

建议同步层支持 3 个等级：

1. `LocalOnly`：纯本地，不连接远端；
2. `LinkedPlainSync`：已链接远端，明文业务文档同步（适合开发阶段与低敏数据）；
3. `LinkedEncryptedSync`：已链接远端，业务 payload（负载）加密后同步（未来阶段）。

这样可以先完成身份语义，再逐步强化加密。

---

## 10. UI / UX 方案

## 10.1 默认入口

默认入口应从“登录/注册”改为“档案（Profile，档案）”：

- 未创建档案：显示“创建我的第一个档案”；
- 已有档案但未解锁：显示“解锁档案”；
- 已解锁未绑定远端：显示“本地模式”；
- 已绑定远端：显示 provider / workspace / sync 状态。

## 10.2 设置页建议信息架构

建议把当前 `UserCard` 语义改成三层：

1. **Profile（档案）**
   - 当前档案名
   - 切换档案
   - 新建档案
   - 本地锁定 / 本地口令

2. **Identity（身份）**
   - 是否已连接远端身份
   - provider 名称
   - 重新登录 / 断开绑定

3. **Sync & Workspace（同步与空间）**
   - 当前同步模式
   - 当前 workspace
   - 同步冲突 / 同步状态 / 最近同步时间

## 10.3 文案建议

避免继续把所有状态都叫“用户”。建议：

- `Profile` → 档案
- `Linked Identity` → 已连接身份
- `Workspace` → 协作空间
- `Local Mode` → 本地模式
- `Cloud Sync` → 云同步
- `Federation` → 联邦协作

这样用户更容易理解：“我现在在本地哪个档案下；这个档案有没有连到网络上的身份；当前同步到哪个空间。”

---

## 11. 对现有代码的重构映射

## 11.1 `sync-store` 的拆分目标

当前：

- `isLoggedIn`
- `currentUser`
- `credentials`
- `connect()` / `disconnect()` / `syncEvents()`

后续建议拆为：

### `profile-session-store`（档案会话状态）

```ts
type ProfileSessionState = {
  activeProfileId: string | null;
  unlockedProfileIds: string[];
  switchProfile: (profileId: string) => Promise<void>;
  lockProfile: (profileId: string) => Promise<void>;
  unlockProfile: (profileId: string, secret: string) => Promise<void>;
};
```

### `identity-link-store`（身份绑定状态）

```ts
type IdentityLinkState = {
  activeLinkId: string | null;
  linkRemoteIdentity: (profileId: string, providerId: string) => Promise<void>;
  unlinkRemoteIdentity: (linkId: string) => Promise<void>;
  refreshRemoteSession: (linkId: string) => Promise<void>;
};
```

### `sync-runtime-store`（同步运行时状态）

```ts
type SyncRuntimeState = {
  state: 'idle' | 'connecting' | 'connected' | 'error';
  currentWorkspaceId: string | null;
  connectSyncTarget: () => Promise<void>;
  disconnectSyncTarget: () => Promise<void>;
  syncScopes: () => Promise<void>;
};
```

## 11.2 本地存储迁移

当前：

- `exomind:users`
- `exomind:sync-store`

建议迁移到：

- `exomind:profiles:index`
- `exomind:profiles:<profileId>:meta`
- `exomind:profiles:<profileId>:secret`
- `exomind:identity-links`
- `exomind:profile-session`
- `exomind:sync-runtime`

迁移原则：

1. 首次启动新版本时把旧 `username` 映射为一个 `profileId`；
2. `currentUser` 迁移为该 profile 的 `slug/displayName`；
3. 旧 `passwordHash` 只进入本地 `ProfileSecret`；
4. 不自动生成远端绑定；远端绑定必须由用户显式创建。

---

## 12. Provider 抽象（身份提供者接口）

建议引入 `IdentityProvider`（身份提供者）接口，避免把未来所有云/联邦逻辑写死到 `PouchSyncAdapter`。

```ts
interface IdentityProvider {
  providerId: string;
  getCapabilities(): Promise<string[]>;
  login(params: { mode?: 'interactive' | 'device-code' }): Promise<{
    remoteIdentity: RemoteIdentity;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
  }>;
  refreshSession(linkId: string): Promise<void>;
  logout(linkId: string): Promise<void>;
  listWorkspaces(linkId: string): Promise<RemoteWorkspace[]>;
}
```

第一阶段只需要一个 provider：

- `self-hosted-sync`（自托管同步）或 `exomind-cloud`（ExoMind 云）

但接口先立住，后续联邦才能长出来。

---

## 13. 错误处理与降级策略

这是本方案必须明确写死的行为语义。

## 13.1 不变量（Invariant，架构不变量）

1. **档案优先于网络**：没有网络也不能阻断本地档案使用。
2. **本地密码不出本地**：本地认证机密不直接作为远端认证材料使用。
3. **身份失效不等于数据丢失**：远端令牌失效只能暂停同步，不能损坏本地数据。
4. **切档案先切本地，再切远端**：本地上下文切换是主动作，远端连接是派生动作。

## 13.2 用户行为语义（Affordance，用户行为语义）

1. “退出云同步” = 停止该档案连接远端，但档案还在。
2. “锁定档案” = 当前设备上隐藏该档案内容，不影响远端身份存在与否。
3. “删除远端绑定” = 解除这个档案对某个 provider 的映射，不删除本地档案。
4. “切换空间” = 切换当前同步目标，不切换本地档案本体。

---

## 14. 分阶段落地

## Phase 0：术语与文档归一

目标：先把“用户 / 档案 / 身份 / 空间 / 同步”五个概念在文档与 UI 文案上拆开。

输出：

- 本文档；
- 修正文案与过时注释；
- 确认未来 store/service 命名。

## Phase 1：本地档案层落地

目标：把“本地用户”正式升级为 `LocalProfile`。

范围：

- 新建 `profiles` 本地仓储；
- `currentUser -> activeProfileId`；
- EventLog / Task / TimeBlock 等存储改为按 `profileId` 隔离；
- 保留旧数据迁移。

## Phase 2：身份绑定层落地

目标：把“服务器登录”从默认入口挪到“可选绑定远端身份”。

范围：

- 建立 `IdentityLink`；
- 远端 token 独立保存；
- UI 加入“连接远端身份”。

## Phase 3：同步层语义升级

目标：从 `username -> remote db` 升级为 `profile -> link -> workspace -> scope`。

范围：

- 新 `SyncTargetResolver`；
- 远端命名空间重构；
- 冲突与状态按 workspace/scope 呈现。

## Phase 4：多人联邦 / 云协作

目标：引入 `workspace membership`（空间成员关系）与协作权限。

范围：

- invite / join / role；
- shared scopes；
- 个人域与共享域共存。

---

## 15. 建议拆分的 issue（Issue Breakdown，问题拆分）

### P0

1. **用户系统术语归一：user -> profile / identity / workspace**
2. **设计并落地 LocalProfile 数据模型与本地迁移**
3. **禁止本地密码哈希复用为远端凭据**

### P1

4. **拆分 sync-store：profile-session / identity-link / sync-runtime**
5. **EventLog / ActiveBlock / Task 改为按 profileId 隔离**
6. **设计 IdentityProvider 接口与首个 self-hosted provider**

### P2

7. **设置页 IA 重构：Profile / Identity / Sync 三段式**
8. **引入 workspace 概念并支持 personal/shared space**
9. **补全跨设备链接、令牌失效、重连、解除绑定测试**

---

## 16. 验收标准（Acceptance Criteria，验收标准）

当以下条件同时满足时，可认为该架构方案落地成功：

1. 新用户首次安装时，不需要任何服务器登录即可创建档案并开始使用；
2. 同一设备上两个 `LocalProfile` 的数据完全隔离；
3. 本地密码只用于本地档案认证，不再被同步层当作远端密码使用；
4. 用户可以在某个档案下显式“连接远端身份”以启用云同步；
5. 远端会话过期时，系统回退到本地模式而不是破坏本地档案；
6. 未来共享空间接入时，不需要推翻本地档案模型。

---

## 17. 推荐的下一步

如果按最小风险路线推进，建议按下面顺序实施：

1. **先做文案和命名清理**：把 `User` 语义拆开；
2. **再做本地档案层**：引入 `profileId`；
3. **再做远端绑定层**：把“服务器登录”挪成可选动作；
4. **最后重构同步目标解析**：替换 `username -> remote db`。

这样可以保证：

- 每一步都向 local-first 更靠近；
- 每一步都能兼容现有产品；
- 每一步都能单独验证和回滚。

---

## 18. 最终判断

对 ExoMind 来说，“用户系统”最好的理解不是传统 SaaS 的“账号系统”，而是：

> **一个本地生命档案系统（LocalProfile System，本地档案系统），按需把档案映射到网络中的一个或多个远端身份与协作空间。**

这比“先有服务器账号，后有本地数据”更符合 ExoMind 的定位，也更符合你提出的唯一原则：

> **数据本地优先，没有服务器登录也能跑，服务器登录只在多人联邦、云同步时使用。**

