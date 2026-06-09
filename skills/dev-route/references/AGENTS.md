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
exomind-route-YYYY-MM-DD-HHmmss.html
```

**本地输出目录**：`temp/`（gitignored）

同一天可生成多份（需求变化后重新聚类），按时间戳并存归档。

---

## HTML 模板

### 模板位置

同目录下 `route-template.html`。

### 使用方法

1. **复制模板**到 `temp/exomind-route-YYYY-MM-DD-HHmmss.html`
2. **修改顶部 `ROUTE` 数据对象**——只改数据，不改渲染代码
3. **起本地服务查看**：`python3 -m http.server 8765 --directory temp`
4. 浏览器打开 `http://localhost:8765/exomind-route-YYYY-MM-DD-HHmmss.html`

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

### 模板修改须三处同步

修改航线模板的渲染逻辑、样式或交互时，必须同步 devlog 运行时资产、exomind 模板源文件和 skills 副本三个位置。详见 `docs/agents/dev-daily/AGENTS.md`「模板与渲染引擎的三处同步规则」章节。

---

## 航线消费（供其他 Agent 查询）

航线不仅是发布物，也是其他 Agent 的**批次数据查询入口**。任何 Agent 在收到以下类型请求时，应先获取最新航线数据再行动。

### 触发词

| 用户说 | Agent 应做 |
|--------|-----------|
| "获取最新开发航线" / "航线状态" | 读取最新航线，输出概览 |
| "批次 X 里有哪些 issue" | 读取航线，提取对应批次详情 |
| "草拟批次 X 的实现计划" | 读取批次 → 衔接 planner-methodology 写计划 |
| "下一个该做哪个批次" | 读取航线，找 status=ready 且优先级最高的 |
| "批次 X 完成了吗" | 读取批次 issues，对比 gh issue 当前状态 |

### 获取最新航线数据

**标准方式：使用统一读取器**

```bash
bun run devlog:extract --type route
bun run devlog:extract --type route --format json
```

默认链路是：
1. `https://exomind-team.github.io/exomind-devlog/routes/manifest.json`
2. manifest 指向的 `dataFile` JSON
3. `https://exomind-team.github.io/exomind-devlog/routes/latest.json` 一致性校验

只有标准入口不可用时，读取器才允许 fallback 到本地 `exomind-devlog` 或 `temp/`，并在输出里的 `[devlog-source]` / `_devlogSource` 显式标注来源、可信度与校验状态。

**禁止**把“本地 temp/ 更完整”作为默认真相源；它可能是未发布或过期数据。

### 提取特定批次

从 ROUTE 对象中按 `id` 查找批次：

```javascript
// ROUTE.batches 是数组，每个元素：
{
  id: 'M',           // 批次字母
  name: '...',        // 批次名称
  track: 'web',      // 平台轨道
  status: 'ready',   // ready|active|done|blocked
  priority: 'P0',    // 最高优先级
  deps: [{id, reason}], // 前置依赖
  branch: '...',      // 建议分支名
  fileDomain: '...', // 文件域
  issues: [           // Issue 列表
    { num: 452, title: '...', priority: 'P0', done: false, size: 'M' },
  ],
}
```

Agent 应优先用统一读取器返回的 JSON 提取特定批次，例如：
```bash
# 快速查看批次 M 的 issue 编号
bun run devlog:extract --type route --format json | jq '.batches[] | select(.id == "M") | .issues[].num'
```

### 从批次到实施计划的衔接（计划撰写方法论）

当用户要求"草拟批次 X 的实现计划"时，Agent 应按以下流程执行。本流程从实战中提炼（批次 M1、N 的拟定经验），面向**无上下文的执行者 Agent**。

#### 第一步：环境能力评估与批次拆分

先判断批次内哪些 issue 在当前环境可做，必要时拆分：

| 环境能力 | 验证工具 | 可做的 issue 类型 |
|----------|----------|------------------|
| TypeScript/前端 | `npx tsc --noEmit` + `npx vitest run` | UI 修复、逻辑重构、安全清理 |
| Rust/RT | `cargo test` + `cargo build` + `cargo clippy` | RT API、数据层、状态机 |
| Web UI | `npx vite --host` + 浏览器 | 页面交互验证 |
| RT API | `cargo run` + `curl` | HTTP 端点验证 |
| CI/Scripts | 编辑 + push → GitHub Actions | workflow、脚本 |
| 文档/设计 | 编写 + commit | 研究、规格、讨论 |

**不可做**：需要桌面系统（Tauri 窗口/快捷键）、需要 Android APK 安装、需要多设备同步、需要音频硬件。

**拆分规则**：若批次内可做与不可做的 issue 混合存在，拆为子批次：
- `X1`：当前环境可完整交付的
- `X2`：需要特定设备/环境的，暂缓

#### 第二步：代码扫描（先扫描再写计划）

**这是计划质量的关键。** 不要凭记忆或 issue 标题推测代码状态，必须实际扫描。

按 issue 类型选择扫描策略：

| issue 类型 | 扫描方法 | 示例 |
|-----------|----------|------|
| 安全清理 | grep 预置 pattern 列表 | `api_key\|API_KEY\|apiKey\|secret\|token\|password` |
| Bug 修复 | 读取 issue 中报错的文件 + 调用链 | 从错误信息追溯到源函数 |
| 新 API | 读取现有同类 API 的实现 | 读 tasks.rs 了解现有路由再写新路由 |
| 重构 | 读取待重构模块 + 消费者 | 读模块本身 + grep 所有 import |

**预置 grep pattern（减少试错）**：

