# 批次 M1：P0 安全与核心修复

> **状态**：待执行
> **分支**：直接在 `dev` 上开发
> **关联 Issue**：#452, #534, #519, #457
> **执行顺序**：#452 → #534 → #519 → #457

---

## Context

### 当前代码状态

批次 M1 覆盖 4 个安全/代码质量 issue，全部可在 Termux 环境内完成（无需真机/多设备）。

**#452 硬编码 API 密钥清理 + 日志凭据脱敏**：
- `.env.example` 包含占位密钥（`sk-your-key-here` 等），实际 `.env` 已在 `.gitignore` 中。ASR 端点认证已在 `e59048a` 修复，CSP 已决策推迟。剩余工作：日志脱敏。
- `src/lib/adapters/asr/moss-asr.ts:106` 和 `:261` — 日志输出 API Key 前 8 位 + `***`，仍有泄露风险。
- `src/lib/adapters/asr/volcano-engine-asr.ts:156` — 日志输出 AppKey 前 8 位。
- `src/backend/server.ts:350` — `console.log` 输出 APP_KEY / ACCESS_KEY 是否已配置（布尔值，风险低但应统一脱敏）。

**#534 安全修复 + 死代码清理**：
- `src-tauri/src/commands/runtime_commands.rs` — `RuntimeServiceStatus` 的 `auth_secret` 字段（行 64）通过 IPC 明文返回给前端。`compose_status()` 在行 112 赋值。
- `src/lib/types/agent-hub-runtime.ts:29` — 前端类型定义暴露 `authSecret` 字段。
- `src/lib/adapters/tauri-runtime-adapter.ts:26` — 适配器传递 `authSecret`。
- `src/config/runtime-target.ts` — 多处读取/传递 `authSecret`。
- 三个高度相似的备份服务：`eventlog-backup.service.ts`、`task-backup.service.ts`、`timeblock-backup.service.ts`。

**#519 收敛前端环境变量暴露面**：
- `vite.config.ts:95` — `envPrefix: ["VITE_", "EXOMIND_"]`，导致所有 `EXOMIND_*` 变量进入 `import.meta.env`。
- 前端代码中 `import.meta.env.EXOMIND_*` 读取点：
  - `src/adapters/pouch-sync.ts:65` — `EXOMIND_SYNC_AUTH_MODE`
  - `src/config/runtime-target.ts:38` — `EXOMIND_RT_PORT`
- 其余 `EXOMIND_*` 变量（如 `EXOMIND_WEB_PORT`、`EXOMIND_POUCHDB_PORT` 等）仅在 Node/server 端使用，不应暴露给浏览器。

**#457 Rust unwrap 消除 + Cargo.toml edition 修正 + 依赖更新**：
- `crates/exomind-runtime/Cargo.toml` — `edition = "2024"`（Rust 无此版本，应为 `"2021"`）。
- `src-tauri/Cargo.toml` — `edition = "2021"`（正确）。
- `src-tauri/src/commands/asr_commands.rs` — 4 处 `try_into().unwrap()` 解析网络数据（行 263, 264, 304, 314），可导致 panic。
- `src-tauri/src/commands/file_commands.rs:74` — 路径遍历仅用 `contains("..")`，不够安全。
- `crates/exomind-runtime/` — 共 709 处 `.unwrap()` 调用，Top 5 文件：
  - `routes/eventlog.rs`（131 处）
  - `routes/tasks.rs`（100 处）
  - `lib.rs`（69 处）
  - `task/store.rs`（53 处）
  - `session/store.rs`（48 处）

### 本批次范围

M1 只做 Termux 环境可验证的安全修复和代码质量改进。不涉及 CSP 配置、多设备联调、UI 功能变更。

---

## 步骤 1：#452 硬编码 API 密钥清理 + 日志凭据脱敏

### 1.1 改动

#### 1.1.1 创建通用脱敏工具函数

**文件**：`src/lib/utils/redact.ts`（★ 新建）

```ts
// ★ 新增
/**
 * 脱敏敏感字符串，仅保留长度信息。
 * 空或 undefined → '(未配置)'
 * 短于 4 字符 → '***'
 * 其余 → '***（N 位）'
 */
export function redactSecret(value: string | undefined | null): string {
  if (!value) return '(未配置)';
  if (value.length < 4) return '***';
  return `***(${value.length}位)`;
}
```

#### 1.1.2 修复 MOSS ASR 日志泄露

**文件**：`src/lib/adapters/asr/moss-asr.ts`

