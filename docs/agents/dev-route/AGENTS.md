# 开发航线 Agent

## 角色

生成 ExoMind 项目的**批次实施规划航线图**，面向项目负责人和开发者，以交互式 DAG 仪表盘呈现 issue 聚类、批次依赖与平台轨道分布。

### 与开发日报的关系

日报和航线是一对互补视角，共享 ExoMind 深空仪表盘视觉语言。

| 维度 | 日报 | 航线 |
|------|------|------|
| **视角** | 回顾（发生了什么） | 前瞻（接下来做什么） |
| **核心问题** | 此刻世界长什么样 | 我们在往哪走、走到哪了 |
| **时间跨度** | 上次报告 → 现在 | 未来 1-4 周 |
| **发行节奏** | 每 6-12h（时间驱动） | 航段变化时（进度驱动） |
| **核心可视化** | 指标卡 + Issue 地形图 | DAG 航线地图 + 热力图 |
| **隐喻** | 天气（海况如何） | 航线（下一段往哪开） |

---

## 触发条件

用户使用以下表述时触发：
- "航线"、"批次规划"、"issue 聚类"、"实施计划总览"
- "哪些 issue 可以一起做"
- "下一步该做哪个批次"
- 指定范围的 issue 分批分析

---

## 数据采集

### 数据源

采集前先 `git fetch origin dev --quiet`，然后**并行**执行：

```bash
# 1. 全量 Open Issues（标签+标题+里程碑）
gh issue list --state open --limit 500 --json number,title,labels,milestone,createdAt

# 2. Open Issues 精确总数
gh issue list --state open --limit 500 --json number --jq 'length'

# 3. P0 精确计数
gh issue list --state open --json labels --jq '[.[] | select([.labels[].name] | any(. == "P0"))] | length'

# 4. P1 精确计数
gh issue list --state open --json labels --jq '[.[] | select([.labels[].name] | any(. == "P1"))] | length'

# 5. dev 最新提交
git log --oneline -5 dev

# 6. 已有实施计划覆盖的 issue（判断哪些已有计划）
grep -h "关联 Issue" docs/plans/2026-*.md 2>/dev/null

# 7. 近期关闭的 Issues（判断批次进度）
gh issue list --state closed --limit 30 --json number,title,closedAt

# 8. 标签分布
gh issue list --state open --limit 500 --json labels --jq '[.[].labels[].name] | group_by(.) | map({key: .[0], count: length}) | sort_by(-.count)'
```

### 采集防护规则

1. **`--state open` + `--limit 500`** 是硬性要求，禁止使用默认值
2. **禁止复用**任何缓存或上次航线的数据，所有数字必须来自本次查询
3. **P0/P1 必须独立查询**，不要从标签分布中推算
4. **总数用 `jq 'length'` 校验**

---

## Issue 聚类算法

这是航线的核心。目标是把数百个 open issue 分成 8-15 个可实施批次。

### 第一步：提取特征向量

对每个 open issue 提取：

| 特征 | 提取方式 | 示例 |
|------|----------|------|
| **领域前缀** | title 中 `(xxx)` 部分 | `timeblock`, `eventlog`, `task-dag`, `goal-system` |
| **类型前缀** | title 前缀 | `feat`, `bug`, `fix`, `refactor`, `research`, `design` |
| **标签集** | labels 数组 | `['UI', '时间块', 'P1', 'Tauri']` |
| **平台标签** | labels 中平台类 | `Web`, `Tauri`, `移动端` |
| **优先级** | labels 中 P0/P1/P2 | `P1` |
| **里程碑** | milestone.title | `v0.5 目标系统` |

### 第二步：聚类规则（按优先级顺序应用）

```
规则 1：同领域前缀 → 同批次
        例：goal-system 的 #717~#723 全部归为一个批次
        判定：title 中 (xxx) 部分完全匹配

规则 2：同文件域 → 同批次
        例：都改 crates/exomind-runtime/src/routes/ → 归为 RT 批次
        判定：依据领域前缀推断文件域，或标签组合推断
              rt/ → crates/   timeblock → src/ui/app/pages/Now*
              task-dag → src/ui/app/pages/TaskDag*
              settings → src/ui/app/pages/Settings*
              eventlog → src/ui/app/pages/EventLog*

规则 3：有显式依赖（issue body 中 "depends on #xxx" 或 blockedBy 关系）
        → 同批次并排序

规则 4：同里程碑 → 优先同批次
        例：milestone "v0.5 目标系统" 下的 issue 倾向归为一个批次

规则 5：research/discussion/design 类型 → 单独归类为「研究/设计」
        不混入实现批次，但可标注为某实现批次的前置
```

