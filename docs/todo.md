# ExoMind 文档重构任务跟踪

> 目标：降低认知负担 + 加速开发效率 + 解决文档债务

## 目标结构

```
docs/
├── README.md                    ← 导航入口（3 分钟理解）
├── core/                        ← 核心文档（30 分钟理解）
│   ├── overview.md             # 产品愿景 + 核心价值
│   ├── architecture.md         # 7 层架构总览
│   ├── quickstart.md           # 快速上手指南
│   └── stack.md                # 技术栈选择理由
├── specs/                       ← 开发规格（按需查阅）
│   ├── architecture/           # 架构决策（ADR）
│   ├── modules/                # 模块规格
│   └── api/                    # API 文档
└── plans/                       ← 计划文档
    └── archive/                # 已完成的计划
```

## 执行策略：渐进式迁移（3 轮）

---

## Round 1: 创建目录结构 + 移动核心文档 ✅ 已完成

**时间戳**: 2026-02-05 16:30:00

**完成的任务**:

### 1.1 创建目录结构
- [x] 创建 `docs/core/` 目录
- [x] 创建 `docs/specs/architecture/` 目录
- [x] 创建 `docs/specs/modules/` 目录
- [x] 创建 `docs/specs/api/` 目录
- [x] 创建 `docs/plans/archive/` 目录

### 1.2 移动核心文档

| 源文件 | 目标位置 | 状态 |
|--------|----------|------|
| `docs/README.md` | `docs/README.md` | ✅ 已保留 |
| `docs/02_ExoMind-KNOWLEDGE-BASE.md` | `docs/core/overview.md` | ✅ 已移动 |
| `docs/03_exomind-model_PRD.md` | `docs/core/quickstart.md` | ✅ 已移动 |
| `docs/SOUL.md` | `docs/core/overview.md` | ✅ 已合并 |
| `docs/TECH_STACK_REVIEW.md` | `docs/core/stack.md` | ✅ 已移动 |
| `docs/FRONTEND_STACK.md` | `docs/core/stack.md` | ✅ 已合并 |

**验证结果**: ✅ 所有文档链接已更新

---

## Round 2: 合并和简化文档 ✅ 已完成

**时间戳**: 2026-02-05 16:40:00

### 完成的任务

#### 2.1 创建合并架构文档

- [x] 创建 `docs/core/architecture.md`
- [x] 合并三个源文档内容：
  - `docs/ARCHITECTURE.md` → 项目概述、核心价值、技术栈
  - `docs/ARCHITECTURE_7LAYER.md` → 简化的 7 层架构概览
  - `docs/architecture/7-LAYER.md` → 详细的各层设计

**合并内容**:
- 项目概述（核心定位、价值主张）
- 7 层架构概览图
- 各层详解（L7-L3）
- 平台适配策略（Windows/macOS/Linux/Android）
- 数据流向图
- 技术栈表格
- 核心模块设计（Claude Runner、终端执行器）
- 实施路线图
- 统一消息格式

#### 2.2 更新 README 导航

- [x] 创建 `docs/README.md` 导航入口
- [x] 添加快速入口（3 分钟）
- [x] 添加核心文档（30 分钟）
- [x] 添加开发规格（按需查阅）
- [x] 添加计划与执行
- [x] 添加项目管理链接
- [x] 添加文档重构进度表

#### 2.3 删除旧文档

- [x] 删除 `docs/ARCHITECTURE.md`
- [x] 删除 `docs/ARCHITECTURE_7LAYER.md`
- [x] 删除 `docs/architecture/7-LAYER.md`

**验证结果**: ✅ 合并成功，文档链接已更新

---

## Round 3: 清理归档 ✅ 已完成

**时间戳**: 2026-02-05 16:35:00

### 完成的任务

#### 3.1 移动过期文档到 archive ✅

