# 已完成功能需求拆分

> 文档版本：v1.0
> 创建时间：2026-02-10
> 状态：历史拆分文档。Pouch 相关内容仅作归档，不代表当前主链路。

---

## 概述

本文档将早期多设备同步功能的已完成工作拆分为独立需求模块。

当前现行主路径已经切换为：

- `device pairing`
- `RT net / mesh relay`
- `signal SSE`
- `domain projector`
- `RT SQLite`

因此下文中所有 `PouchDB / PouchSyncAdapter / 6984` 相关内容都应视为历史归档。

---

## 需求 1：用户认证系统

### 基本信息

| 字段 | 内容 |
|------|------|
| **功能名称** | 用户注册与登录 |
| **创建日期** | 2026-02-10 |
| **优先级** | P0 |
| **状态** | ✅ 已完成 |
| **关联 PR** | #20 (feature/multi-device-sync) |

### 功能清单

| 功能 | 状态 | 说明 |
|------|------|------|
| 用户注册 | ✅ 完成 | PBKDF2 密码哈希，localStorage 持久化 |
| 用户登录 | ✅ 完成 | 密码验证，会话管理 |
| 退出登录 | ✅ 完成 | 清除会话状态 |
| 用户列表显示 | ✅ 完成 | 显示已注册用户 |

### 核心文件

```
src/
├── adapters/
│   └── crypto-adapter.ts          # 密码哈希实现
├── ui/
│   ├── pages/
│   │   └── UserManagePage.tsx     # 用户管理页面
│   └── stores/
│       └── sync-store.ts           # 用户状态管理
tests/
├── sync/
│   └── crypto.test.ts              # 密码哈希测试
└── e2e/
    └── user-manage.test.ts         # E2E 测试
```

### 测试结果

```
单元测试: 43 pass (crypto.test.ts)
E2E 测试: 用户注册/登录/退出全部通过
控制台: 0 个错误
```

### 测试账号

| 用户名 | 密码 | 状态 |
|--------|------|------|
| testlead | Test123456 | 已验证可用 |

---

## 需求 2：密码哈希模块

### 基本信息

| 字段 | 内容 |
|------|------|
| **功能名称** | PBKDF2 密码哈希 |
| **创建日期** | 2026-02-10 |
| **优先级** | P0 |
| **状态** | ✅ 已完成 |
| **关联 SPEC** | SPEC-302 |

### 功能清单

| 函数 | 状态 | 测试覆盖 |
|------|------|----------|
| generateSalt() | ✅ 完成 | ✅ 3 个测试 |
| sha256() | ✅ 完成 | ✅ 5 个测试 |
| hashPassword() | ✅ 完成 | ✅ 4 个测试 |
| verifyPassword() | ✅ 完成 | ✅ 5 个测试 |
| hashPasswordWithSalt() | ✅ 完成 | ✅ 3 个测试 |

### 核心文件

```
src/adapters/
└── crypto-adapter.ts              # CryptoAdapter 类实现
```

### 技术规格

```
哈希算法: PBKDF2-HMAC-SHA256
迭代次数: 100,000 次
盐长度: 16 字节
哈希格式: $pbkdf2$salt$hash
```

---

## 需求 3：同步测试页面

### 基本信息

| 字段 | 内容 |
|------|------|
| **功能名称** | 同步功能测试 UI |
| **创建日期** | 2026-02-10 |
| **优先级** | P1 |
| **状态** | ✅ 已完成 |

### 功能清单

| 功能 | 状态 | 说明 |
|------|------|------|
| 服务器地址配置 | 历史 | 旧的 Pouch 同步测试入口，当前已退役 |
| 用户登录 | ✅ 完成 | 使用 sync-store 认证 |
| 连接服务器 | 历史 | 当前主路径不再连接 PouchDB Sync Server |
| 测试日志 | ✅ 完成 | 实时显示连接日志 |

### 核心文件

```
src/ui/
├── pages/
│   └── SyncTestPage.tsx          # 同步测试页面
└── stores/
    └── sync-store.ts             # 同步状态管理
```

---

## 需求 4：PouchDB 同步适配器（历史归档）

### 基本信息

| 字段 | 内容 |
|------|------|
| **功能名称** | PouchDB 同步适配器 |
| **创建日期** | 2026-02-10 |
| **优先级** | P1 |
| **状态** | 已退出主链路 |
| **关联 SPEC** | SPEC-301 |

### 功能清单

| 功能 | 状态 | 说明 |
|------|------|------|
| PouchSyncAdapter | 历史 | 旧 Pouch 适配器实现 |
| 冲突解决器 | ✅ 完成 | 多种冲突解决策略 |
| sync-store 集成 | 历史 | 当前 `sync-store` 已不再承载 Pouch transport |

### 核心文件

```
src/
├── adapters/
│   ├── pouch-sync.ts             # PouchSyncAdapter 实现
│   └── crypto-adapter.ts          # 加密适配器
└── lib/
    └── sync/
        ├── interfaces.ts          # 同步接口定义
        └── conflict-resolver.ts   # 冲突解决器
```

### 待修复问题

| 问题 | 影响 | 优先级 | 状态 |
|------|------|--------|------|
| spark-md5 导入错误 | 历史问题 | 中 | 归档 |

> 说明：以上验证结果针对旧的 Pouch 方案，现行同步验收应以 RT-only 链路为准。

---

## Git 提交历史

| 提交 | 描述 |
|------|------|
| 70a57af | feat: 实现加密和旧 PouchDB 适配器 |
| 012d8b3 | feat: 定义同步和加密 Port 接口 |
| b27441d | feat: 实现旧 PouchDB Server 服务端 |
| c8d61c1 | test: 添加加密和冲突解决单元测试 |
| 55ba84f | docs: 修正 SPEC-301 文档 |
| 54fce1b | test: 补充密码哈希函数单元测试 |

---

## 下一步行动

### 短期（合并到 dev 分支）

- [ ] PR #20 审查通过
- [ ] 合并到 dev 分支
- [ ] 删除 feature/multi-device-sync 分支

### 中期（后续迭代）

- [ ] 将本历史文档完全替换为 RT-only 同步里程碑文档
- [ ] 删除剩余旧 Pouch 归档引用
- [ ] 添加同步状态持久化
- [ ] 实现冲突自动解决策略

---

## 关联文档

- `docs/specs/SPEC-301-多设备数据同步.md`
- `docs/specs/SPEC-302-密码哈希模块.md`
- `docs/specs/SPEC-303-sync模块架构.md`
- `docs/specs/SPEC-304-用户认证模块重构.md`
- `pm/memory/logs.md`

---

*文档版本: v1.0*
*最后更新: 2026-02-10*
