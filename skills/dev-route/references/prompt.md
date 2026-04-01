# 开发航线 — 提示词入口

本文件包含三个独立的提示词入口，用户选择一个**全文复制**给任意 Agent 即可执行。

三个入口共享同一套采集与聚类流程（见下方「共用流程」），区别仅在输出格式和是否公开发布。

---

## 入口 A：本地 HTML 航线

> 适用场景：本地浏览器查看、团队内部规划、交互式 DAG 探索

```text
请阅读 docs/agents/dev-route/AGENTS.md 了解完整方法论，然后按
docs/agents/dev-route/prompt.md「共用流程」执行数据采集与聚类分析。

输出模式：本地 HTML 航线仪表盘
1. 复制 docs/agents/dev-route/route-template.html
   到 temp/exomind-route-YYYY-MM-DD-HHmmss.html
2. 只修改顶部 ROUTE 数据对象，不改渲染代码
3. 必须填写 publisher 四个字段（identity/os/model/version）
4. 完成后执行：
   python3 -m http.server 8765 --directory temp --bind 0.0.0.0 &
   termux-open-url http://localhost:8765/exomind-route-YYYY-MM-DD-HHmmss.html
5. 告知用户文件路径和访问地址
```

---

## 入口 B：公开发布航线

> 适用场景：推送到 GitHub Pages，作为正式批次规划归档

