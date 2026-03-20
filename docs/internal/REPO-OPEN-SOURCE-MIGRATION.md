# ExoMind 代码库公开迁移方案

> **机密等级**：内部文档，不纳入公开仓库
> **决策 Issue**：#613
> **方案选择**：方案 C「过滤克隆」
> **创建日期**：2026-03-20
> **状态**：待执行

---

## 0. 决策摘要

经过 6 个方案的穷尽式枚举与系统性决策分析（详见 #613），最终选择**方案 C「过滤克隆」**。

| 决策项 | 结论 |
|--------|------|
| 方案 | C 过滤克隆（新仓库 `exomind-app` + 过滤历史） |
| 工具 | git-filter-repo |
| 代码边界 | 认知生命理论相关的代码也要隔离 |
| 历史保留 | 尽量保留完整（非 squash） |
| 开发主体 | 公开仓库主导 |
| Issue/PR | 可以抛弃 |
| 理论归属 | 单独私有仓库 |

**选择理由**：方案 C 是帕累托最优解——在安全性(5)、历史保留(5)、可逆性(5)、维护成本(5)上均为最优，加权总分 111 分（满分 125），高于方案 A 的 96 分。

---

## 1. 前置条件

### 1.1 工具安装

```bash
pip install git-filter-repo
# 验证
git filter-repo --version
```

### 1.2 环境确认

- [ ] Python 3.6+
- [ ] Git 2.22+
- [ ] GitHub CLI (`gh`) 已登录
- [ ] 对 `exomind-team` 组织有 admin 权限

---

## 2. 迁移步骤

### Phase 0: 准备（估计 30 分钟）

#### 2.0.1 创建过滤配置文件

在工作目录创建以下 3 个配置文件：

**文件 1: `paths-to-remove.txt`**

需要从所有历史中彻底移除的文件路径：

```
# === 纯理论文档 ===
docs/plans/archive/AUTONOMOUS_LIFE_SPEC.md
docs/plans/2026-03-07-personal-growth-to-civilization-roadmap.md
docs/plans/product-plan.md
docs/plans/2026-03-08-life-demo-energy-tick.md
docs/architecture/ARCH-signal-pool-agent-process.md
docs/specs/.archive/SPEC-004_ENERGY_POOL.md
docs/memory/logs.md
docs/memory/project-overview.md

# === 旧位置的理论文档（历史中可能出现） ===
docs/AUTONOMOUS_LIFE_SPEC.md
pm/memory/Round02-20260129-EnergyPool.md

# === 理论代码实现 ===
crates/exomind-runtime/src/agent/life.rs
crates/exomind-runtime/src/agent/cognition.rs
crates/exomind-runtime/src/agent/llm_cognition.rs
crates/exomind-runtime/src/agent/heartbeat.rs
crates/exomind-runtime/src/energy.rs
crates/exomind-runtime/src/routes/energy.rs
crates/exomind-runtime/src/tick.rs

# === 理论相关测试 ===
tests/unit/ui/agent-hub/agent-energy-bar.issue444.test.tsx
tests/unit/ui/agent-hub/agents-page.energy.test.tsx

# === 本文档自身（内部文档目录） ===
docs/internal/
```

**文件 2: `message-replacements.py`**

提交消息清洗回调（Python）：

```python
import re

msg = message.decode("utf-8")

# 替换理论术语
replacements = {
    "认知生命科学": "系统架构",
    "认知生命体": "智能Agent",
    "认知生命": "智能系统",
    "生命判据": "系统约束",
    "生命-认知一体化": "感知-学习一体化",
    "能量前提论": "资源管理",
    "自主生命体": "自主Agent",
    "生命科学": "系统科学",
    "马克思主义政治经济学视角": "系统经济学视角",
    "CognitiveLifeAgent": "CoreAgent",
    "CognitiveLife": "CoreSystem",
    "cognitive life": "core system",
    "life criteria": "system constraints",
}

for old, new in replacements.items():
    msg = msg.replace(old, new)

# 移除提交消息中对理论论文的引用
msg = re.sub(r"论文[一二三四]", "技术文档", msg)

return msg.encode("utf-8")
```

