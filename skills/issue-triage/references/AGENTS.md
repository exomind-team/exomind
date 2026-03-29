# Issue 分诊治理 Agent

## 角色

对 ExoMind 项目的 GitHub Issues 进行周期性分诊治理——关闭已完成的、合并重叠的、标注优先级、同步过时描述，保持 Issue 池的信噪比。

---

## 设计理念

### 为什么需要治理

Issue 池天然只增不减。脑暴、产品走查、架构审计都会批量产出 issue，但很少有人回头关闭已完成或过时的。随着时间推移：
- 已实现的功能仍挂着 Open issue
- 被新 issue 覆盖的旧 issue 无人清理
- 改同一段代码的多个 issue 各自追踪，实现时互相踩脚
- 无优先级的 issue 淹没了真正紧急的工作

治理的目标不是"减少数字"，而是**让每个 Open issue 都有明确的价值和可执行性**。

### 核心原则

| 原则 | 说明 |
|------|------|
| **关闭要留痕** | 关闭时必须评论说明原因，指向覆盖它的 issue/PR/commit |
| **合并有门槛** | 只合并"实现重叠或循环依赖"的 issue，不因领域相近就合并 |
| **优先级全覆盖** | 治理结束后，无优先级 issue 数量为 0 |
| **同步不删除** | 早期脑暴 issue 优先同步到当前现状，而非直接关闭 |
| **数据实查** | 判断"是否已实现"必须检查代码，不凭记忆 |

---

## 治理流程

### 总览

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  1.全景  │ →  │  2.分段  │ →  │  3.逐段  │ →  │  4.验证  │
│  采集    │    │  切片    │    │  治理    │    │  汇总    │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

### 第一步：全景采集

采集当前 issue 池的全景数据：

```bash
# 总数（必须 --limit 500 避免截断）
gh issue list --state open --limit 500 --json number --jq 'length'

# 优先级分布
gh issue list --state open --limit 500 --json labels --jq '[.[] | select([.labels[].name] | any(. == "P0"))] | length'
gh issue list --state open --limit 500 --json labels --jq '[.[] | select([.labels[].name] | any(. == "P1"))] | length'
gh issue list --state open --limit 500 --json labels --jq '[.[] | select([.labels[].name] | any(. == "P2"))] | length'

# 无优先级数量
gh issue list --state open --limit 500 --json number,labels --jq '[.[] | select(([.labels[].name] | map(select(startswith("P"))) | length) == 0)] | length'

# 创建时间分布
gh issue list --state open --limit 500 --json createdAt --jq '.[].createdAt[:10]' | sort | uniq -c | sort -k2

# 全量导出
gh issue list --state open --limit 500 --json number,title,labels,createdAt --jq '.[] | "\(.number)|\(.title)|\([.labels[].name] | join(","))|\(.createdAt[:10])"'
```

### 第二步：分段切片

按 issue 编号段分批处理，每段有不同的特征：

| 段 | 典型特征 | 治理重点 |
|----|----------|----------|
| 早期（创建 > 4 周） | 脑暴产物、愿望清单、无标签 | 同步现状 or 关闭 |
| 中期（2-4 周） | 功能开发、架构讨论 | 检查是否已实现、Epic 去重 |
| 近期（< 2 周） | 精细化记录、UI 细节 | 标优先级、合并重叠 |

### 第三步：逐段治理

对每段 issue 执行五种操作：

#### 操作 A：关闭已实现

**判断方法**：搜索相关的已合并 PR，检查代码中对应功能是否存在。

```bash
# 搜索相关 PR
gh pr list --state merged --limit 100 --json number,title --jq '.[] | select(.title | test("关键词")) | "\(.number) \(.title[:60])"'

# 检查代码
grep -r "关键函数或组件" src/ --include="*.ts" --include="*.tsx" | head -5
```

**关闭评论模板**：
```
关闭：已由 PR #XXX（标题）实现。[简述实现情况]
```

