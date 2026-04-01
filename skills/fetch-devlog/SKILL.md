---
name: fetch-devlog
description: Fetch and parse the latest ExoMind development report or route data from GitHub Pages or local devlog repository. Use when the user asks about project status, latest report, or development progress.
---

# Fetch Devlog

获取并解析 ExoMind 最新的开发日报或开发航线数据。

## When To Use

当用户询问以下内容时使用此 skill：

- "最新日报"、"最近的开发情况"、"项目状态"
- "latest report"、"development status"
- "最新航线"、"开发路线图"
- "P0/P1 有多少"、"天气如何"

## Data Sources

### 优先级顺序

1. **GitHub raw URL**（推荐，适用于任何环境）
   ```bash
   curl -sS https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/reports/latest.json
   ```

2. **本地 devlog 仓库**（如果存在）
   ```bash
   cat ~/A137442/exomind-devlog/reports/latest.json
   ```

3. **通过 manifest.json 查找**
   ```bash
   curl -sS https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/manifest.json \
     | jq -r '.latest.report'
   ```

### 数据格式

```json
{
  "schema": "exomind-devlog-report",
  "version": "1.0",
  "generated": "2026-04-01T15:23:00+08:00",
  "meta": {
    "title": "开发早报",
    "date": "2026-04-01",
    "coverage": "03-31 晚 ~ 04-01 早",
    "baseline": "838f2cf2",
    "repo": "exomind-team/exomind"
  },
  "publisher": { ... },
  "weather": {
    "level": "cloudy",
    "emoji": "⛅",
    "label": "晴转多云",
    "ups": [ ... ],
    "downs": [ ... ],
    "actions": [ ... ]
  },
  "metrics": [ ... ],
  "mainlines": [ ... ],
  "headlines": [ ... ],
  "terrain": { ... },
  "prs": [ ... ],
  "poolHealth": { ... },
  "scorecard": { ... },
  "insight": { ... }
}
```

## Usage Workflow

### 1. 获取最新日报

```bash
# 方式 1: 直接获取（推荐）
LATEST_REPORT=$(curl -sS https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/reports/latest.json)

# 方式 2: 从本地获取（如果 devlog 仓库存在）
if [ -f ~/A137442/exomind-devlog/reports/latest.json ]; then
  LATEST_REPORT=$(cat ~/A137442/exomind-devlog/reports/latest.json)
fi

# 验证数据
echo "$LATEST_REPORT" | jq -e '.schema == "exomind-devlog-report"' > /dev/null
if [ $? -ne 0 ]; then
  echo "❌ 数据格式错误或获取失败"
  exit 1
fi
```

### 2. 提取关键信息

```bash
# 提取摘要
echo "$LATEST_REPORT" | jq -r '
  "📅 \(.meta.date) \(.meta.title)",
  "🌤️ \(.weather.emoji) \(.weather.label)",
  "📊 Open Issues: \(.metrics[0].value) | P0/P1: \(.metrics[1].value)",
  "📰 头条: \(.headlines[0].title)"
'

# 提取天气详情
echo "$LATEST_REPORT" | jq -r '
  "▲ 利好:",
  (.weather.ups[] | "  · \(.)"),
  "",
  "▼ 关注:",
  (.weather.downs[] | "  · \(.)")
'

# 提取建议行动
echo "$LATEST_REPORT" | jq -r '
  "🎯 建议行动:",
  (.weather.actions[] | "  · \(.)")
'
```

### 3. 查询历史报告

```bash
# 获取 manifest
MANIFEST=$(curl -sS https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/manifest.json)

# 列出最近 5 份报告
echo "$MANIFEST" | jq -r '.reports[:5] | .[] | "\(.date) \(.title) - \(.weather.emoji) \(.weather.label)"'

# 按日期查询
DATE="2026-04-01"
REPORT_FILE=$(echo "$MANIFEST" | jq -r ".reports[] | select(.date == \"$DATE\") | .dataFile" | head -1)
if [ -n "$REPORT_FILE" ]; then
  curl -sS "https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/reports/$REPORT_FILE"
fi
```

## Output Formats

### 格式 1: 简要摘要（默认）

```
📅 2026-04-01 开发早报
🌤️ ⛅ 晴转多云
📊 Open Issues: 282 (↓1) | P0/P1: 6/51 (P1 -1)

📰 头条:
  · #780 BlockTransition 全闭环 — 20 commit 完成时间块状态机重构
  · RT SSE 自动通知：EventLog append 后自动触发 watcher

🎯 建议行动:
  · 启动 #466 PR review，解除 22 天锁定
  · 清理 3 个无活动 PR
```