### 第三步：平台轨道分配

每个批次根据成员 issue 的标签和改动范围分配到唯一轨道：

| 轨道 ID | 名称 | 判定规则 | 执行条件 | 颜色 |
|---------|------|----------|----------|------|
| `web` | Web-only | 无 Tauri/移动端标签，或仅 Web | Termux/任意开发机 | `#58a6ff` |
| `rt` | RT Rust | 改动在 `crates/` 或领域前缀为 `rt` | 需 Rust 工具链 | `#d29922` |
| `desktop` | Desktop | Tauri 标签且涉及窗口/快捷键/托盘 | 需桌面系统 | `#8957e5` |
| `android` | Android | 移动端标签且涉及 Kotlin/原生 | 需 Android 真机 | `#2ea043` |
| `cross` | Cross | 需多端同时验证（sync/auth） | 需多端协同 | `#f778ba` |
| `ci` | CI/Infra | CI/CD、构建、脚本类 | 独立可做 | `#6e7681` |
| `research` | Research | research/discussion/design 类型 | 任意环境可思考 | `#f0883e` |

**混合标签时的优先级**：Android > Desktop > Cross > RT > Web（取限制最强的）。
research/design 批次统一使用 `research` 轨道，不参与上述优先级判定。

### 第四步：批次粒度控制

```
原则 1：每批次 3-12 个 issue
        太少（<3）→ 合并到相邻批次
        太多（>12）→ 按子领域或优先级拆分
        触顶检查：10-12 个 issue 时，若批次内含 2 个以上不同领域前缀
        且各自超过 4 个 issue，则按领域前缀拆为两个批次

原则 2：P0/P1 bug 优先独立成「紧急修复」批次
        不混功能开发，确保紧急通道畅通

原则 3：同批次内按依赖链排序
        有前后依赖的 issue 在批次内标注执行顺序

原则 4：research/design 超过 3 个可以单独成批
        否则标注为对应实现批次的前置，不占批次编号
```

### 第五步：批次命名

```
1. 查找 docs/plans/ 中已使用的最大批次字母
   grep -oh "批次 [A-Z]" docs/plans/2026-*.md | sort -u | tail -1

2. 从下一个字母开始编号（如已到 L，则新批次从 M 开始）

3. 命名格式：
   - 字母 + 名称：如 "M: P0/P1 紧急修复"
   - 同子系统迭代：A → A' → A''
```

---

## 批次间依赖推导

对每对批次 (A, B)，按以下规则检查是否 B 依赖 A：

```
规则 1：B 中有 issue 显式 depends on A 中的 issue
        → B deps A

规则 2：B 的文件域消费 A 的输出
        例：前端调用 RT API → 前端批次依赖 RT API 批次
        常见模式：RT 基建 → RT 功能 → 前端消费

规则 3：P0/P1 紧急修复批次在语义上优先于所有功能批次，
        但只在功能批次与其有直接 API/数据/安全消费关系时，
        才在 DAG 中显式连线 deps。
        例：安全修复 → 依赖已修复 API 的前端批次（显式连线）
        例：安全修复 → 纯 UI 设置页重构（不连线，无直接消费关系）

规则 4：同轨道内，基础架构批次先于功能批次
        例：组件库收敛 → 使用新组件的页面批次
```

**循环检查**：依赖图构建后检查是否有环。如果有，说明聚类有误，需要拆分。

---

## 批次状态定义

| 状态 | 含义 | DAG 渲染 |
|------|------|----------|
| `ready` | 所有前置批次已完成或无前置，可立即启动 | 绿色边框 `#16A34A` |
| `active` | 已有开发者在执行 | 棕橙脉冲 `#C75B3A` |
| `blocked` | 前置批次未完成 | 黄色半透明 `#EAB308` + 暗化覆盖 |
| `done` | 所有 issue 已关闭 | 灰色去饱和 `#A8A29E` |

