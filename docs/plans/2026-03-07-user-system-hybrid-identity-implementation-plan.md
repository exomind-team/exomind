# Hybrid Identity 用户系统 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将当前“本地用户 + 同步登录”重构为 `LocalProfile（本地档案） + optional RemoteIdentity（可选远端身份）` 的混合式身份系统，并保持 Web-first（Web 优先）可运行。

**Architecture:** 以兼容迁移（compatible migration，兼容迁移）为主，不做一次性大爆炸重写。先在现有 `sync-store` 上引入 `profile` / `identity link` / `sync runtime` 三层语义和持久化结构，再逐步把 UI、同步适配器与存储命名空间从 `username` 迁移到 `profileId` 与 `remote identity key`。

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, Playwright, PouchDB, localStorage persistence（本地持久化）

---

### Task 1: 建立本地档案模型与兼容迁移

**Files:**
- Create: `src/lib/profile/profile-storage.ts`
- Create: `tests/unit/profile/profile-storage.test.ts`
- Modify: `src/ui/stores/sync-store.ts`

**Step 1: Write the failing test**

- 新增测试覆盖：
  - 旧 `exomind:users` 可迁移为 `LocalProfile` 列表
  - 旧 `currentUser` 可迁移为 `activeProfileId`
  - 注册新档案创建 `profileId` 而非仅存用户名

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/profile/profile-storage.test.ts`

**Step 3: Write minimal implementation**

- 实现 `LocalProfile` / `ProfileSecret` / 迁移函数
- 在 `sync-store` 中接入 `profile` 读写，但保留旧兼容字段 `currentUser` / `isLoggedIn`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/profile/profile-storage.test.ts tests/unit/sync-store.test.ts`

---

### Task 2: 建立可选远端身份绑定（Identity Link）

**Files:**
- Create: `src/lib/profile/identity-link-storage.ts`
- Create: `tests/unit/profile/identity-link-storage.test.ts`
- Modify: `src/ui/stores/sync-store.ts`

**Step 1: Write the failing test**

- 新增测试覆盖：
  - 档案可链接一个远端身份
  - 本地密码哈希不会被复用为远端 secret（远端机密）
  - 断开远端身份后，本地档案仍可正常使用

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/profile/identity-link-storage.test.ts`

**Step 3: Write minimal implementation**

- 实现 `IdentityLink` / `IdentityLinkSecret`
- 在 `sync-store` 中加入 `linkRemoteIdentity` / `unlinkRemoteIdentity`
- 远端同步凭据改为来源于 `IdentityLinkSecret`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/profile/identity-link-storage.test.ts tests/unit/security.test.ts tests/unit/sync-store.test.ts`

---

### Task 3: 升级同步适配器与命名空间

**Files:**
- Modify: `src/adapters/pouch-sync.ts`
- Modify: `src/environment/interfaces/sync.port.ts`
- Modify: `src/lib/sync/remote-db-url.ts`
- Create: `tests/unit/sync/remote-db-url.profile.test.ts`

**Step 1: Write the failing test**

- 新增测试覆盖：
  - 同步目标由 `remoteIdentityKey（远端身份键）` 决定，而不是 `currentUser`
  - 本地未链接远端身份时，`connect()` 拒绝并提示先连接同步身份
  - 兼容 legacy（旧版）场景的 URL 构造

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sync/remote-db-url.profile.test.ts`

**Step 3: Write minimal implementation**

- 扩展 `SyncCredentials` 支持 `remoteIdentityKey` 与远端 secret
- `PouchSyncAdapter` 改为优先使用远端身份键连接远端库

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sync/remote-db-url.profile.test.ts tests/unit/sync-store.test.ts`

---

### Task 4: 重构用户 UI 为档案/同步身份 UI

