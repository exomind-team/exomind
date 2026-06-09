# 开发日志 — 提示词入口

本文件包含三个独立的提示词入口，用户选择一个**全文复制**给任意 Agent 即可执行。

三个入口共享同一套采集与分析流程（见下方「共用流程」），区别仅在输出格式和交付方式。

---

## 入口 A：ASCII 终端日报

> 适用场景：终端环境、无浏览器、快速汇报

```text
请阅读 docs/agents/dev-daily/AGENTS.md 了解完整方法论，然后按
docs/agents/dev-daily/prompt.md「共用流程」执行数据采集与分析。

输出模式：ASCII 终端
- 按 7 区块结构渲染纯文本（报头/数据一览/头条/PR看板/Issue地形图/主线追踪/天气预报）
- 整体用双线框 ╔╗╚╝═║ 包裹，行宽 78 字符以内
- 报头使用 ExoMind ASCII Art Logo + 日期 + dev@<hash>
- 直接输出到终端，不生成文件
- 末尾附一行：💡 可升级：输入"HTML 日报"生成交互式仪表盘，或"发布"推送到 GitHub Pages

格式细则见 AGENTS.md「版面结构」和「格式规范」章节。
根据当前时间自动命名：夜报(0-6h)/早报(6-12h)/午报(12-18h)/晚报(18-24h)。
```

---

## 入口 B：本地 HTML 日报

> 适用场景：本地浏览器查看、离线归档、团队内部分享

```text
请阅读 docs/agents/dev-daily/AGENTS.md 了解完整方法论，然后按
docs/agents/dev-daily/prompt.md「共用流程」执行数据采集与分析。

输出模式：本地 HTML 仪表盘
1. 复制 docs/agents/dev-daily/report-template.html
   到 temp/exomind-daily-report-YYYY-MM-DD-HHmmss.html
2. 只修改顶部 REPORT 数据对象，不改渲染代码
3. 必须填写 publisher 四个字段（identity/os/model/version，见 AGENTS.md）
4. 根据当前时间设置 meta.title：夜报(0-6h)/早报(6-12h)/午报(12-18h)/晚报(18-24h)
5. 完成后告知用户文件路径，并提示：
   💡 可升级：输入"发布"将此报告推送到 GitHub Pages 公开归档
```

---

## 入口 C：公开发布日报

> 适用场景：推送到 GitHub Pages 供团队和公众访问