- **行 106**：将 `${this.config.apiKey ? \`${this.config.apiKey.slice(0, 8)}***\` : '未配置'}` 改为 `${redactSecret(this.config.apiKey)}`。
- **行 261**：将 `Authorization: \`Bearer ${apiKey.slice(0, 8)}***\`` 改为 `Authorization: 'Bearer ***'`。日志不应包含任何 key 片段。

#### 1.1.3 修复 Volcano ASR 日志泄露

**文件**：`src/lib/adapters/asr/volcano-engine-asr.ts`

- **行 156**：将 `${this.config.appKey.slice(0, 8)}***` 改为 `${redactSecret(this.config.appKey)}`。

#### 1.1.4 修复 server.ts 控制台日志

**文件**：`src/backend/server.ts`

- **行 350**：保持布尔值判断即可（`已配置` / `未配置`），但确认不输出实际值。检查同文件其他 `console.log` 是否泄露 key。

#### 1.1.5 确认 .env 不在版本控制中

- 验证 `.gitignore` 包含 `.env`（不含 `.env.example`）。
- `.env.example` 中的占位值（`your_api_key_here`、`sk-your-key-here`）保留，这是标准做法。

### 1.2 验证

```bash
# 日志脱敏：确认无 key 片段输出
grep -rn 'slice(0' src/lib/adapters/asr/ --include='*.ts'
# 期望：0 行结果

# 脱敏工具函数存在
grep -rn 'redactSecret' src/lib/utils/redact.ts
# 期望：导出函数定义

# .env 在 gitignore 中
grep '^\.env$' .gitignore
# 期望：匹配到 .env

# 类型检查
npx tsc --noEmit

# 单测（如果有 redact 测试）
npx vitest run src/lib/utils/redact
```

---

## 步骤 2：#534 安全修复 + 死代码清理

### 2.1 改动

#### 2.1.1 Rust 端移除 auth_secret 从 IPC 返回

**文件**：`src-tauri/src/commands/runtime_commands.rs`

- **行 64**：从 `RuntimeServiceStatus` 结构体中移除 `pub auth_secret: Option<String>` 字段。
- **行 112**：从 `compose_status()` 中移除 `auth_secret: inner.auth_secret.clone()` 赋值。
- 注意：内部 `RuntimeState`（行 21）仍需保留 `auth_secret`，因为 runtime 启动/鉴权逻辑依赖它。只是不通过 IPC 暴露给前端。
- 更新测试（行 ~597-623）：移除断言 `status.auth_secret` 的测试用例，或改为验证 `auth_secret` 不在返回结构中。

#### 2.1.2 前端类型移除 authSecret 暴露

**文件**：`src/lib/types/agent-hub-runtime.ts`

- **行 29**：删除 `authSecret?: string;` 字段。

**文件**：`src/lib/adapters/tauri-runtime-adapter.ts`

- **行 26**：移除 `authSecret: status.authSecret` 映射。

**文件**：`src/config/runtime-target.ts`

- 评估 `authSecret` 的使用路径。如果前端需要知道"runtime 是否需要鉴权"但不需要实际 secret 值，可改为传递布尔标志 `authRequired: boolean`。
- **行 24**：`authSecret?: string` → `authRequired?: boolean`（或直接删除，看下游是否只做存在性检查）。
- **行 88**：对应修改解析逻辑。
- **行 148-149**：`resolveEmbeddedAuthToken()` — 这个函数是给前端发请求时附加 auth header 用的，不是暴露给 UI 的。需要保留功能但改为从安全存储读取，不放在全局状态中。

#### 2.1.3 authSecret 传播链收敛

需要追踪以下文件中的 `authSecret` 使用，判断哪些是「sync 鉴权凭据」（合理保留）、哪些是「runtime auth_secret 明文暴露」（需移除）：

| 文件 | 用途 | 处理 |
|------|------|------|
| `src/adapters/pouch-sync.ts:99` | sync 鉴权 | 保留（sync 凭据，非 runtime secret） |
| `src/environment/interfaces/sync.port.ts:110` | sync port 类型 | 保留 |
| `src/lib/profile/identity-link-storage.ts` | identity 鉴权 | 保留 |
| `src/lib/profile/profile-types.ts:42` | profile 类型 | 保留 |
| `src/ui/stores/sync-store.ts` | sync 状态管理 | 保留 |
| `src/ui/app/components/settings/settings-custom-items.tsx:674` | 设置页面解析 | 保留 |
| `src/config/runtime-target.ts:339` | runtime 状态构建 | ★ 移除 authSecret 明文传递 |
| `src/lib/adapters/tauri-runtime-adapter.ts:26` | IPC 映射 | ★ 移除 |