**文件 3: `author-mailmap.txt`**

作者身份映射（如需统一化名）：

```
# 格式: New Name <new@email> Old Name <old@email>
# 当前所有身份均为化名，按需调整
# 示例（如需要统一）：
# ExoMind Dev <dev@exomind.app> 星林 <hailay@qq.com>
```

#### 2.0.2 备份确认

```bash
# 确认本地仓库状态干净
cd /path/to/exomind
git status  # 应为 clean

# 确认远端同步
git fetch --all
git branch -a  # 记录所有分支

# 额外备份（可选，保险起见）
git bundle create /backup/exomind-full-backup.bundle --all
```

---

### Phase 1: 过滤执行（估计 1 小时）

#### 2.1.1 创建镜像克隆

```bash
# 在临时目录创建完整镜像
git clone --mirror https://github.com/exomind-team/exomind /tmp/exomind-clean
cd /tmp/exomind-clean
```

#### 2.1.2 执行 git-filter-repo

```bash
# 第一步：移除文件路径
git filter-repo \
  --invert-paths \
  --paths-from-file /path/to/paths-to-remove.txt \
  --force

# 第二步：清洗提交消息
git filter-repo \
  --message-callback "$(cat /path/to/message-replacements.py)" \
  --force

# 第三步（如需要）：统一作者身份
# git filter-repo --mailmap /path/to/author-mailmap.txt --force
```

> **注意**：git-filter-repo 的多步操作需要 `--force` 标志，因为第一步已经移除了 origin remote。

#### 2.1.3 手动编辑脱敏文件

filter-repo 处理的是"移除文件"和"消息替换"，但以下文件需要**保留但编辑**：

```bash
# 切换到工作目录模式（mirror clone 需要特殊处理）
cd /tmp
git clone /tmp/exomind-clean /tmp/exomind-edit
cd /tmp/exomind-edit
git checkout dev
```

需要手动编辑的文件清单：

| 文件 | 编辑内容 |
|------|---------|
| `CLAUDE.md` | 移除"生命判据"表格、"核心理念"表格、"双层原则命名规范"章节。保留技术规范部分。 |
| `docs/architecture/overview.md` | 移除 §1.3 生命判据(C1-C6)、§1.4 设计哲学中的理论论证。将"认知生命科学的实践平台"改为"个人/集体智能助手平台"。 |
| `docs/AI-CONTEXT.md` | 移除"生命判据"引用行，将"认知生命科学原型"改为"智能助手原型"。 |
| `docs/product/roadmap.md` | 重写为纯技术路线图，移除所有理论框架章节。 |
| `docs/product/PRD.md` | 移除四Agent理论框架、L0-L5信任度阶梯等理论章节。 |
| `README.md` | 检查并替换"认知生命科学"为"智能助手"等通用描述。 |
| `AGENTS.md` | 检查并移除理论引用。 |

```bash
# 编辑完成后提交
git add -A
git commit -m "chore: sanitize documents for open-source release

Remove cognitive life science theory references from public-facing
documentation. Theory content preserved in private repository.

Ref: #613"
```

#### 2.1.4 处理编译依赖

移除理论代码后，需要确保 Rust 项目仍能编译：

```bash
# 检查是否有编译错误
cd crates/exomind-runtime
cargo check 2>&1 | head -50

# 可能需要修改的文件：
# - crates/exomind-runtime/src/agent/mod.rs  (移除对 life/cognition/heartbeat 的 mod 引用)
# - crates/exomind-runtime/src/routes/mod.rs (移除对 energy 路由的引用)
# - crates/exomind-runtime/src/lib.rs        (移除对 energy/tick 的 mod 引用)
```

```bash
# 修复编译后提交
git add -A
git commit -m "fix: remove cognitive life module references for compilation

Adjust mod.rs and route registrations after removing theory-related
code modules (life, cognition, energy, tick, heartbeat).

Ref: #613"
```