```text
请阅读 docs/agents/dev-daily/AGENTS.md 了解完整方法论，然后按
docs/agents/dev-daily/prompt.md「共用流程」执行数据采集与分析。

输出模式：公开发布到 GitHub Pages
1. 先按「入口 B」生成本地 HTML 到 temp/exomind-daily-report-YYYY-MM-DD-HHmmss.html
2. 执行 bun run devlog:publish 发布
3. 脚本自动：标准化生成 `reports/*.json` + loader `reports/*.html` + `reports/latest.json` + `reports/manifest.json` → push → 等待 Pages 构建 → 回读 GitHub Pages 默认入口校验
4. 完成后输出公开链接：
   - 归档首页: https://exomind-team.github.io/exomind-devlog/
   - 本期日报: https://exomind-team.github.io/exomind-devlog/reports/YYYY-MM-DD-HHmmss.html
   - 数据文件: https://exomind-team.github.io/exomind-devlog/reports/YYYY-MM-DD-HHmmss.json

发布目标仓库本地工作树默认：../exomind-devlog
若不存在请先 gh repo clone exomind-team/exomind-devlog ../exomind-devlog
```

---

## 共用流程

以下是三个入口共享的数据采集与分析流程。

### 第一步：采集数据

先执行 `git fetch origin dev --quiet`，然后**并行**执行以下命令：

```bash
# 1. Open PRs（仅 open 状态）
gh pr list --state open --json number,title,headRefName,isDraft,labels,createdAt,updatedAt

# 2. 近期合并的 PR（覆盖区间内）
gh pr list --state merged --limit 20 --json number,title,mergedAt

# 3. Open Issues 总数（精确计数，注意 --limit 500 确保不截断）
gh issue list --state open --limit 500 --json number --jq 'length'

# 4. Open Issues 详情（标签、标题）
gh issue list --state open --limit 500 --json number,title,labels,createdAt

# 5. 近期关闭的 Issues
gh issue list --state closed --limit 20 --json number,title,closedAt

# 6. P0 精确计数（仅 open 状态）
gh issue list --state open --json labels --jq '[.[] | select([.labels[].name] | any(. == "P0"))] | length'

# 7. P1 精确计数（仅 open 状态）
gh issue list --state open --json labels --jq '[.[] | select([.labels[].name] | any(. == "P1"))] | length'

# 8. 标签分布（仅 open 状态）
gh issue list --state open --limit 500 --json labels --jq '[.[].labels[].name] | group_by(.) | map({key: .[0], count: length}) | sort_by(-.count)'

# 9. dev 最新提交
git log --oneline -15 dev

# 10. 战场清点 — 无优先级 issue 数
gh issue list --state open --limit 500 --json number,labels --jq '[.[] | select(([.labels[].name] | map(select(startswith("P"))) | length) == 0)] | length'

# 11. 战场清点 — 陈年阵地（>30 天的 open issue 数）
gh issue list --state open --limit 500 --json createdAt --jq "[.[] | select(.createdAt < \"$(date -d '30 days ago' +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -v-30d +%Y-%m-%dT%H:%M:%S)\")] | length"

# 12. 战场清点 — P0/P1 创建日期（用于计算停滞天数）
gh issue list --state open --limit 500 --json number,title,labels,createdAt --jq '.[] | select([.labels[].name] | any(. == "P0" or . == "P1")) | "\(.number)|\(.title[:50])|\([.labels[].name] | map(select(startswith("P"))) | first)|\(.createdAt[:10])"'
```

#### 采集防护规则

1. **`--state open` 是硬性要求**：所有 Issue 统计必须显式指定 `--state open`，禁止使用默认值
2. **`--limit` 必须大于预期总数**：`gh issue list` 默认只返回 30 条，必须设置 `--limit 500`
3. **P0/P1 必须独立查询**：不要从标签分布中手动数，必须用专用 jq 查询精确计数
4. **总数用 `jq 'length'` 确认**：Open Issues 总数必须单独获取一次，作为校验基准

**禁止复用任何缓存或上次报告的数据。所有数字必须来自本次查询。**

### 第二步：分析 + 校验

#### 2a. 自检清单

在渲染之前，先回答以下问题（内部校验，不输出给用户）：

- [ ] Open Issues 总数 = `jq 'length'` 返回的数字？
- [ ] Open PRs 总数 = PR 列表条目数？
- [ ] P0 数量 = 独立 P0 查询返回的数字？
- [ ] P1 数量 = 独立 P1 查询返回的数字？
- [ ] 标签分布各项数字之和是否合理？（同一 Issue 可有多个标签，所以标签总数 >= Issue 总数）
- [ ] 新增 Issue 数 = Open Issues 中 `createdAt > 覆盖区间起点` 的条目数？
- [ ] 合并 PR 数 = merged PRs 中 `mergedAt > 覆盖区间起点` 的条目数？
- [ ] truth 表继承检查：读取 `reports/manifest.json` 或上一期报告的 `truth.stillOpen`，逐条用 `gh issue view <num> --json state` 确认是否仍 OPEN。已合并的 PR 对应的 Issue 如果仍 OPEN，必须出现在本期 `truth.stillOpen` 中。

**如果任何一项对不上，重新执行对应查询，不要猜测或推算。**

#### 2b. 提取分析

1. **4 项指标**：Open Issues 总数、Open PRs 总数、覆盖区间内新增 Issue 数、覆盖区间内合并 PR 数
2. **2-3 条头条**，按优先级选取：P0 级变动 > 里程碑进展 > 流程变动 > 异常信号
3. **Issue 标签分布**：按数量降序，P0/P1 行标注具体编号
4. **3-5 条主线**：找 epic/P0 产品目标，估算完成百分比
5. **天气等级**：☀️晴 / ⛅晴转多云 / 🌥️多云 / 🌧️阵雨 / ⛈️雷暴
6. **战场清点**（4 信号）：
   - **⚑ 战果未清**：对比 merged PRs 标题中的 `#NNN` 与 issue state，列出已合并但 issue 仍 OPEN 的条目
   - **⏳ 僵持线**：P0/P1 issue 的 `createdAt` 距今超过 7 天且无近期关联 commit，列出编号 + 停滞天数
   - **🏷 未编入**：无 P0/P1/P2 标签的 issue 数（与上期对比）
   - **📦 陈年阵地**：创建超 30 天的 open issue 占比（>25% ⚠️ / >40% 🔴）

### 质量红线

- 所有数字必须来自本次查询，禁止搬运
- **禁止在报告中出现"数据缺失"、"暂无数据"、"查询失败"等警告文本**
- **禁止在报告中出现空白字段、占位符、TODO 标记**
- **Open Issues 总数必须与 `jq 'length'` 返回值一致，不允许偏差**
- **P0/P1 数量必须与独立查询结果一致，不允许从标签分布中推算**
- 头条必须包含具体 PR/Issue/commit 编号
- 天气判定必须基于实际信号
- "建议行动"必须是具体操作（如"关闭 #452"），不写"持续关注"

**如果无法满足任何一条红线，必须停止生成报告，输出失败诊断。**

---

## 质量拦截机制

**重要**：发布脚本 `bun run devlog:publish` 会在发布前执行完整性校验，检查以下内容：

### 必填字段校验

1. **Meta 字段**：date（10+ 字符）、baseline（7+ 字符）
2. **Publisher 字段**：identity、os、model、version（全部必填）
3. **Metrics 数组**：至少 4 项，不允许占位符值（? 或 -）
4. **Headlines 数组**：至少 2 项，必须包含 Issue/PR 编号（#123）
5. **Mainlines 数组**：至少 3 项
6. **Weather 字段**：status、emoji、label、actions（至少 1 条）
7. **Truth 表**：stillOpen 数组必须存在
8. **PoolHealth 字段**：aging.total > 0、aging.samples 非空

### 占位符检测

脚本会拒绝包含以下文本的报告：
- "数据缺失"、"暂无数据"、"查询失败"
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
- ❌ 禁止：生成带警告的半成品报告

---

## 完整方法论

详见同目录下的 `AGENTS.md`。