#### 操作 B：关闭已覆盖

**判断方法**：搜索标题/领域相近的新 issue，确认功能范围被完全覆盖。

**关闭评论模板**：
```
关闭：已被 #XXX（标题）覆盖。[说明覆盖关系]
```

#### 操作 C：合并重叠 issue

**合并判据**（必须满足至少一条）：
1. **实现重叠**：两个 issue 的实现需要修改同一个文件/组件的同一段逻辑
2. **循环依赖**：A 的实现依赖 B 的结果，而 B 的定义又依赖 A 的范围

**不合并的情况**：
- 仅仅是同一领域（如都关于"任务系统"）但改不同模块
- 有先后依赖但不循环（用 blocks/blockedBy 表达）
- 一个是 bug 一个是 feature（修复和增强是不同工作）

**合并执行步骤**：
1. 选择宿主 issue（更具体或编号更新的）
2. 更新宿主标题，体现合并后的完整范围
3. 更新宿主 body，包含：
   - `## 合并自` 列出所有被合并的 issue 编号和标题
   - 按 Phase 划分实现阶段，每个原 issue 对应一个阶段
   - `## 依赖` 列出阻塞/被阻塞关系
4. 关闭被合并的 issue，评论指向宿主

**宿主 issue body 模板**：
```markdown
## 合并自

- #AAA（原标题）
- #BBB（原标题）

## 现状（YYYY-MM-DD）

[当前代码中相关功能的实现状态]

## 阶段

### Phase 1: [来自 #AAA 的核心功能]
- ...

### Phase 2: [来自 #BBB 的核心功能]
- ...

## 依赖

- #XXX（前置条件）
```

**被合并 issue 的关闭评论模板**：
```
合并到 #YYY（宿主标题），作为统一实现追踪。
```

#### 操作 D：同步过时描述

适用于：需求仍有效，但描述中的技术细节、路径、术语已过时。

**更新内容**：
- 标题：对齐当前术语
- Body：添加 `## 现状（YYYY-MM-DD 同步）` 段落
- 标签：补充领域标签和优先级
- 依赖：标注 blocks/blockedBy 关系

#### 操作 E：标注优先级

所有 Open issue 必须有 P0/P1/P2 之一：

| 优先级 | 含义 | 标准 |
|--------|------|------|
| P0 | 活跃主线 | 当前迭代正在推进，有 PR 或 Agent 在处理 |
| P1 | 重要待排 | 近期需要排期，影响核心功能或架构健康 |
| P2 | Backlog | 远期/观望，不影响当前迭代 |

### 第四步：验证汇总

治理结束后验证：

```bash
# 无优先级应为 0
gh issue list --state open --limit 500 --json labels --jq '[.[] | select(([.labels[].name] | map(select(startswith("P"))) | length) == 0)] | length'

# 输出治理报告
echo "Open Issues: $(gh issue list --state open --limit 500 --json number --jq 'length')"
echo "P0: $(gh issue list --state open --limit 500 --json labels --jq '[.[] | select([.labels[].name] | any(. == "P0"))] | length')"
echo "P1: $(gh issue list --state open --limit 500 --json labels --jq '[.[] | select([.labels[].name] | any(. == "P1"))] | length')"
echo "P2: $(gh issue list --state open --limit 500 --json labels --jq '[.[] | select([.labels[].name] | any(. == "P2"))] | length')"
```

用 ASCII 艺术输出治理前后对比。

---

## Issue 检索方法论

Issue 池超过 100 条后，线性浏览不可行。以下是经过实践验证的检索模式，按使用场景分类。

### 场景 1：按领域聚类——找出"同一个话题"的所有 issue

**目的**：识别重叠、覆盖关系和合并候选。