### 格式 2: 完整报告（详细）

包含所有字段的完整 JSON 或格式化 Markdown。

### 格式 3: 特定字段提取

根据用户需求提取特定字段（如只要 P0/P1 数量、只要天气状态等）。

## Integration with Other Skills

### dev-daily

生成报告后验证发布：

```bash
# 生成报告
bun run devlog:publish:v2

# 等待 GitHub Pages 构建（约 30 秒）
sleep 30

# 验证发布成功
LATEST=$(curl -sS https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/reports/latest.json)
LATEST_DATE=$(echo "$LATEST" | jq -r '.meta.date')
TODAY=$(date +%Y-%m-%d)

if [ "$LATEST_DATE" == "$TODAY" ]; then
  echo "✓ 发布成功，最新日报已更新"
else
  echo "⚠️ 发布可能失败，最新日报日期: $LATEST_DATE，预期: $TODAY"
fi
```

### issue-tracking

创建 Issue 前检查重复：

```bash
# 获取最新日报
LATEST=$(curl -sS https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/reports/latest.json)

# 检查是否已在头条中提及
ISSUE_NUM="780"
echo "$LATEST" | jq -e ".headlines[] | select(.body | contains(\"#$ISSUE_NUM\"))" > /dev/null
if [ $? -eq 0 ]; then
  echo "ℹ️ Issue #$ISSUE_NUM 已在最新日报头条中提及"
fi

# 获取当前 P0/P1 数量
P0_COUNT=$(echo "$LATEST" | jq -r '.poolHealth.p0')
P1_COUNT=$(echo "$LATEST" | jq -r '.poolHealth.p1')
echo "当前 P0: $P0_COUNT, P1: $P1_COUNT"
```

## Error Handling

### 网络失败

```bash
LATEST=$(curl -sS --max-time 10 https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/reports/latest.json 2>&1)
if [ $? -ne 0 ]; then
  echo "⚠️ GitHub 获取失败，尝试本地..."
  if [ -f ~/A137442/exomind-devlog/reports/latest.json ]; then
    LATEST=$(cat ~/A137442/exomind-devlog/reports/latest.json)
    echo "✓ 使用本地数据"
  else
    echo "❌ 无法获取数据（网络失败且本地不存在）"
    exit 1
  fi
fi
```

### 数据格式错误

```bash
# 验证 schema
SCHEMA=$(echo "$LATEST" | jq -r '.schema // empty')
if [ "$SCHEMA" != "exomind-devlog-report" ]; then
  echo "❌ 数据格式错误: schema=$SCHEMA"
  exit 1
fi

# 验证必填字段
jq -e '.meta.date and .weather.level and .metrics' <<< "$LATEST" > /dev/null
if [ $? -ne 0 ]; then
  echo "❌ 数据不完整，缺少必填字段"
  exit 1
fi
```

## Examples

### Example 1: 快速查看项目状态

**User**: "最近开发情况如何？"

**Agent**:
```bash
curl -sS https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/reports/latest.json \
  | jq -r '"📅 \(.meta.date) \(.meta.title)\n🌤️ \(.weather.emoji) \(.weather.label)\n📊 Open Issues: \(.metrics[0].value) | P0/P1: \(.metrics[1].value)"'
```

**Output**:
```
📅 2026-04-01 开发早报
🌤️ ⛅ 晴转多云
📊 Open Issues: 282 | P0/P1: 6/51
```

### Example 2: 获取建议行动

**User**: "下一步应该做什么？"

**Agent**:
```bash
curl -sS https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/reports/latest.json \
  | jq -r '"🎯 建议行动:", (.weather.actions[] | "  · \(.)")'
```

### Example 3: 查询历史趋势

**User**: "最近一周 P0 数量变化？"

**Agent**:
```bash
curl -sS https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/manifest.json \
  | jq -r '.reports[:7] | reverse | .[] | "\(.date): P0=\(.metrics[1].value | split("/")[0])"'
```

## Notes

- 数据更新延迟：GitHub Pages 构建需要 30-60 秒，发布后立即查询可能获取到旧数据
- 缓存策略：GitHub raw URL 有 5 分钟缓存，频繁查询可能获取到缓存数据
- 本地优先：如果本地 devlog 仓库存在且是最新的，优先使用本地数据（速度更快）
- Schema 版本：当前 schema 版本为 1.0，未来可能升级，需要检查 `version` 字段
