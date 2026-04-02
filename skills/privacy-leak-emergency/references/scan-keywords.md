# 扩展扫描关键词库

处置已知泄露后，用本关键词库排查关联隐私风险。

---

## 高优先级：真实人物标识（L1）

直接指向真实人物，误报率低，命中即需处理。

```
老师、导师
同学、师兄、师姐、师弟、师妹
朋友、同事
家人、家里、爸爸、妈妈、父母、兄弟、姐妹
[姓氏+称谓组合，如「黎老师」「张同学」「李导师」]
```

**搜索方式**：
```bash
for kw in "老师" "同学" "师兄" "师姐" "家人" "导师"; do
  result=$(gh search issues --repo <owner>/<repo> "$kw" --json number,title 2>&1)
  [ "$result" != "[]" ] && echo "[$kw] $result"
done
```

---

## 中优先级：个人行程标识（L2）

指向具体个人活动，需结合语境确认。

```
医院、体检（作为个人行程，非产品功能示例）
约好、见面、约会
周末计划、[具体日期]+个人活动描述
今晚去、明天下午、后天上午（带方向词的具体安排）
```

**判断示例**：
- 「下周二下午去医院复诊」→ 🔴 个人信息
- 「用外心追踪体检时间块」→ ✅ 产品功能描述

---

## 低优先级：需结合上下文判断（L3/噪音）

单独出现时误报率高，需人工确认语境。

```
今天、明天、昨天、后天  →  最常见于产品功能描述
生日、体检              →  ExoMind 等生活类 app 大量用作功能示例
家（单字）              →  「大家」「架构」「在家」等含义差异大
师（单字）              →  「老师」「架构师」「工程师」含义差异大
```

**快速过滤规则**——以下模式视为产品上下文，无需处理：
- 「用户可以/能够 + [关键词]」
- 「追踪/记录/提醒 + [关键词]」
- 「任务示例：+ [关键词]」
- issue 标题为 `feat/design/research/epic` 类型时，正文中的关键词多为功能描述

---

## 针对 devlog / GitHub Pages 的专项扫描

开发日志类仓库（如 ExoMind 的 `exomind-devlog`）会自动同步 issue 标题到路线图和日报文件，是最常见的下游泄露渠道。

**本地批量扫描**（适用于已 clone 的仓库）：
```bash
cd /path/to/devlog-repo
for kw in "老师" "同学" "周末计划" "约好" "见面"; do
  result=$(git grep -l "$kw" -- "*.json" "*.html" 2>/dev/null)
  [ -n "$result" ] && echo "[$kw] $result"
done
```

**远程逐文件扫描**（适用于未 clone 的仓库，速度较慢）：
```bash
# 获取文件列表后逐一检查
paths=$(gh api "repos/<owner>/<repo>/git/trees/HEAD?recursive=1" \
  --jq '.tree[] | select(.path | (endswith(".json") or endswith(".html"))) | .path')
for path in $paths; do
  content=$(gh api "repos/<owner>/<repo>/contents/$path" \
    --jq '.content' 2>/dev/null | base64 -d 2>/dev/null)
  for kw in "老师" "同学" "周末计划"; do
    echo "$content" | grep -q "$kw" \
      && echo "[$kw] === $path ===" && echo "$content" | grep "$kw"
  done
done
```

---

## 扫描结果记录模板

```markdown
### 扩展扫描结果 - YYYY-MM-DD

| 关键词 | 库 | 命中数 | 语境类型 | 结论 |
|--------|-----|--------|----------|------|
| 老师 | exomind | 0 | — | ✅ 无残留 |
| 同学 | exomind | 30 | 产品功能描述 | ✅ 无个人信息 |
| 体检 | exomind | 15 | 产品 use case | ✅ 无个人信息 |
| 周末计划 | exomind-devlog | 3 | issue 标题同步 | 🔴 需处理（见 #521） |
```