```bash
# 方法 A：标题关键词搜索（最常用）
gh issue list --state open --limit 500 --json number,title \
  --jq '.[] | select(.title | test("关键词1|关键词2|关键词3"; "i")) | "\(.number) \(.title[:70])"'

# 示例：找所有与"MCP"相关的 issue
gh issue list --state open --limit 500 --json number,title \
  --jq '.[] | select(.title | test("[Mm][Cc][Pp]|mcp")) | "\(.number) \(.title[:70])"'

# 方法 B：标题前缀分类——看有哪些领域
gh issue list --state open --limit 500 --json title \
  --jq '.[].title' | grep -oP '^[a-z]+\(' | sort | uniq -c | sort -rn

# 方法 C：全量导出后本地 grep（跨字段搜索）
gh issue list --state open --limit 500 --json number,title,labels \
  --jq '.[] | "\(.number)|\(.title)|\([.labels[].name] | join(","))"' \
  | sort -t'|' -k1 -n > /tmp/issues.txt
grep -i "语音\|voice\|asr\|tts" /tmp/issues.txt
```

**实践经验**：
- 中文和英文关键词都要搜（如 `语音|voice|asr`）
- `test()` 函数默认区分大小写，加 `"i"` 标志忽略大小写
- 全量导出到本地文件后用 grep 更灵活，可做多轮筛选

### 场景 2：检查功能是否已实现——关联 PR 和代码

**目的**：判断一个 issue 是否应该关闭。

```bash
# 步骤 1：搜索相关 PR（按标题关键词）
gh pr list --state merged --limit 100 --json number,title \
  --jq '.[] | select(.title | test("issue-NNN|关键词")) | "\(.number) \(.title[:70])"'

# 步骤 2：检查代码中是否存在对应功能
# -- 搜索组件/函数名
grep -rn "ComponentName\|functionName" src/ --include="*.ts" --include="*.tsx" | head -10
# -- 搜索路由端点
grep -rn "routePath\|/api/endpoint" src/ crates/ --include="*.rs" --include="*.ts" | head -10
# -- 搜索配置项
grep -rn "configKey\|settingName" src/config/ src/ui/app/config/ | head -5

# 步骤 3：检查默认值/启用状态（确认功能真的在用，不只是代码存在）
# 示例：检查 RT SQLite 是否默认启用
grep -n "default\|DEFAULTS" src/config/domain-backend-mode.ts
```

**实践经验**：
- 搜 PR 时用 `issue-NNN` 格式能精确匹配，但很多 PR 标题不含 issue 号，需要同时按功能关键词搜
- 代码存在 ≠ 功能已完成。必须检查功能是否被调用、默认启用、有路由入口
- Rust 代码在 `crates/` 目录，前端在 `src/`，都要搜

### 场景 3：找覆盖关系——"这个旧 issue 是否被新 issue 取代了"

**目的**：判断一个旧 issue 是否已被更具体/更新的 issue 覆盖。

```bash
# 方法 A：在同领域内按编号排序，对比新旧
gh issue list --state open --limit 500 --json number,title \
  --jq '.[] | select(.title | test("任务|task|DAG"; "i")) | "\(.number) \(.title[:65])"' \
  | sort -t'|' -k1 -n

# 方法 B：查看一个 issue 是否有"子 issue"或"后继 issue"
# GitHub API 不支持直接查子 issue，但可以搜索 body 中引用了该编号的 issue
gh issue list --state open --limit 500 --json number,title,body \
  --jq '.[] | select(.body | test("#旧编号")) | "\(.number) \(.title[:60])"'

# 方法 C：查 epic 类 issue 的子任务列表
gh issue view EPIC编号 --json body --jq '.body' | head -50
```

**实践经验**：
- 覆盖关系不总是显式标注的，需要人工判断功能范围
- Epic issue 的 body 中通常列出子 issue，是找覆盖关系的最佳入口
- 如果旧 issue 的功能是新 issue 的子集，就是被覆盖了

### 场景 4：合并候选发现——"哪些 issue 改同一段代码"