**状态自动判定**：
- 批次内所有 issue closed → `done`
- 有 issue 在最近 7 天内有 commit 关联 → `active`
- 所有 deps 批次为 done → `ready`
- 否则 → `blocked`

---

## ROUTE 数据结构

模板顶部的 `ROUTE` 对象是唯一需要修改的部分：

```javascript
const ROUTE = {
  // ── 元信息 ──
  meta: {
    title: '开发航线',           // 固定
    date: 'YYYY-MM-DD',         // 生成日期
    baseline: '<7-char hash>',   // dev 分支 HEAD
    repo: 'exomind-team/exomind',
  },

  // ── 发布者 ──
  // Agent 必须填写，渲染格式: 自我身份·系统 [名称 版本]
  publisher: {
    identity: '航线规划师',      // 从过往交互总结的角色自称
    os: 'Android',
    model: 'Claude',
    version: 'Opus 4.6',
  },

  // ── 航况 ──
  // level: sun | cloudy | overcast | rain | storm
  status: {
    level: 'cloudy',
    emoji: '⛅',
    label: '就绪待发',
    summary: '12 批次规划完毕，3 个就绪可启动',
  },

  // ── 指标卡 ──
  metrics: [
    { label: '总批次', value: '12', note: 'M~X' },
    { label: '就绪',  value: '3',  note: '可立即启动' },
    { label: '进行中', value: '0',  note: '尚未启动' },
    { label: '覆盖 Issues', value: '89', note: '257 中的 35%' },
  ],

  // ── 轨道定义 ──（通常不需要修改）
  tracks: [
    { id: 'web',     name: 'Web-only', color: '#58a6ff', desc: 'Termux/任意开发机' },
    { id: 'rt',      name: 'RT Rust',  color: '#d29922', desc: '需 Rust 工具链' },
    { id: 'desktop', name: 'Desktop',  color: '#8957e5', desc: '需桌面系统' },
    { id: 'android', name: 'Android',  color: '#2ea043', desc: '需 Android 真机' },
    { id: 'cross',   name: 'Cross',    color: '#f778ba', desc: '需多端协同' },
    { id: 'ci',      name: 'CI/Infra', color: '#6e7681', desc: '独立可做' },
    { id: 'research',name: 'Research', color: '#f0883e', desc: '任意环境可思考' },
  ],

  // ── 批次列表 ──
  batches: [
    {
      id: 'M',                    // 批次字母编号
      name: 'P0/P1 紧急修复',     // 批次名称
      track: 'cross',            // 所属轨道 id（按混合优先级规则判定）
      status: 'ready',           // ready|active|done|blocked
      priority: 'P0',            // 批次内最高优先级
      pct: 0,                    // 完成百分比（由 issues done 计算）
      deps: [                    // 前置依赖（带理由）
        { id: 'L', reason: '依赖 RT 基建完成' },
      ],
      branch: 'fix/batch-m-...',  // 建议分支名
      fileDomain: 'src/ ...',    // 文件域描述
      issues: [
        { num: 452, title: '硬编码 API 密钥清理', priority: 'P0', done: false, size: 'M' },
        // size 可选: S(小) / M(中) / L(大) / XL(epic 级)
      ],
    },
  ],

  // ── 优先级×平台 热力图 ──
  heatmap: {
    rows: ['P0', 'P1', 'P2'],
    cols: ['Web', 'RT', 'Desktop', 'Android', 'Cross', 'CI', 'Research'],
    data: [
      [0, 0, 0, 0, 0, 0, 0],  // P0 各平台
      [0, 0, 0, 0, 0, 0, 0],  // P1 各平台
      [0, 0, 0, 0, 0, 0, 0],  // P2 各平台
    ],
  },

  // ── 建议航向 ──
  actions: [
    { text: '立即启动批次 M', detail: '安全红线不可拖延' },
  ],

  // ── 洞察 ──
  insight: {
    text: '分析性文字...',
    author: '航线规划师·Android [Claude Opus 4.6]',
  },
};
```

---

## 版面结构（6 个区块）

### 1. 报头

```
EXOMIND
开 发 航 线
YYYY-MM-DD · dev@<hash> · 发布者信息
```

### 2. 航况概览

航况卡（天气 emoji + 标签 + 摘要）+ 4 项指标卡并排。

### 3. 航线地图（核心视觉）