```text
请阅读 docs/agents/dev-route/AGENTS.md 了解完整方法论，然后按
docs/agents/dev-route/prompt.md「共用流程」执行数据采集与聚类分析。

输出模式：公开发布到 GitHub Pages
1. 先按「入口 A」生成本地 HTML 到 temp/exomind-route-YYYY-MM-DD-HHmmss.html
2. 执行 bun run route:publish 发布
3. 脚本自动：标准化生成 `routes/*.json` + loader `routes/*.html` + `routes/latest.json` + `routes/manifest.json` → push → 等待 Pages 构建 → 回读 GitHub Pages 默认入口校验
4. 完成后输出公开链接：
   - 归档首页: https://exomind-team.github.io/exomind-devlog/
   - 本期航线: https://exomind-team.github.io/exomind-devlog/routes/YYYY-MM-DD-HHmmss.html
   - 数据文件: https://exomind-team.github.io/exomind-devlog/routes/YYYY-MM-DD-HHmmss.json
```

---

## 入口 C：ASCII 终端航线

> 适用场景：终端环境、快速概览、无浏览器

```text
请阅读 docs/agents/dev-route/AGENTS.md 了解完整方法论，然后按
docs/agents/dev-route/prompt.md「共用流程」执行数据采集与聚类分析。

输出模式：ASCII 终端
- 用双线框 ╔╗╚╝═║ 包裹，行宽 78 字符以内
- 区块结构：
  1. 报头（EXOMIND ASCII Art + 开发航线 + 日期）
  2. 航况 + 4 指标（方框数字）
  3. 批次列表（按轨道分组，标注依赖箭头和状态）
  4. 热力图（优先级×平台 ASCII 矩阵）
  5. 建议航向（1-3 条具体行动）
- 直接输出到终端，不生成文件
```

---

## 共用流程

以下是两个入口共享的数据采集与聚类分析流程。

### 第一步：采集数据

先执行 `git fetch origin dev --quiet`，然后**并行**执行以下命令：

```bash
# 1. 全量 Open Issues（标签+标题+里程碑）
gh issue list --state open --limit 500 --json number,title,labels,milestone,createdAt

# 2. Open Issues 精确总数
gh issue list --state open --limit 500 --json number --jq 'length'

# 3. P0 精确计数
gh issue list --state open --json labels --jq '[.[] | select([.labels[].name] | any(. == "P0"))] | length'

# 4. P1 精确计数
gh issue list --state open --json labels --jq '[.[] | select([.labels[].name] | any(. == "P1"))] | length'

# 5. 标签分布
gh issue list --state open --limit 500 --json labels --jq '[.[].labels[].name] | group_by(.) | map({key: .[0], count: length}) | sort_by(-.count)'

# 6. dev 最新提交
git log --oneline -5 dev

# 7. 已有实施计划覆盖的 issue
grep -h "关联 Issue" docs/plans/2026-*.md 2>/dev/null

# 8. 近期关闭的 Issues
gh issue list --state closed --limit 30 --json number,title,closedAt
```

#### 采集防护规则

1. **`--state open` + `--limit 500`** 是硬性要求
2. **P0/P1 必须独立查询**，不从标签分布推算
3. **总数用 `jq 'length'` 确认**
4. **禁止复用任何缓存或上次航线数据**

### 第二步：聚类分析

按 AGENTS.md「Issue 聚类算法」五步执行：

**2a. 提取特征**
解析每个 issue 的领域前缀（title 括号内）、类型前缀（feat/bug/fix...）、标签集、平台标签、优先级、里程碑。

**2b. 聚类**
按规则 1-5 顺序将 issue 归入批次：
1. 同领域前缀 → 同批次
2. 同文件域 → 同批次
3. 有显式依赖 → 同批次并排序
4. 同里程碑 → 优先同批次
5. research/discussion → 单独归类

**2c. 平台分配**
每个批次分配到唯一轨道（Web/RT/Desktop/Android/Cross/CI）。

**2d. 粒度控制**
确保每批次 3-12 issue。超大聚类拆分，过小聚类合并。

**2e. 命名**
查找已用批次字母（`grep "批次 [A-Z]" docs/plans/`），从下一个字母开始。

### 第三步：依赖推导

按 AGENTS.md「批次间依赖推导」建立 DAG 边：
1. issue 级显式依赖 → 批次级依赖
2. 文件域消费关系 → 依赖
3. P0 紧急修复 → 所有后续批次隐式前置
4. 同轨道基建先于功能

检查无循环依赖。

### 第四步：自检清单

在输出之前，内部校验（不输出给用户）：

- [ ] Open Issues 总数 = `jq 'length'` 返回值？
- [ ] 每个批次 issue 数在 3-12 范围内？
- [ ] 覆盖 issue 总数 = 所有批次 issues 去重之和？
- [ ] 无循环依赖？
- [ ] 每个批次有且仅有一个轨道？
- [ ] P0 issue 出现在就绪或优先批次中？
- [ ] 已有计划覆盖的 issue 标记了 done 状态？

**如果任何一项对不上，重新执行对应步骤，不要猜测或推算。**

### 第五步：构建 ROUTE 数据

将聚类结果填入 ROUTE 数据结构：

1. **meta**：当前日期 + `git log --oneline -1 dev` 的 hash
2. **status**：按航况判定表评估
3. **metrics**：从批次列表统计
4. **batches**：聚类结果，每个批次含完整 issues 列表
5. **heatmap**：遍历所有 open issues，按优先级×平台统计矩阵
6. **actions**：根据批次状态推荐 1-3 个下一步
7. **insight**：一段分析性总结

### 第六步：输出

按所选入口格式输出：
- **入口 A**：复制模板 → 填充 ROUTE → 起服务 → 打开浏览器
- **入口 B**：复制模板 → 执行 `bun run route:publish` → 输出公开链接
- **入口 C**：渲染 ASCII 文本 → 直接输出到终端

### 质量红线

- 所有数字必须来自本次查询，禁止搬运
- **禁止在航线中出现"数据缺失"、"暂无数据"、"聚类失败"等警告文本**
- **禁止在航线中出现空白字段、占位符、TODO 标记**
- 聚类理由须可追溯（同领域/同文件域/同里程碑）
- 覆盖率必须诚实标注（明确说"N 个远期 issue 未纳入"）
- 建议航向必须指向具体批次和 issue 编号
- 热力图数字须与实际 issue 标签匹配

**如果无法满足任何一条红线，必须停止生成航线，输出失败诊断。**

---

## 质量拦截机制

**重要**：发布脚本 `bun run route:publish` 会在发布前执行完整性校验，检查以下内容：

### 必填字段校验

1. **Meta 字段**：date（10+ 字符）、baseline（7+ 字符）
2. **Publisher 字段**：identity、os、model、version（全部必填）
3. **Status 字段**：level、emoji、label（全部必填）
4. **Metrics 数组**：至少 3 项，不允许占位符值（? 或 -）
5. **Batches 数组**：至少 3 个批次，每个批次 3-12 个 issue，每个批次必须有 track
6. **Heatmap 数据**：data 数组至少 1 项
7. **Actions 数组**：至少 1 条，必须指向具体批次和 issue
8. **Insight 字段**：至少 20 字符

### 占位符检测

脚本会拒绝包含以下文本的航线：
- "数据缺失"、"暂无数据"、"查询失败"、"聚类失败"
- "TODO"、"请填写"、"placeholder"
- "持续关注"、"继续观察"（在 actions 中）
- 占位符值：`value: '?'` 或 `value: '-'`

### 失败处理

如果校验失败，脚本会：
1. **拒绝发布**，不生成任何文件
2. **输出详细错误信息**，列出所有违反的质量红线
3. **提供修复建议**，告知如何修复问题

**Agent 的责任**：
- ✅ 任务成功：输出完整产物（所有字段填充完整、所有校验通过）
- ✅ 任务失败：停止生成，输出失败诊断（包含原因、诊断信息、建议操作）
- ❌ 禁止：生成带警告的半成品航线

---

## 完整方法论

详见同目录下的 `AGENTS.md`。