#### 2.1.5 推回镜像

```bash
# 将编辑推回镜像 clone
cd /tmp/exomind-edit
git push origin dev
```

---

### Phase 2: 验证（估计 30 分钟）

#### 2.2.1 全历史关键词搜索

```bash
cd /tmp/exomind-clean

# 搜索提交消息
echo "=== 提交消息检查 ==="
git log --all --format=%B | grep -i -c "认知生命"
git log --all --format=%B | grep -i -c "生命判据"
git log --all --format=%B | grep -i -c "CognitiveLife"
git log --all --format=%B | grep -i -c "能量前提"
# 所有计数应为 0

# 搜索文件内容（所有历史版本）
echo "=== 文件内容检查 ==="
git log --all -p -S "认知生命科学" -- | head -20
git log --all -p -S "生命判据" -- | head -20
git log --all -p -S "CognitiveLifeAgent" -- | head -20
# 应无输出

# 确认理论文件不在任何历史版本中
echo "=== 文件路径检查 ==="
git log --all --diff-filter=A --name-only --pretty=format: | sort -u | grep -i -E "(life\.rs|cognition\.rs|energy\.rs|heartbeat\.rs|tick\.rs|AUTONOMOUS)"
# 应无输出
```

#### 2.2.2 编译验证

```bash
cd /tmp/exomind-edit

# 前端编译
bun install
npx tsc --noEmit

# 后端编译
cd crates/exomind-runtime
cargo check

# 测试（如适用）
bun test
cargo test
```

#### 2.2.3 人工抽查

- [ ] 浏览最近 20 个提交的 diff，确认无理论残留
- [ ] 检查 `CLAUDE.md` 确认无生命判据内容
- [ ] 检查 `docs/architecture/overview.md` 确认无 C1-C6
- [ ] 全局搜索 "认知生命" "生命判据" "CognitiveLife" "能量前提" 确认零结果

---

### Phase 3: 发布（估计 30 分钟）

#### 2.3.1 创建新仓库并推送

```bash
# 创建新的公开仓库（先私有创建，验证后再公开）
gh repo create exomind-team/exomind-app --private --description "ExoMind - Personal & Collective Growth Assistant"

# 推送过滤后的历史
cd /tmp/exomind-clean
git remote add public https://github.com/exomind-team/exomind-app.git
git push public --all
git push public --tags
```

> **注意**：原仓库 `exomind-team/exomind` 保持不动（私有），无需改名。
> 接受 URL 从 `exomind-team/exomind` 变为 `exomind-team/exomind-app`。

#### 2.3.2 配置新仓库

```bash
# 设置默认分支
gh api repos/exomind-team/exomind-app -X PATCH -f default_branch=main

# 配置分支保护（按需）
# gh api repos/exomind-team/exomind-app/branches/main/protection ...

# 迁移 Secrets（手动在 GitHub Settings 中操作）
# - CLOUDFLARE_API_TOKEN
# - CLOUDFLARE_ACCOUNT_ID
# - 其他 CI/CD secrets

# 迁移 CI/CD workflows（已在代码中，自动可用）
# 验证 GitHub Actions 是否正常
gh workflow list --repo exomind-team/exomind-app
```

#### 2.3.3 最终公开

```bash
# 确认一切正常后，设为公开
gh repo edit exomind-team/exomind-app --visibility public
```

---

### Phase 4: 理论归档（估计 30 分钟）

#### 2.4.1 创建理论私有仓库

```bash
gh repo create exomind-team/exomind-theory --private --description "ExoMind Cognitive Life Science Theory (Private)"
```

#### 2.4.2 提取理论文件

