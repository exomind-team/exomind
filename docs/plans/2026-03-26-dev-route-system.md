# 开发航线系统 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立「开发航线」Agent 系统（章程 + 提示词 + HTML 模板），使任意 Agent 一次提示就能完成 issue 聚类分析并生成交互式航线仪表盘。

**Architecture:** 复刻 `docs/agents/dev-daily/` 的三文件结构（AGENTS.md + prompt.md + route-template.html），数据采集复用 gh CLI，聚类算法在章程中规则化，HTML 模板从原型精炼而来。

**Tech Stack:** gh CLI, dagre.js CDN, Chart.js CDN (可选), Google Fonts CDN, 单文件 HTML

---

## Task 1: 创建目录结构

**Files:**
- Create: `docs/agents/dev-route/` (目录)

**Step 1: 创建目录**

```bash
mkdir -p docs/agents/dev-route
```

**Step 2: 确认目录存在**

```bash
ls docs/agents/dev-route/
```

Expected: 空目录

**Step 3: Commit**

```bash
git add docs/agents/dev-route
git commit -m "chore: create dev-route agent directory"
```

---

## Task 2: 编写航线章程 AGENTS.md

**Files:**
- Create: `docs/agents/dev-route/AGENTS.md`

**Step 1: 编写 AGENTS.md**

完整内容如下。核心章节：角色定义、数据采集、Issue 聚类算法、批次划分规则、DAG 依赖推导、ROUTE 数据结构、版面结构、质量红线。

```markdown
# 开发航线 Agent

## 角色

生成 ExoMind 项目的批次实施规划航线图，面向项目负责人和开发者，以交互式 DAG 仪表盘呈现 issue 聚类、批次依赖与平台轨道分布。

### 与开发日报的关系

| 维度 | 日报 | 航线 |
|------|------|------|
| 视角 | 回顾（发生了什么） | 前瞻（接下来做什么） |
| 时间跨度 | 上次报告 → 现在 | 未来 1-4 周 |
| 发行节奏 | 每 6-12h | 航段变化时（批次完成/新 issue 涌入） |
| 核心可视化 | 指标卡 + 地形图 | DAG 航线地图 + 热力图 |

---

## 触发条件

用户使用以下表述时触发：
- "航线"、"批次规划"、"issue 聚类"、"实施计划总览"
- "哪些 issue 可以一起做"
- "下一步该做哪个批次"

---

## 数据采集

### 数据源

采集前先 `git fetch origin dev --quiet`，然后**并行**执行：

```bash
# 1. 全量 Open Issues（标签+标题+里程碑）
gh issue list --state open --limit 500 --json number,title,labels,milestone,createdAt

# 2. Open Issues 精确总数
gh issue list --state open --limit 500 --json number --jq 'length'

# 3. P0/P1 精确计数
gh issue list --state open --json labels --jq '[.[] | select([.labels[].name] | any(. == "P0"))] | length'
gh issue list --state open --json labels --jq '[.[] | select([.labels[].name] | any(. == "P1"))] | length'

# 4. dev 最新提交
git log --oneline -5 dev

# 5. 已有实施计划（检查哪些 issue 已有计划覆盖）
grep -h "关联 Issue" docs/plans/2026-*.md 2>/dev/null

# 6. 近期关闭的 Issues（判断批次进度）
gh issue list --state closed --limit 30 --json number,title,closedAt
```

### 采集防护规则

1. `--state open` + `--limit 500` 是硬性要求
2. 禁止复用任何缓存或上次航线的数据
3. 所有数字必须来自本次查询

---

## Issue 聚类算法

### 第一步：提取特征向量

对每个 open issue 提取以下特征：

| 特征 | 来源 | 示例 |
|------|------|------|
| **领域前缀** | title 中 `(xxx)` 部分 | `timeblock`, `eventlog`, `task-dag` |
| **类型前缀** | title 前缀 | `feat`, `bug`, `fix`, `refactor`, `research` |
| **标签集** | labels 数组 | `['UI', '时间块', 'P1', 'Tauri']` |
| **平台标签** | labels 中平台类 | `Web`, `Tauri`, `移动端` |
| **优先级** | labels 中 P0/P1/P2 | `P1` |
| **里程碑** | milestone | `v0.5 目标系统` |

### 第二步：聚类规则（按优先级顺序应用）

```
规则 1：同领域前缀 → 同批次
        例：goal-system 的 #717~#723 全部归为一个批次