**目的**：找到实现重叠的 issue，作为合并候选。

```bash
# 方法 A：按目标组件/文件聚类
# 找出标题中提到同一个组件的 issue
gh issue list --state open --limit 500 --json number,title \
  --jq '.[] | select(.title | test("NowInputRow|TaskInput|输入框"; "i")) | "\(.number) \(.title[:65])"'

# 方法 B：按标题前缀的细分领域聚类
gh issue list --state open --limit 500 --json number,title \
  --jq '.[] | select(.title | test("^(feat|bug)\\(task-input\\)")) | "\(.number) \(.title[:65])"'

# 方法 C：对于 UI 类 issue，按页面聚类
gh issue list --state open --limit 500 --json number,title \
  --jq '.[] | select(.title | test("TaskDetail|任务详情|task-detail"; "i")) | "\(.number) \(.title[:65])"'
```

**实践经验**：
- 最有效的信号是"标题提到同一个组件名"（如 NowInputRow、TaskDetailPage、AgentsPage）
- UI 类 issue 按页面聚类最有效
- 后端 issue 按模块/路由聚类最有效（如 `/eventlog`、`SignalPool`、`ECS`）

### 场景 5：批量操作——高效执行治理决策

```bash
# 批量打标签
for n in 100 101 102 103; do
  gh issue edit $n --add-label "P2" 2>/dev/null
done

# 批量关闭（附评论）
for n in 100 101 102; do
  gh issue close $n --comment "关闭：[原因]" 2>&1
done

# 读取 issue 的 body 前 N 字符（快速扫读，不需要看完整 body）
gh issue view 123 --json body --jq '.body[:300]'

# 批量读取多个 issue 的标题和状态
for n in 100 101 102 103; do
  gh issue view $n --json number,title,state --jq '"\(.number) [\(.state)] \(.title[:50])"'
done
```

### 检索注意事项

| 事项 | 说明 |
|------|------|
| **总是加 `--limit 500`** | 默认只返回 30 条，会遗漏大量 issue |
| **总是加 `--state open`** | 不加会混入已关闭的 issue，干扰计数 |
| **jq `test()` 加 `"i"` 标志** | 中英混合场景下忽略大小写更安全 |
| **搜索结果排序** | 用 `sort -t'\|' -k1 -n` 按编号排序，方便对比新旧 |
| **网络超时重试** | Termux 环境下 gh 命令偶尔超时，失败时重试一次 |

---

## 与用户的协作模式

治理过程中涉及大量判断。Agent 应主动使用 `AskUserQuestion` 工具：

1. **确定可关闭的直接执行**，不需要逐个确认
2. **需要判断的分组提问**，用 AskUserQuestion 批量呈现选项
3. **合并候选先列出分析**，说明重叠/依赖关系，再让用户确认
4. **用户犹豫时提供代码证据**，用 grep/文件检查验证功能是否已实现

---

## 质量红线

| 红线 | 说明 |
|------|------|
| 关闭必留评论 | 每个关闭的 issue 必须有评论说明原因和去向 |
| 合并必更新宿主 | 合并后宿主 issue 的标题和 body 必须体现被合并内容 |
| 不凭记忆判断 | "是否已实现"必须通过代码搜索或 PR 查询验证 |
| 不强行合并 | 用户说"不合并"就保持独立，不要二次说服 |
| `--limit 500` | 所有 gh issue list 命令必须带 `--limit 500 --state open` |

---

## 治理节奏

| 频率 | 范围 | 目标 |
|------|------|------|
| 每周 | 增量（新增 issue） | 及时标注优先级、识别重叠 |
| 每月 | 全量扫描 | 关闭已实现、合并重叠、Epic 去重 |
| 里程碑前 | 聚焦扫描 | 清理目标版本相关的过时 issue |

---

## 完整方法论演进记录

- v0.1（2026-03-15）：首次三步治理，从 227 降到 169，建立基本方法论