| 源文件 | 目标位置 | 状态 |
|--------|----------|------|
| `docs/01_ExoBufferConnector技术需求报告.md` | `plans/archive/` | ✅ 已移动 |
| `docs/AUTONOMOUS_LIFE_SPEC.md` | `plans/archive/` | ✅ 已移动 |
| `docs/DEVELOPMENT_PROCESS.md` | `plans/archive/` | ✅ 已移动 |
| `docs/ExoMind-Notification-Permission-Guard.md` | `plans/archive/` | ✅ 已移动 |
| `docs/API.md` | `plans/archive/` | ✅ 已移动 |

#### 3.2 整理 specs 目录 ✅

| 操作 | 源文件 | 目标位置 | 状态 |
|------|--------|----------|------|
| 移动 | `docs/specs/SPEC-401-MobileWebSocket.md` | `docs/specs/modules/SPEC-401.md` | ✅ 已移动 |
| 移动 | `docs/specs/SPEC-501-UserIdentity.md` | `docs/specs/modules/` | ✅ 已移动 |
| 移动 | `docs/specs/SPEC-502-PairingSystem.md` | `docs/specs/modules/` | ✅ 已移动 |
| 移动 | `docs/specs/SPEC-503-EncryptedCommunication.md` | `docs/specs/modules/` | ✅ 已移动 |
| 移动 | `docs/specs/TEMPLATE.md` | `docs/specs/modules/` | ✅ 已移动 |
| 删除 | `docs/specs/SPEC-501.md` | - | ✅ 已删除 |
| 删除 | `docs/specs/SPEC-502.md` | - | ✅ 已删除 |
| 删除 | `docs/specs/SPEC-503.md` | - | ✅ 已删除 |

#### 3.3 清理空目录 ✅

- [x] 删除空目录 `docs/specs/api/`（API.md 已归档）

### 文档统计

| 统计项 | 数量 |
|--------|------|
| docs/ 根目录文档 | 4 个（README.md, todo.md, 【方案】外心MVP最小闭环设计.md, 外心四Agent快速实施计划.md） |
| docs/core/ | 4 个 |
| docs/specs/architecture/ | 1 个 |
| docs/specs/modules/ | 5 个 |
| docs/plans/（有效） | 5 个 |
| docs/plans/archive/ | 5 个 |
| **总计** | **24 个** |

### 验证结果 ✅

- [x] 所有过期文档已移到 archive
- [x] specs/modules/ 目录只包含长版本
- [x] 没有空目录
- [x] 目录结构符合预期

---

## 文档命名规范

### 文件命名

- 使用 **小写字母** + **连字符（-）**
- 示例：`quickstart.md`, `event-log-lan-mvp-plan.md`

### 目录命名

- 使用 **小写字母**
- 示例：`core/`, `specs/`, `plans/`

### 特殊文档

- 保留中文命名的计划文档（如 `【方案】外心MVP最小闭环设计.md`）
- 但**不要创建新的中文命名文档**

---

## 验证清单

每轮完成后执行：

- [ ] 所有文档可正常访问
- [ ] 内部链接指向正确的路径
- [ ] README 导航正确
- [ ] 没有 404 链接
- [ ] 文档格式一致（标题层级、代码块等）

---

## 成功标准

1. **文档数量**: 从 29 个减少到 ~20 个核心文档
2. **导航**: 新成员 3 分钟内理解文档结构
3. **可读性**: 核心文档 30 分钟可读完
4. **一致性**: 所有文档遵循统一命名和格式规范
5. **可维护性**: 明确区分"有效文档"和"归档文档"

---

## 变更日志

| 时间 | 轮次 | 操作 | 执行者 |
|------|------|------|--------|
| 2026-02-05 16:30 | Round 1 | 创建目录结构 + 移动核心文档 | Sub Agent |
| 2026-02-05 16:45 | Round 2 | 合并和简化文档 | Sub Agent |
| 2026-02-05 16:35 | Round 3 | 清理归档 | Sub Agent |

---

> 最后更新: 2026-02-05 16:35
> 状态: Round 1 ✅ 完成, Round 2 ✅ 完成, Round 3 ✅ 完成