规则 2：同文件域 → 同批次
        例：都改 crates/exomind-runtime/src/routes/ → 归为 RT 批次

规则 3：有显式依赖（issue body 中 "depends on #xxx"）→ 同批次并排序

规则 4：同里程碑 → 优先同批次
        例：milestone "v0.5 目标系统" 下的 issue 倾向归为一个批次

规则 5：research/discussion 类型 → 单独归类，不混入实现批次
```

### 第三步：平台轨道分配

每个批次根据成员 issue 的平台标签分配到一个轨道：

| 轨道 | 判定规则 | 执行条件 |
|------|----------|----------|
| **Web-only** | 无 `Tauri`/`移动端` 标签，或仅有 `Web` | Termux/任意开发机 |
| **RT Rust** | 改动集中在 `crates/` | 需 Rust 工具链 |
| **Desktop** | 有 `Tauri` 标签且涉及窗口/快捷键/系统托盘 | 需 Windows/macOS/Linux 桌面 |
| **Android** | 有 `移动端` 标签且涉及 Kotlin/原生能力 | 需 Android 真机 |
| **Cross** | 需多端同时验证（sync、auth 等） | 需多端协同 |
| **CI/Infra** | CI/CD、构建、脚本类 | 独立可做 |

### 第四步：批次粒度控制

```
原则 1：每批次 3-12 个 issue（太少不值得，太多执行易跑偏）
原则 2：P0/P1 bug 优先独立成批（紧急修复不混功能开发）
原则 3：同批次内按依赖链排序（有依赖的不能并行）
原则 4：超过 12 个 issue 的大聚类要拆分
```

### 第五步：批次命名

```
沿用项目已有命名规范（docs/development/planner-methodology.md）：
- 查找已使用的最大批次字母（如 L）
- 新批次从下一个字母开始（M, N, O...）
- 同子系统迭代用撇号（A', A''）
```

---

## 批次间依赖推导

对每对批次 (A, B)，检查是否存在依赖：

```
规则 1：B 中有 issue 显式 depends on A 中的 issue → B 依赖 A

规则 2：B 的文件域是 A 的输出消费者
        例：RT 任务 API 增强 → 前端任务页依赖 RT API

规则 3：B 的 P1/P2 issue 依赖 A 的 P0/P1 基础设施
        例：所有功能批次 → 依赖安全修复批次