#### 2.1.4 备份服务收敛（可选，如时间允许）

**文件**：
- `src/lib/services/eventlog-backup.service.ts`
- `src/lib/services/task-backup.service.ts`
- `src/lib/services/timeblock-backup.service.ts`

三者逻辑高度相似。可提取通用 `BackupService<T>` 基类或工厂函数。但这属于 refactor，不是安全修复。**如果时间紧张，跳过此项**，仅在 issue 评论中标注"备份服务收敛推迟"。

### 2.2 验证

```bash
# Rust 编译通过
cd src-tauri && cargo build 2>&1 | tail -5

# Rust 测试通过
cd src-tauri && cargo test 2>&1 | tail -10

# IPC 返回不含 auth_secret
grep -n 'auth_secret' src-tauri/src/commands/runtime_commands.rs | grep -v 'RuntimeState\|inner\.'
# 期望：仅 RuntimeState 内部保留，RuntimeServiceStatus 中无此字段

# 前端类型无 authSecret 暴露
grep -n 'authSecret' src/lib/types/agent-hub-runtime.ts
# 期望：0 行

# 类型检查
npx tsc --noEmit

# 相关测试
npx vitest run --reporter=verbose 2>&1 | tail -20
```

---

## 步骤 3：#519 收敛前端 EXOMIND_/VITE_ 环境变量暴露面

### 3.1 改动

#### 3.1.1 修改 Vite envPrefix

**文件**：`vite.config.ts`

- **行 95**：将 `envPrefix: ["VITE_", "EXOMIND_"]` 改为 `envPrefix: ["VITE_"]`。
- 这确保只有 `VITE_*` 变量进入 `import.meta.env`。

#### 3.1.2 迁移前端需要的 EXOMIND_ 变量

前端 `import.meta.env` 中使用的 `EXOMIND_*` 变量需要桥接：

| 变量 | 使用位置 | 处理方案 |
|------|---------|---------|
| `EXOMIND_SYNC_AUTH_MODE` | `src/adapters/pouch-sync.ts:65` | 改为读取 `VITE_SYNC_AUTH_MODE`（已有 fallback） |
| `EXOMIND_RT_PORT` | `src/config/runtime-target.ts:38` | 改为 `VITE_RT_PORT` 或通过 Tauri IPC 获取 |

**文件**：`src/adapters/pouch-sync.ts`

- **行 65**：移除 `import.meta.env?.EXOMIND_SYNC_AUTH_MODE ||`，只保留 `import.meta.env?.VITE_SYNC_AUTH_MODE || processEnv?.EXOMIND_SYNC_AUTH_MODE`。
- **行 67**：`processEnv?.EXOMIND_SYNC_AUTH_MODE` 保留（Node 端使用，不经过 Vite）。

**文件**：`src/config/runtime-target.ts`

- **行 38**：将 `import.meta.env.EXOMIND_RT_PORT` 改为 `import.meta.env.VITE_RT_PORT`。
- 同步更新 `.env.example` 添加 `VITE_RT_PORT` 说明。

#### 3.1.3 更新 TypeScript 类型声明

**文件**：`src/vite-env.d.ts`

- 移除所有 `EXOMIND_*` 的类型声明（如果有）。
- 如果新增了 `VITE_RT_PORT`，添加对应声明。

#### 3.1.4 确认无遗漏的 import.meta.env.EXOMIND_ 引用

```bash
grep -rn 'import\.meta\.env.*EXOMIND_' src/ --include='*.ts' --include='*.tsx'
```

所有匹配项必须为 0 或已经迁移到 `VITE_` 前缀 / Node processEnv。

### 3.2 验证

```bash
# 无残留 import.meta.env.EXOMIND_ 引用
grep -rn 'import\.meta\.env.*EXOMIND_' src/ --include='*.ts' --include='*.tsx'
# 期望：0 行

# envPrefix 已收敛
grep 'envPrefix' vite.config.ts
# 期望：envPrefix: ["VITE_"]

# 类型检查
npx tsc --noEmit

# 开发服务器启动正常
npx vite --host 0.0.0.0 --port 5173 &
sleep 3
curl -sS -D - -o /dev/null http://127.0.0.1:5173 | head -n 8
# 期望：HTTP 200
kill %1
```

---

## 步骤 4：#457 Rust unwrap 消除 + Cargo.toml edition 修正

### 4.1 改动

#### 4.1.1 修正 Cargo.toml edition

**文件**：`crates/exomind-runtime/Cargo.toml`

- 将 `edition = "2024"` 改为 `edition = "2021"`。