```bash
# 从原始仓库克隆
git clone https://github.com/exomind-team/exomind /tmp/exomind-theory
cd /tmp/exomind-theory

# 使用 filter-repo 只保留理论文件（白名单模式）
git filter-repo \
  --path crates/exomind-runtime/src/agent/life.rs \
  --path crates/exomind-runtime/src/agent/cognition.rs \
  --path crates/exomind-runtime/src/agent/llm_cognition.rs \
  --path crates/exomind-runtime/src/agent/heartbeat.rs \
  --path crates/exomind-runtime/src/energy.rs \
  --path crates/exomind-runtime/src/routes/energy.rs \
  --path crates/exomind-runtime/src/tick.rs \
  --path docs/plans/archive/AUTONOMOUS_LIFE_SPEC.md \
  --path docs/plans/2026-03-07-personal-growth-to-civilization-roadmap.md \
  --path docs/plans/product-plan.md \
  --path docs/plans/2026-03-08-life-demo-energy-tick.md \
  --path docs/architecture/ARCH-signal-pool-agent-process.md \
  --path docs/specs/.archive/SPEC-004_ENERGY_POOL.md \
  --path docs/internal/ \
  --force

# 推送到理论仓库
git remote add theory https://github.com/exomind-team/exomind-theory.git
git push theory --all
git push theory --tags
```

#### 2.4.3 更新本地开发环境

```bash
# 重新克隆公开仓库作为主开发目录
git clone https://github.com/exomind-team/exomind-app ~/projects/exomind-app

# 安装依赖
cd ~/projects/exomind-app
bun install

# 验证开发环境
bun dev
```

---

## 3. 迁移后的日常工作流

### 3.1 公开仓库 `exomind-app`（主战场）

- 所有日常开发在此进行
- Issue、PR、CI/CD 全在此
- 不包含任何认知生命理论内容

### 3.2 理论私有仓库 `exomind-theory`（低频）

- 仅在需要修改/扩展认知生命理论代码时使用
- 未来如需将理论代码集成到公开版，可通过 git submodule 或 npm/crate 包方式

### 3.3 原仓库 `exomind`（存档）

- 保持私有，不改名
- 仅作为回溯参考，不再活跃开发
- 可在确认迁移完全成功后归档（Archive）

---

## 4. 风险与回退

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| 过滤规则遗漏文件 | 中 | 中 | Phase 2 验证环节捕获，从原仓库重新 filter |
| 编译依赖断裂 | 高 | 低 | Phase 1.4 修复，已预列可能需要修改的文件 |
| CI/CD Secrets 遗漏 | 中 | 低 | 手动迁移，逐个验证 |
| 公开后发现残留 | 低 | 高 | 立即私有化，从原仓库重做 |
| 理论仓库历史不完整 | 低 | 低 | 从 exomind-legacy 重新提取 |

**总体回退策略**：原仓库（`exomind-team/exomind`）始终完好无损，任何阶段都可以从头重做。

---

## 5. 检查清单

### Phase 0 准备
- [ ] git-filter-repo 已安装
- [ ] 3 个配置文件已创建并审查
- [ ] 本地仓库状态 clean
- [ ] 远端已同步（git fetch --all）
- [ ] 备份 bundle 已创建

### Phase 1 执行
- [ ] 镜像克隆完成
- [ ] filter-repo 路径移除完成
- [ ] filter-repo 消息清洗完成
- [ ] 脱敏文档编辑完成
- [ ] 编译依赖修复完成
- [ ] 所有修改已提交

### Phase 2 验证
- [ ] 提交消息关键词搜索：0 结果
- [ ] 文件内容关键词搜索：0 结果
- [ ] 文件路径检查：0 结果
- [ ] 前端编译通过
- [ ] 后端编译通过
- [ ] 人工抽查完成

### Phase 3 发布
- [ ] 新仓库 `exomind-app` 已创建
- [ ] 历史已推送
- [ ] 默认分支已设置
- [ ] Secrets 已迁移
- [ ] CI/CD 验证通过
- [ ] 仓库已设为 public

### Phase 4 归档
- [ ] 理论私有仓库已创建
- [ ] 理论文件已提取并推送
- [ ] 本地开发环境已切换到 exomind-app
- [ ] 原仓库 exomind 已 Archive

---

*文档版本: v1.0*
*最后更新: 2026-03-20*
