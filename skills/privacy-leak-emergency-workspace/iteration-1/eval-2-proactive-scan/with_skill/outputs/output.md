# exomind-team/exomind 隐私泄露主动排查方案

> 场景：仓库由私有转为公开，尚无已知泄露点，需要全面扫描是否存在真实人名、个人日程等敏感信息。
> 约束：本方案为纯计划文档，不包含任何实际执行的 gh / git 命令。

---

## 一、扫描目标与范围

### 扫描对象

| 渠道 | 说明 |
|------|------|
| Issues / PR 正文与评论 | 最常见的无意间输入个人信息的地方 |
| 代码库文件（*.ts, *.rs, *.md, *.json, *.toml, *.txt） | 文档、配置、测试用例中的示例数据 |
| Git 提交历史（commit message + diff） | 临时调试代码、注释中遗留的个人内容 |
| 下游 devlog 仓库（exomind-devlog / GitHub Pages） | issue 标题会自动同步到路线图和日报 JSON/HTML |
| 组织下其他公开仓库 | 统一排查，避免遗漏 |

---

## 二、敏感信息分级

| 等级 | 类型 | 示例 | 处置优先级 |
|------|------|------|-----------|
| **L1** | 真实人名（含称谓） | 「黎老师」「张同学」「某某导师」 | P0 立即 |
| **L2** | 个人日程 / 约定 | 「周末3/15去医院」「约了朋友见面」 | P0 立即 |
| **L3** | 内部战略 / 商业信息 | 融资规划、用户访谈原文、竞品分析 | P1 当天 |
| **L4** | 技术内部细节 | 未公开架构图、内部服务地址 | P2 按需 |

---

## 三、关键词体系

### 3.1 L1 高优先级：真实人物标识（误报率低）

```
老师、导师
同学、师兄、师姐、师弟、师妹
朋友、同事
家人、家里、爸爸、妈妈、父母、兄弟、姐妹
[姓氏+称谓组合，如「黎老师」「张同学」「王导师」]
```

**原则**：这些词单独出现即需人工确认，无需额外语境。

### 3.2 L2 中优先级：个人行程标识（需结合上下文）

```
医院、体检（作为个人行程）
约好、见面、约会
周末计划、今晚去、明天下午、后天上午
[具体日期] + 个人活动描述（如「3/15 下午」「4月1号」）
```

### 3.3 L3 低优先级 / 噪音词（误报率高，需人工确认）

```
今天、明天、昨天、后天
生日、体检（单独出现）
家（单字）
师（单字）
```

---

## 四、产品上下文 vs. 真实个人信息 —— 区分规则

ExoMind 是生活管理类应用，大量功能描述本身就包含「医院」「体检」「提醒」等词汇，需要明确区分。

### 快速过滤：以下模式视为**产品上下文**，无需处理

| 模式 | 示例 | 结论 |
|------|------|------|
| 「用户可以/能够 + [关键词]」 | 「用户可以记录体检日期」 | ✅ 产品功能 |
| 「追踪/记录/提醒 + [关键词]」 | 「提醒功能支持追踪医院复诊」 | ✅ 产品功能 |
| 「任务示例：+ [关键词]」 | 「任务示例：明天下午开会」 | ✅ 示例数据 |
| issue 标题类型为 feat/design/research/epic | `feat: 支持体检时间块` | ✅ 功能 issue |
| 文档中的 use case 描述 | 「Alice 需要记录家人的生日」 | ✅ 产品文档 |

### 需要处理：以下模式视为**真实个人信息**

| 模式 | 示例 | 结论 |
|------|------|------|
| 第一人称 + 具体行程 | 「我下周二要去医院复诊」 | 🔴 个人信息 |
| 真实人名（含姓氏+称谓） | 「和黎老师讨论了这个问题」 | 🔴 个人信息 |
| 具体日期 + 非泛化活动 | 「3/15-16 周末计划：去见朋友」 | 🔴 个人信息 |
| issue 正文中含真实联系人 | 「请问过张同学，他说...」 | 🔴 个人信息 |
| commit message 含私人备注 | `fix: 临时方案，等黎老师回来再改` | 🔴 个人信息 |

---

## 五、扫描命令（分阶段）

> 注意：以下命令仅作为方案呈现，本次不实际执行。

### 阶段 A：Issues / PR 搜索

```bash
# L1 关键词批量搜索
for kw in "老师" "同学" "师兄" "师姐" "导师" "朋友" "家人" "爸爸" "妈妈" "父母"; do
  result=$(gh search issues --repo exomind-team/exomind "$kw" --json number,title 2>&1)
  [ "$result" != "[]" ] && echo "[$kw] $result"
done

# L2 关键词搜索
for kw in "约好" "见面" "约会" "周末计划" "今晚去" "明天下午" "医院复诊"; do
  result=$(gh search issues --repo exomind-team/exomind "$kw" --json number,title 2>&1)
  [ "$result" != "[]" ] && echo "[$kw] $result"
done

# 搜索 PR（同样可能含私人信息）
for kw in "老师" "同学" "朋友"; do
  gh search prs --repo exomind-team/exomind "$kw" --json number,title
done
```

### 阶段 B：代码库文件搜索

```bash
# 搜索代码内容（覆盖 ts/rs/md/json/toml/txt）
for kw in "老师" "同学" "导师" "朋友" "家人" "医院" "周末计划"; do
  gh search code --repo exomind-team/exomind "$kw"
done
```