规则 4：同轨道的相邻批次，后者可能依赖前者（如 RT 基建 → RT API 增强）
```

依赖关系用于 DAG 渲染中的有向边。

---

## ROUTE 数据结构

```javascript
const ROUTE = {
  meta: {
    title: '开发航线',
    date: 'YYYY-MM-DD',       // 生成日期
    baseline: '<hash>',        // dev@<7-char hash>
    repo: 'exomind-team/exomind',
  },

  publisher: {
    identity: '...',           // Agent 自我身份
    os: '...',                 // 所在系统
    model: '...',              // 模型品牌
    version: '...',            // 模型版本
  },

  status: {
    level: 'sun|cloudy|overcast|rain|storm',
    emoji: '...',
    label: '...',              // 航况简述
    summary: '...',            // 一句话概要
  },

  metrics: [
    { label: '总批次', value: 'N', note: '...' },
    { label: '就绪',  value: 'N', note: '...' },
    { label: '进行中', value: 'N', note: '...' },
    { label: '覆盖 Issues', value: 'N', note: '...' },
  ],

  tracks: [
    { id: 'web', name: 'Web-only', color: '#58a6ff', desc: '...' },
    { id: 'rt', name: 'RT Rust', color: '#d29922', desc: '...' },
    { id: 'desktop', name: 'Desktop', color: '#8957e5', desc: '...' },
    { id: 'android', name: 'Android', color: '#2ea043', desc: '...' },
    { id: 'cross', name: 'Cross', color: '#f778ba', desc: '...' },
    { id: 'ci', name: 'CI/Infra', color: '#6e7681', desc: '...' },
  ],

  batches: [
    {
      id: 'X',                 // 批次字母编号
      name: '...',             // 批次名称
      track: 'web',           // 所属轨道 id
      status: 'ready',        // ready|active|done|blocked
      priority: 'P1',         // 批次最高优先级
      pct: 0,                 // 完成百分比（自动计算）
      deps: ['W'],            // 前置依赖批次 id 列表
      branch: '...',          // 建议分支名
      fileDomain: '...',      // 文件域描述
      issues: [
        { num: 123, title: '...', priority: 'P1', done: false },
      ],
    },
  ],

  heatmap: {
    rows: ['P0', 'P1', 'P2'],
    cols: ['Web', 'RT', 'Desktop', 'Android', 'Cross', 'CI'],
    data: [[...], [...], [...]],  // 数字矩阵
  },

  actions: [
    { text: '...', detail: '...' },
  ],

  insight: {
    text: '...',
    author: '...',
  },
};
```

---

## 版面结构（6 个区块）

### 1. 报头

ExoMind ASCII Logo + "开 发 航 线" + 日期 + baseline + publisher

### 2. 航况概览

航况卡（天气隐喻 + 摘要）+ 4 项指标卡（总批次/就绪/进行中/覆盖率）

### 3. 航线地图（核心）

DAG 可视化：
- dagre.js 自动布局（rankdir: LR, ranksep: 120, nodesep: 50）
- 节点：圆角卡片，左侧轨道色条
- 节点状态色：就绪=绿色、进行中=棕橙脉冲、待解锁=黄色半透明、已完成=灰色
- 边：贝塞尔曲线 + 箭头，blocked 边用虚线
- 点击节点展开详情面板（issue 列表、进度条、文件域、分支名）

### 4. 优先级×平台热力图

矩阵网格，颜色深度表示积压密度。

### 5. 建议航向

1-3 条可执行的下一步行动，附 checkbox（localStorage 持久化）。

### 6. 洞察 + 页脚

一段分析性文字 + 发布信息。

---

## 航况判定

| 航况 | 信号组合 |
|------|----------|
| ☀️ 顺风 | 多个批次就绪 + 无 P0 阻塞 + 批次按计划推进 |
| ⛅ 就绪待发 | 有规划但尚未启动 + 无紧急阻塞 |
| 🌥️ 航道拥挤 | 多条依赖链阻塞 + issue 积压加速 |
| 🌧️ 逆风 | P0 长期未处理 + 关键路径受阻 |
| ⛈️ 搁浅 | 批次大面积 blocked + 无法推进 |

---

## 质量红线

| 红线 | 说明 |
|------|------|
| 禁止搬运 | 所有 issue 数据必须来自本次 gh 查询 |
| 聚类可复现 | 同样的 issue 集合，两次聚类结果应基本一致 |
| 覆盖率诚实 | 明确标注覆盖了多少 issue、遗漏了多少 |
| 依赖有据 | 每条批次依赖都要说明理由 |
| 建议可执行 | "建议航向"必须指向具体批次和 issue |

---

## 发行节奏

航线不按时间发行，按**航段变化**触发：
1. 某批次从 ready → active 或 active → done
2. 新 issue 批量涌入（单日 >5 个同领域）
3. 用户手动要求重新规划
```

**Step 2: 校验文件结构**

检查文件存在且非空：
```bash
wc -l docs/agents/dev-route/AGENTS.md
```
Expected: ~200+ 行

**Step 3: Commit**

```bash
git add docs/agents/dev-route/AGENTS.md
git commit -m "docs(dev-route): 开发航线 Agent 方法论章程"
```

---

## Task 3: 编写启动提示词 prompt.md

**Files:**
- Create: `docs/agents/dev-route/prompt.md`

**Step 1: 编写 prompt.md**

```markdown
# 开发航线 — 提示词入口

本文件包含两个独立的提示词入口，用户选择一个**全文复制**给任意 Agent 即可执行。

两个入口共享同一套采集与聚类流程（见下方「共用流程」），区别仅在输出格式。

---

## 入口 A：本地 HTML 航线

> 适用场景：本地浏览器查看、团队内部规划

~~~text
请阅读 docs/agents/dev-route/AGENTS.md 了解完整方法论，然后按
docs/agents/dev-route/prompt.md「共用流程」执行数据采集与聚类分析。

输出模式：本地 HTML 航线仪表盘
1. 复制 docs/agents/dev-route/route-template.html
   到 temp/exomind-route-YYYY-MM-DD.html
2. 只修改顶部 ROUTE 数据对象，不改渲染代码
3. 必须填写 publisher 四个字段
4. 完成后用 python3 -m http.server 8765 起本地服务
5. 用 termux-open-url http://localhost:8765/exomind-route-YYYY-MM-DD.html 打开
6. 告知用户文件路径
~~~

---

## 入口 B：ASCII 终端航线

> 适用场景：终端环境、快速概览

~~~text
请阅读 docs/agents/dev-route/AGENTS.md 了解完整方法论，然后按
docs/agents/dev-route/prompt.md「共用流程」执行数据采集与聚类分析。

输出模式：ASCII 终端
- 用双线框 ╔╗╚╝═║ 包裹
- 行宽 78 字符以内
- 区块：报头 / 航况+指标 / 批次列表(含依赖箭头) / 热力图 / 建议航向
- 直接输出到终端，不生成文件
~~~

---

## 共用流程

### 第一步：采集数据

先执行 `git fetch origin dev --quiet`，然后**并行**执行以下命令：

```bash
# 1. 全量 Open Issues
gh issue list --state open --limit 500 --json number,title,labels,milestone,createdAt