#### 4.1.2 消除 asr_commands.rs 网络解析 unwrap

**文件**：`src-tauri/src/commands/asr_commands.rs`

- **行 263**：`u32::from_be_bytes(data[4..8].try_into().unwrap())` → `u32::from_be_bytes(data[4..8].try_into().map_err(|_| "错误响应 error_code 字节解析失败".to_string())?)`
- **行 264**：`u32::from_be_bytes(data[8..12].try_into().unwrap())` → 同上模式，改用 `?`。
- **行 304**：`i32::from_be_bytes(data[offset..offset + 4].try_into().unwrap())` → 同上。
- **行 314**：`u32::from_be_bytes(data[offset..offset + 4].try_into().unwrap())` → 同上。

注意：这些 `.try_into()` 对固定长度切片应该永远成功（4 bytes → [u8; 4]），但前面的长度检查可能被绕过。使用 `?` 更安全。

#### 4.1.3 加固 file_commands.rs 路径遍历检查

**文件**：`src-tauri/src/commands/file_commands.rs`

- **行 74**：将 `if full_path.to_string_lossy().contains("..") { ... }` 替换为：

```rust
// ★ 替换
let canonical = full_path.canonicalize().map_err(|e| format!("路径规范化失败: {e}"))?;
let base_canonical = base_dir.canonicalize().map_err(|e| format!("基础路径规范化失败: {e}"))?;
if !canonical.starts_with(&base_canonical) {
    return Err("路径遍历检测：路径超出允许范围".into());
}
```

#### 4.1.4 crates/ 下 unwrap 消除策略

`crates/exomind-runtime/` 有 709 处 `.unwrap()`，全量替换不在本批次范围。**本批次只处理**：

1. **网络/外部输入相关的 unwrap**（可导致 DoS）— 即 `asr_commands.rs` 中的 4 处（步骤 4.1.2）。
2. **file_commands.rs 测试代码中的 unwrap**（行 649, 670, 683）— 测试代码中 `.unwrap()` 可接受，**不改**。

crates/ 下 709 处的系统性消除创建单独 issue 跟踪。

### 4.2 验证

```bash
# edition 已修正
grep 'edition' crates/exomind-runtime/Cargo.toml
# 期望：edition = "2021"

# asr_commands.rs 无 unwrap（排除测试）
grep -n '\.unwrap()' src-tauri/src/commands/asr_commands.rs
# 期望：0 行

# 路径遍历使用 canonicalize
grep -n 'canonicalize' src-tauri/src/commands/file_commands.rs
# 期望：有匹配

# Rust 编译
cd src-tauri && cargo build 2>&1 | tail -5

# Cargo clippy 无 warning
cd src-tauri && cargo clippy -- -D warnings 2>&1 | tail -10

# Rust 测试
cd src-tauri && cargo test 2>&1 | tail -10

# crates 编译
cd crates/exomind-runtime && cargo build 2>&1 | tail -5
```

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
|------|---------|-------|
| `src/lib/utils/redact.ts` | 新建 | #452 |
| `src/lib/adapters/asr/moss-asr.ts` | 修改（日志脱敏） | #452 |
| `src/lib/adapters/asr/volcano-engine-asr.ts` | 修改（日志脱敏） | #452 |
| `src/backend/server.ts` | 审查/微调 | #452 |
| `src-tauri/src/commands/runtime_commands.rs` | 修改（移除 auth_secret 暴露） | #534 |
| `src/lib/types/agent-hub-runtime.ts` | 修改（移除 authSecret） | #534 |
| `src/lib/adapters/tauri-runtime-adapter.ts` | 修改（移除 authSecret 映射） | #534 |
| `src/config/runtime-target.ts` | 修改（authSecret → authRequired 或移除） | #534 |
| `vite.config.ts` | 修改（envPrefix 收敛） | #519 |
| `src/adapters/pouch-sync.ts` | 修改（移除 EXOMIND_ import.meta.env） | #519 |
| `src/config/runtime-target.ts` | 修改（EXOMIND_RT_PORT → VITE_RT_PORT） | #519 |
| `src/vite-env.d.ts` | 修改（类型声明收敛） | #519 |
| `crates/exomind-runtime/Cargo.toml` | 修改（edition 修正） | #457 |
| `src-tauri/src/commands/asr_commands.rs` | 修改（unwrap → ?） | #457 |
| `src-tauri/src/commands/file_commands.rs` | 修改（路径遍历加固） | #457 |

---

## 不要做清单