**Files:**
- Modify: `src/ui/app/components/UserCard.tsx`
- Modify: `src/ui/app/components/SwitchAccountSheet.tsx`
- Modify: `src/ui/pages/UserManagePage.tsx`
- Create: `tests/unit/components/settings/UserCard.hybrid-identity.test.tsx`
- Create: `tests/unit/components/settings/SwitchAccountSheet.hybrid-identity.test.tsx`

**Step 1: Write the failing test**

- 新增测试覆盖：
  - 未打开档案时展示“打开档案 / 新建档案”
  - 已打开档案未连接远端时展示“连接同步”
  - 已连接远端时展示“同步已连接 / 断开同步”
  - 切换档案不要求远端登录

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/settings/UserCard.hybrid-identity.test.tsx tests/unit/components/settings/SwitchAccountSheet.hybrid-identity.test.tsx`

**Step 3: Write minimal implementation**

- UI 术语从 `user/account（用户/账户）` 收敛到 `profile/sync identity（档案/同步身份）`
- 保留兼容入口与基础交互体验

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/settings/UserCard.hybrid-identity.test.tsx tests/unit/components/settings/SwitchAccountSheet.hybrid-identity.test.tsx tests/ui/user-manage.test.tsx`

---

### Task 5: 迁移业务使用点与补集成测试

**Files:**
- Modify: `src/lib/storage/event-storage.ts`
- Modify: `src/lib/storage/active-block-storage.ts`
- Modify: `src/components/Chat/ChatPage.tsx`
- Modify: `src/ui/app/components/TaskSyncCoordinator.tsx`
- Modify: `src/ui/app/components/TimeBlockSyncCoordinator.tsx`
- Modify: `src/ui/app/components/ReminderSyncCoordinator.tsx`
- Modify: `tests/unit/sync-store.test.ts`
- Modify: `tests/unit/security.test.ts`
- Modify: `tests/e2e/eventlog-multi-device-sync.issue27.test.ts`

**Step 1: Write the failing test**

- 新增/恢复测试覆盖：
  - `profileId` 驱动本地隔离
  - 已打开档案但未连接远端时，本地功能仍正常
  - 已连接远端身份时，EventLog 可跨端同步
  - 最关键的 `sync-store` skip 测试恢复为非 skip

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sync-store.test.ts tests/unit/security.test.ts`

**Step 3: Write minimal implementation**

- 业务存储与同步协调器从 `currentUser` 迁到 `activeProfileId/currentProfile/linked identity`
- 尽量保留外部接口兼容，降低改动面

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sync-store.test.ts tests/unit/security.test.ts tests/unit/components/settings/UserCard.hybrid-identity.test.tsx tests/unit/components/settings/SwitchAccountSheet.hybrid-identity.test.tsx`

---

### Task 6: 最终验证（Verification，最终验证）

**Files:**
- Verify only

**Step 1: Type check**

Run: `npx tsc --noEmit`

**Step 2: Unit tests**

Run: `npx vitest run tests/unit/profile/ tests/unit/sync-store.test.ts tests/unit/security.test.ts tests/unit/components/settings/UserCard.hybrid-identity.test.tsx tests/unit/components/settings/SwitchAccountSheet.hybrid-identity.test.tsx tests/ui/user-manage.test.tsx`

**Step 3: Relevant E2E**

Run: `npx vitest run tests/e2e/eventlog-multi-device-sync.issue27.test.ts`

**Step 4: Build confidence pass**

Run: `bun run build`

---

## 实施原则

1. **先红后绿（Red-Green，先失败后通过）**：每一轮都先写失败测试；
2. **兼容迁移优先**：当前 `currentUser/isLoggedIn` 可以作为过渡 alias（别名），但内部语义逐步转到 `profile`；
3. **远端身份可选**：不能让本地档案依赖远端身份存在；
4. **本地密码与远端凭据分离**：安全边界不能再混用；
5. **优先 Web-first 验证**：先保证前端与同步链路可运行，再考虑更深的桌面端联调。