# 2. Open Issues 精确总数
gh issue list --state open --limit 500 --json number --jq 'length'

# 3. P0/P1 精确计数
gh issue list --state open --json labels --jq '[.[] | select([.labels[].name] | any(. == "P0"))] | length'
gh issue list --state open --json labels --jq '[.[] | select([.labels[].name] | any(. == "P1"))] | length'

# 4. dev 最新提交
git log --oneline -5 dev

# 5. 已有实施计划覆盖的 issue
grep -h "关联 Issue" docs/plans/2026-*.md 2>/dev/null

# 6. 近期关闭的 Issues
gh issue list --state closed --limit 30 --json number,title,closedAt
```

### 第二步：聚类分析

按 AGENTS.md「Issue 聚类算法」的五步流程执行：

1. **提取特征**：解析每个 issue 的领域前缀、类型、标签、平台、优先级、里程碑
2. **聚类**：按规则 1-5 顺序将 issue 归入批次
3. **平台分配**：每个批次分配到一个轨道
4. **粒度控制**：确保 3-12 issue/批次，超大聚类拆分
5. **命名**：查找已用批次字母，从下一个字母开始

### 第三步：依赖推导

按 AGENTS.md「批次间依赖推导」的规则 1-4 建立 DAG 边。

### 第四步：自检清单

在输出之前，内部校验（不输出给用户）：

- [ ] Open Issues 总数 = `jq 'length'` 返回值？
- [ ] 每个批次的 issue 数量在 3-12 范围内？
- [ ] 覆盖的 issue 总数 = 所有批次 issues 之和？
- [ ] 无循环依赖？
- [ ] 每个批次有且仅有一个轨道？
- [ ] P0 issue 优先出现在就绪批次中？
- [ ] 已有计划覆盖的 issue 标记了状态？

**如果任何一项对不上，重新执行对应步骤。**

### 第五步：填充数据并输出

按所选入口（A/B）填充 ROUTE 数据对象或渲染 ASCII。

### 质量红线

- 所有数字必须来自本次查询，禁止搬运
- 聚类理由须可追溯（同领域/同文件域/同里程碑）
- 覆盖率必须诚实标注
- 建议航向必须指向具体批次

---

## 完整方法论

详见同目录下的 `AGENTS.md`。
```

**Step 2: 校验**

```bash
wc -l docs/agents/dev-route/prompt.md
```
Expected: ~100+ 行

**Step 3: Commit**

```bash
git add docs/agents/dev-route/prompt.md
git commit -m "docs(dev-route): 开发航线启动提示词（A/B 双入口）"
```

---

## Task 4: 固化 HTML 模板

**Files:**
- Copy & Refine: `temp/exomind-route-2026-03-26.html` → `docs/agents/dev-route/route-template.html`

**Step 1: 复制原型为模板**

```bash
cp temp/exomind-route-2026-03-26.html docs/agents/dev-route/route-template.html
```

**Step 2: 清空 ROUTE 数据为占位符**

修改 `docs/agents/dev-route/route-template.html` 中的 `ROUTE` 对象：
- `meta.date` → `'YYYY-MM-DD'`
- `meta.baseline` → `'0000000'`
- `publisher` 所有字段 → 空字符串占位
- `batches` → 清空为空数组 `[]`（保留结构注释说明每个字段含义）
- `heatmap.data` → 全零矩阵
- `actions` → 空数组
- `insight` → 占位文字
- `metrics` 所有 value → `'0'`