| 禁止项 | 原因 |
|--------|------|
| 不要修改 Tauri CSP 配置 | #452 已决策 CSP 推迟到产品上线公网阶段 |
| 不要全量消除 crates/ 下 709 处 unwrap | 超出 M1 范围，应创建独立 issue 跟踪 |
| 不要重构三个备份服务为通用基类 | 纯 refactor 非安全修复，时间不够可跳过 |
| 不要改动 sync 相关的 authSecret（pouch-sync、sync-store 等） | 这是 sync 鉴权凭据，与 runtime auth_secret 暴露是不同问题 |
| 不要删除 `.env.example` 中的占位值 | 占位值是标准做法，帮助开发者了解需要配置哪些变量 |
| 不要引入新的 npm/cargo 依赖 | 用已有工具即可完成所有改动 |
| 不要修改 ASR 端点认证逻辑 | #452 中 ASR 认证已在 `e59048a` 修复 |
| 不要改动 `src-tauri/src/commands/file_commands.rs` 中测试代码的 unwrap | 测试中 unwrap 是标准做法 |
| 不要改动 Node/server 端的 `process.env.EXOMIND_*` 读取 | 只收敛前端 `import.meta.env`，服务端环境变量不受影响 |

---

## 容易出错的关键点

1. **#534 authSecret 分辨 runtime vs sync**：`authSecret` 在代码中有两个含义——runtime 管理鉴权（应移除暴露）和 sync 数据库鉴权（应保留）。改动时必须区分 `runtime-target.ts` / `tauri-runtime-adapter.ts`（移除）与 `pouch-sync.ts` / `sync-store.ts`（保留）。

2. **#519 envPrefix 改动影响范围**：移除 `"EXOMIND_"` 后，所有 `import.meta.env.EXOMIND_*` 读取将变为 `undefined`。必须先搜索所有前端引用点并逐一迁移，否则运行时静默失败。

3. **#457 edition "2024" vs "2021"**：Rust 2024 edition 在 nightly 中存在但尚未稳定。修改 edition 可能触发编译差异（如 `gen` 关键字保留等），改后必须完整编译验证。

4. **#457 canonicalize 需要路径存在**：`std::fs::canonicalize()` 要求路径已存在于文件系统。如果用于创建新文件的场景，需要先 canonicalize 父目录再拼接文件名。

5. **#452 日志脱敏不要用 slice**：`apiKey.slice(0, 8)` 看似"部分脱敏"，实际泄露了 key 前缀，足以缩小暴力破解范围。正确做法是完全不输出 key 内容，只输出"已配置/未配置"或长度信息。

6. **#534 Rust 测试中的 auth_secret 断言**：`runtime_commands.rs` 行 597-623 有测试断言 `status.auth_secret`。移除字段后必须同步更新测试，否则编译失败。

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 日志无 key 片段 | `grep -rn 'slice(0' src/lib/adapters/asr/` | 0 行匹配 | #452 |
| .env 在 gitignore | `grep '^\.env$' .gitignore` | 匹配 | #452 |
| IPC 不含 auth_secret | `grep 'auth_secret' src-tauri/src/commands/runtime_commands.rs` | 仅 RuntimeState 内部 | #534 |
| 前端类型无 authSecret | `grep 'authSecret' src/lib/types/agent-hub-runtime.ts` | 0 行 | #534 |
| envPrefix 已收敛 | `grep 'envPrefix' vite.config.ts` | 仅含 `VITE_` | #519 |
| 无残留 EXOMIND_ 前端引用 | `grep -rn 'import\.meta\.env.*EXOMIND_' src/` | 0 行 | #519 |
| edition 已修正 | `grep 'edition' crates/exomind-runtime/Cargo.toml` | `"2021"` | #457 |
| asr 无 unwrap | `grep '\.unwrap()' src-tauri/src/commands/asr_commands.rs` | 0 行 | #457 |
| 路径遍历用 canonicalize | `grep 'canonicalize' src-tauri/src/commands/file_commands.rs` | 有匹配 | #457 |
| TypeScript 编译通过 | `npx tsc --noEmit` | 无错误 | 全部 |
| Vitest 通过 | `npx vitest run` | 全部通过 | 全部 |
| Rust 编译通过 | `cargo build` (in src-tauri/) | 成功 | #534 #457 |
| Cargo clippy 通过 | `cargo clippy -- -D warnings` | 无 warning | #457 |
| Cargo test 通过 | `cargo test` (in src-tauri/) | 全部通过 | #534 #457 |

---

## 完成回填

（Codex 执行后填写）

| Issue | 状态 | Commit | 备注 |
|-------|------|--------|------|
| #452 | | | |
| #534 | | | |
| #519 | | | |
| #457 | | | |