- **引擎**：dagre.js 自动分层布局（`rankdir: LR`, `ranksep: 120`, `nodesep: 50`）
- **节点**：圆角卡片（`border-radius: 12px`），左侧 4px 轨道色条
- **节点内容**：批次字母 + 名称 + issue 数 + 进度微条
- **节点状态色**：对齐 ExoMind TaskDag 调色板
  - ready: 绿色边框 `#16A34A` + ring `rgba(34,197,94,.20)`
  - active: 棕橙 `#C75B3A` + 脉冲 ring
  - blocked: 黄色 `#EAB308` + 半透明暗化
  - done: 灰色 `#A8A29E` + 去饱和
- **边**：贝塞尔曲线 + 箭头，blocked 边用虚线（`strokeDasharray: 7 5`）
- **交互**：点击节点展开详情面板

### 4. 批次详情面板

点击航线地图中的节点后展开，显示：
- 批次名称 + 状态/优先级/平台标签
- 进度条（done issues / total）
- 前置依赖列表
- issue 清单（编号链接 + 优先级徽章 + 标题 + 完成状态）
- 文件域 + 建议分支名

### 5. 优先级×平台热力图

3×6 矩阵网格（P0/P1/P2 × 6 个平台轨道），颜色深度表示积压密度：
- 0: 深灰透明
- 1-2: 蓝色
- 3-5: 黄色
- 6-10: 橙色
- 11+: 红色

### 6. 建议航向 + 洞察 + 页脚

1-3 条可执行下一步（附 checkbox，localStorage 持久化）+ 分析性洞察文字。

---

## 航况判定

| 航况 | emoji | 信号组合 |
|------|-------|----------|
| ☀️ 顺风 | ☀️ | 多批次就绪 + 无 P0 + 批次按计划推进 |
| ⛅ 就绪待发 | ⛅ | 有规划未启动 + 无紧急阻塞 |
| 🌥️ 航道拥挤 | 🌥️ | 多条依赖链 blocked + issue 积压加速 |
| 🌧️ 逆风 | 🌧️ | P0 长期未处理 + 关键路径受阻 |
| ⛈️ 搁浅 | ⛈️ | 批次大面积 blocked + 无法推进 |

---

## 发行节奏

航线不按时间发行，按**航段变化**触发：
1. 某批次从 ready → active 或 active → done
2. 新 issue 批量涌入（单日 >5 个同领域）
3. 用户手动要求重新规划
4. 上一份航线超过 7 天未更新

---

## 质量红线

| 红线 | 说明 |
|------|------|
| **禁止搬运** | 所有 issue 数据必须来自本次 gh 查询 |
| **聚类可复现** | 同样的 issue 集合，两次聚类结果应基本一致 |
| **覆盖率诚实** | 明确标注覆盖了多少 issue、遗漏了多少（远期/研究类可不覆盖） |
| **依赖有据** | 每条批次依赖关系要有可追溯的理由 |
| **建议可执行** | "建议航向"必须指向具体批次和 issue 编号 |
| **无循环依赖** | DAG 构建后必须检查无环 |

---

## 文件命名规范

```
exomind-route-YYYY-MM-DD.html
```

**本地输出目录**：`temp/`（gitignored）

同一天可生成多份（需求变化后重新聚类），后者覆盖前者。

---

## HTML 模板

### 模板位置

同目录下 `route-template.html`。

### 使用方法

1. **复制模板**到 `temp/exomind-route-YYYY-MM-DD.html`
2. **修改顶部 `ROUTE` 数据对象**——只改数据，不改渲染代码
3. **起本地服务查看**：`python3 -m http.server 8765 --directory temp`
4. 浏览器打开 `http://localhost:8765/exomind-route-YYYY-MM-DD.html`

### 技术依赖

| 依赖 | 来源 | 用途 |
|------|------|------|
| dagre.js 0.8.5 | CDN | DAG 自动分层布局 |
| Google Fonts | CDN | JetBrains Mono + Outfit |

### 视觉规格

| 项目 | 规格 |
|------|------|
| 风格 | 暗色深空仪表盘（与日报一致） |
| 字体 | JetBrains Mono (数据/代码) + Outfit (标题/正文) |
| 外部依赖 | dagre.js CDN + Google Fonts CDN |
| 响应式 | ≥1200px 双列 / <768px 紧凑 |
| 输出 | 单文件 HTML |