在 ROUTE 对象顶部添加详细注释块，说明每个字段的含义和填充规则（参照 dev-daily 的 report-template.html 注释风格）。

**Step 3: 验证模板可打开**

```bash
python3 -c "
import http.server, threading, webbrowser, time
handler = http.server.SimpleHTTPRequestHandler
server = http.server.HTTPServer(('0.0.0.0', 8766), handler)
t = threading.Thread(target=server.serve_forever)
t.daemon = True
t.start()
print('Server started on :8766')
" &
sleep 1 && termux-open-url http://localhost:8766/docs/agents/dev-route/route-template.html
```

Expected: 页面打开，显示空数据的航线框架（不报错）

**Step 4: Commit**

```bash
git add docs/agents/dev-route/route-template.html
git commit -m "feat(dev-route): 开发航线 HTML 模板（dagre DAG + 交互面板）"
```

---

## Task 5: 更新文档索引

**Files:**
- Modify: `docs/README.md`

**Step 1: 在 docs/README.md 的 Agent 文档区域添加航线入口**

在已有的 `dev-daily` 条目附近添加：

```markdown
| 开发航线 | `docs/agents/dev-route/` | Issue 聚类分析与批次实施规划 |
```

**Step 2: Commit**

```bash
git add docs/README.md
git commit -m "docs: 添加开发航线 Agent 到文档索引"
```

---

## Task 6: 端到端验证

**Files:**
- 无新文件，验证流程

**Step 1: 模拟 Agent 执行入口 A 提示词**

将 `docs/agents/dev-route/prompt.md` 入口 A 的提示词完整复制，在新对话中执行。

**Step 2: 验证产出**

检查清单：
- [ ] `temp/exomind-route-YYYY-MM-DD.html` 文件生成
- [ ] ROUTE 数据中 batches 非空
- [ ] 浏览器中 DAG 节点可见且可点击
- [ ] 点击节点展开 issue 详情面板
- [ ] 热力图有数据
- [ ] 建议航向有具体批次引用

**Step 3: 修复发现的问题（如有）**

根据验证结果调整 AGENTS.md 或 route-template.html。

**Step 4: 最终 Commit**

```bash
git add -A
git commit -m "fix(dev-route): 端到端验证修复"
```

---

## 关键文件索引

| 文件 | 改动类型 | 用途 |
|------|----------|------|
| `docs/agents/dev-route/AGENTS.md` | 新建 | 方法论章程 |
| `docs/agents/dev-route/prompt.md` | 新建 | 启动提示词 |
| `docs/agents/dev-route/route-template.html` | 新建（从原型精炼） | HTML 模板 |
| `docs/README.md` | 修改 | 文档索引 |

## ⚠️ 不要做清单

| 禁止项 | 原因 |
|--------|------|
| 不要修改 dev-daily 的任何文件 | 航线是独立 Agent，不改动日报系统 |
| 不要引入 D3.js | dagre.js 足够，保持依赖最小 |
| 不要实现发布脚本 | 属于 Step 3，本次不做 |
| 不要在模板中硬编码真实数据 | 模板只有占位符，数据由 Agent 填充 |
| 不要改动 route-template.html 的渲染引擎代码 | 只清空数据部分 |

## ⚠️ 容易出错的关键点

1. **ROUTE vs REPORT**：航线数据对象叫 `ROUTE`，不要写成 `REPORT`（那是日报的）
2. **issue 聚类不是标签聚合**：标签只是特征之一，领域前缀和文件域更重要
3. **批次命名要查已有字母**：`grep "关联 Issue" docs/plans/` 找到已用批次，从下一个字母开始
4. **dagre CDN 需要网络**：离线时 DAG 不渲染，但其他区块正常
5. **模板清空数据时保留结构**：`batches: []` 不能删掉字段定义的注释

## 验证总表

| 场景 | 操作 | 期望结果 |
|------|------|----------|
| 模板空数据 | 浏览器打开 route-template.html | 显示空框架，无 JS 报错 |
| 入口 A 执行 | 复制提示词给 Agent | 生成含数据的 HTML |
| DAG 交互 | 点击节点 | 展开 issue 详情面板 |
| 热力图 | 查看矩阵 | 数字和颜色对应正确 |
| 建议航向 | 勾选 checkbox | 刷新后状态保持 |

## 完成回填

（执行后填写）
- 执行者：
- 执行时间：
- 分支/commit：
- 验证结果：