```bash
# 安全类 issue
grep -rn 'api_key\|API_KEY\|apiKey\|secret\|token\|password\|credential' src/ crates/ --include='*.ts' --include='*.rs'

# 环境变量类
grep -rn 'EXOMIND_\|VITE_\|import\.meta\.env' src/ --include='*.ts'

# Rust unwrap
grep -rn '\.unwrap()' crates/ --include='*.rs' | grep -v test | grep -v '#\[cfg(test)\]'

# 死代码（未使用的 export）
grep -rn 'pub fn\|pub async fn' crates/exomind-runtime/src/ --include='*.rs'
```

#### 第三步：生成计划文件

**文件名**：`docs/plans/YYYY-MM-DD-batch-{x}-{name}-plan.md`

**必须遵循 `docs/development/planner-methodology.md` 第四章的结构**：

```markdown
# 批次 X：名称

> **状态**：待执行
> **分支**：{batch.branch}
> **关联 Issue**：#xxx, #yyy, ...
> **执行顺序**：#xxx → #yyy → ...

## Context
（代码扫描发现 + 当前状态 + 本批次范围）

## 步骤 N：#xxx 标题
### N.1 改动（伪代码级）
### N.2 验证（具体命令 + 期望输出）

## 关键文件索引
（表格：文件 | 改动类型 | Issue）

## ⚠️ 不要做清单
（至少 5 条，精确到文件名）

## ⚠️ 容易出错的关键点
（来自代码扫描中发现的陷阱）

## 验证总表
（表格：场景 | 操作 | 期望结果 | Issue）

## 完成回填
（执行后填写）
```

#### 第四步：按 issue size 控制步骤详度

| Size | 步骤描述详度 | 示例 |
|------|-------------|------|
| **S** (小) | 改动摘要 ≤5 行，点明文件和函数名即可 | "在 `store.rs:validate_terminal_task_update()` 中追加 title 字段检查" |
| **M** (中) | 伪代码 ≤15 行，含关键逻辑和边界处理 | 含函数签名 + 核心 if/match 分支 |
| **L** (大) | 伪代码 ≤30 行，含完整数据流和错误处理 | 含 SQL、HTTP 路由定义、请求/响应类型 |
| **XL** (epic) | 拆为子步骤，每步 ≤15 行，标注哪些子步骤可并行 | 拆为 Phase 1/2/3 |

#### 第五步：相邻批次冲突检查

如果同时为多个批次写计划，必须在计划末尾补充：

```markdown
## 相邻批次文件冲突检查

| 文件 | 本批次改动 | 相邻批次 | 冲突风险 |
|------|-----------|---------|---------|
| src/xxx.ts | 修改 | 批次 Y #zzz | 低/中/高 |
```

检查方法：对比两个批次的 `fileDomain`，grep 共同文件路径。

#### 第六步：生成执行提示词

计划完成后，在 `.claude/tmp/prompt-batch-{x}.md` 生成可交给 Codex 的提示词：

```
第一行：指明计划文件路径
第二段：列举步骤编号和 issue 编号（概要）
第三段：3-5 条最重要的禁止项（从"不要做清单"中挑选高风险项）
最后：验证命令 + 回填指令
```

#### 质量标准

| 标准 | 要求 |
|------|------|
| **不要做清单** | ≥5 条，每条精确到文件名（"不要改动 xxx.ts"） |
| **验证命令** | 每个步骤必须有可在当前环境执行的验证命令 |
| **伪代码精度** | 必须包含文件路径和函数名，S size 可省略函数体 |
| **扫描先行** | 禁止不读代码就写计划，Context 必须包含扫描发现 |
| **覆盖诚实** | 若发现 issue 已部分完成（如 #460 Phase 1 已做），明确标注并调整范围 |

#### 经验教训（来自 M1/N 实战）

1. **grep 预置 pattern 列表**能把安全类 issue 的扫描从 45 次工具调用降到 15 次
2. **先做设计定论 issue**（如 #683），后续实现 issue 才有依据
3. **EventLog 写入用 best-effort 模式**（错误只 log 不传播），否则日志功能会拖垮主流程
4. **路由注册顺序很重要**：`/tasks/batch-transition` 必须在 `/tasks/:id` 之前，否则被参数捕获
5. **edition = "2024" 不存在**：扫描发现的这类"看起来对但实际无效"的值，只有读了代码才能发现

### 航线刷新判断

当 Agent 读取航线数据时，应先检查时效性：

```bash
# 检查最新航线的生成日期
ls -t temp/exomind-route-*.html | head -1 | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}'

# 或运行触发检查
bun run route:check
```

如果输出 `TRIGGER=true`，建议用户先重新生成航线再做批次规划。

### 示例对话流

```
用户：批次 O 里有哪些 issue？

Agent：
1. 用 `bun run devlog:extract --type route` 读取最新已发布航线
2. 提取批次 O 数据
3. 输出：

   批次 O：时间块体验修复
   轨道：Web-only | 状态：就绪 | 优先级：P1
   依赖：无
   分支：feature/batch-o-timeblock-polish
   文件域：src/ui/app/pages/Now*, TimeBlock*

   Issues (7):
   ○ #704 P1 关联任务刷新过慢（500ms 内更新）
   ○ #705 P2 移除关联任务未弹状态弹窗
   ○ #606 P2 取消关联时提供任务状态设置弹窗
   ...

用户：草拟批次 O 的实现计划

Agent：
1. 读取批次 O 数据
2. 读取 planner-methodology.md
3. 生成 docs/plans/2026-03-26-batch-o-timeblock-polish-plan.md
```