### 阶段 C：Git 历史搜索（本地 clone 后执行）

```bash
cd /path/to/exomind

# 搜索 commit message
git log --oneline --all --grep="老师"
git log --oneline --all --grep="同学"
git log --oneline --all --grep="朋友"
git log --oneline --all --grep="导师"

# 搜索 commit diff 内容（含已删除行）
git log --oneline --all -S "老师"
git log --oneline --all -S "同学"
git log --oneline --all -S "周末计划"
git log --oneline --all -S "约好"

# 搜索当前工作区
git grep "老师"
git grep "同学"
git grep "导师"
```

### 阶段 D：下游 devlog / GitHub Pages 扫描

```bash
# 获取 devlog 仓库的所有 JSON/HTML 文件列表
gh api "repos/exomind-team/exomind-devlog/git/trees/HEAD?recursive=1" \
  --jq '.tree[] | select(.path | (endswith(".json") or endswith(".html"))) | .path'

# 逐文件检查关键词（本地版本）
cd /path/to/exomind-devlog
for kw in "老师" "同学" "周末计划" "约好" "见面" "导师"; do
  result=$(git grep -l "$kw" -- "*.json" "*.html" 2>/dev/null)
  [ -n "$result" ] && echo "[$kw] $result"
done
```

### 阶段 E：组织内所有公开库统一排查

```bash
# 列出 exomind-team 下所有公开仓库
for repo in $(gh repo list exomind-team --json name,isPrivate \
  --jq '.[] | select(.isPrivate==false) | .name'); do
  echo "--- 扫描 $repo ---"
  for kw in "老师" "同学" "朋友" "导师" "周末计划"; do
    result=$(gh search code --repo "exomind-team/$repo" "$kw" 2>&1)
    [ -z "$result" ] || [ "$result" = "[]" ] \
      || echo "⚠️  [$kw] 命中 $repo: $result"
  done
done
```

---

## 六、Events API 窗口检查

即使 issue 已删除，创建时的原始标题在 30 天内仍可通过 Events API 查到：

```bash
# 查看最近 100 条 Issues 事件（含已删除 issue 的原始标题）
gh api "repos/exomind-team/exomind/events?per_page=100" \
  --jq '.[] | select(.type=="IssuesEvent") |
    {action: .payload.action, number: .payload.issue.number,
     title: .payload.issue.title, created_at: .created_at}'
```

**判断逻辑**：若仓库由私有转公开的时间在 30 天内，Events API 可能记录了转公开前创建的 issue 的原始标题。若 30 天已过，Events API 窗口已过期，此渠道无需处理。

---

## 七、扫描结果记录模板

```markdown
### 主动扫描结果 - YYYY-MM-DD

| 关键词 | 渠道 | 命中数 | 语境类型 | 结论 |
|--------|------|--------|----------|------|
| 老师 | issues | 0 | — | ✅ 无残留 |
| 同学 | issues | 2 | 产品功能描述 | ✅ 无个人信息 |
| 体检 | code | 15 | 产品 use case | ✅ 无个人信息 |
| 周末计划 | devlog JSON | 1 | issue 标题同步 | 🔴 需处理（见 #xxx） |
| 导师 | git history | 1 | commit message | 🔴 需处理（commit abc123） |
```

---

## 八、发现问题后的处置链路

若扫描中发现真实个人信息，按以下顺序处置（不实际执行，仅作方案说明）：

### Issue / PR 处置

1. **混淆**：将 title 和 body 替换为 `?`，让爬虫抓到无意义内容
2. **删除**：执行删除操作
3. **验证**：确认 API 返回 404

### Git 历史处置

1. 创建 `git-filter-repo` 替换规则文件，格式：`敏感原文==>替换后文本`
2. 替换文本须保留技术语义，只去除人名/日期
3. 执行 filter-repo 重写历史
4. 本地双验证（`git log -S` + `git grep`），两条命令均无输出才继续
5. Force push
6. 检查是否需要联系 GitHub Support 请求立即 GC（若泄露涉及真实姓名+联系方式组合）

### 下游 devlog 处置

- 定位含敏感词的 JSON/HTML 文件
- 同样使用 filter-repo 重写 devlog 仓库历史
- 验证 GitHub Pages 重新部署后内容已更新

---

## 九、风险残留说明

| 渠道 | 可否主动消除 | 残留窗口 | 建议 |
|------|-------------|----------|------|
| Issues / PR 正文 | ✅ 可删除 | 删后立即消除 | 先混淆再删除 |
| Git 悬空对象（force push 后） | ❌ 需联系 GitHub Support | ~90 天 GC 前 | 涉及 PII 时联系 Support |
| Events API（issue 创建事件） | ❌ 无法主动清除 | 30 天 | 评估转公开时间，若超 30 天无需处理 |
| 已收到邮件通知的关注者 | ❌ 无法撤回 | 永久 | 若仓库转公开前关注者极少，实际风险有限 |
| 外部搜索引擎缓存 | 可申请移除 | 数天~数月 | 小仓库被抓取概率低，可观察后决定 |

---

## 十、优先扫描顺序建议

1. **Issues 搜索**（速度最快，最可能命中）
2. **Git commit message 搜索**（commit -S 搜索历史 diff）
3. **代码文件搜索**（尤其是 docs/, tests/ 目录中的示例数据）
4. **devlog 下游仓库扫描**（issue 标题同步是最常见的隐性泄露路径）
5. **Events API 时间窗口检查**（评估转公开时间是否在 30 天内）
