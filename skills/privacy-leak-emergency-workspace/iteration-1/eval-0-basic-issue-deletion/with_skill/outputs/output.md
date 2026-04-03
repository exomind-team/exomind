# 隐私泄露处置方案：exomind-team/exomind #762

**处置日期**：2026-04-02
**泄露对象**：issue #762 中包含用户导师真实姓名
**敏感等级**：L1（真实人名）— 优先级 P0，立即处置

---

## 一、暴露面分析

单纯删除 issue 只清除了前端，以下渠道均可能持有副本，必须逐一核查：

| # | 渠道 | 持续时长 | 是否可主动消除 | 说明 |
|---|------|----------|----------------|------|
| 1 | **Issue #762 正文 / 标题** | 直到删除 | ✅ 可删除 | 先混淆为 `?` 再删除，让爬虫抓到无意义内容 |
| 2 | **Issue 编辑历史** | 随 issue 删除一并消失 | ✅（删 issue 即可） | 删除前编辑历史对所有人可见，务必先混淆 |
| 3 | **GitHub Events API** | **30 天** | ❌ 无法主动清除 | issue 创建事件含原始标题，混淆无效 |
| 4 | **Git 历史（代码文件中出现过）** | 至 force push 后约 90 天 GC | ❌ 需联系 GitHub Support | 如果 devlog/routes 文件包含 issue 标题，则 commit 历史残留 |
| 5 | **devlog 下游仓库（GitHub Pages）** | 持续存在 | ✅ 可 filter-repo 清除 | ExoMind devlog 系统会将 issue 标题同步到 JSON/HTML 路线图 |
| 6 | **组织内其他公开仓库** | 持续存在 | ✅ 可清除 | 其他仓库可能在报告或文档中引用了 issue 标题 |
| 7 | **Wayback Machine 等网络存档** | 永久 | 需提交移除请求 | 小仓库自动抓取概率低，但不能排除 |
| 8 | **已接收的邮件通知** | 永久 | ❌ 无法撤回 | 仓库关注者在 issue 创建时已收到推送，无法追回 |
| 9 | **外部搜索引擎缓存** | 数天～数月 | 可向 Google/Bing 申请 | 取决于搜索引擎是否索引了 GitHub issue 页面 |

**结论**：必须执行第二、三阶段完整流程，不能只删 issue。

---

## 二、威胁模型评估

### 2.1 为什么「直接删除 issue」不够

```
时间线示意：
[issue 创建] ──────────────────────────── [删除]
    │                                        │
    └─→ Events API 记录原始标题（30天）       │
    └─→ devlog 系统同步 issue 标题到 JSON     │
    └─→ 外部爬虫可能已抓取 issue 页面         │
    └─→ Git commit 中若有引用，悬空90天       ┘
```

直接删除对 GitHub 内部存储没有影响——原始内容仍在事件流中。「混淆后删除」的价值在于：若外部爬虫在混淆窗口内抓取，得到的是 `?` 而非真实姓名。

### 2.2 Force Push 残留机制

```
before force push:  main → C3 → C2(含姓名) → C1
after  force push:  main → C3' → C2'(已替换) → C1'
                           C3 → C2(含姓名) → C1  ← 悬空对象，旧 SHA 仍可访问
```

攻击者若从 Events API 获取了旧 commit SHA，可在 GC 前通过以下 URL 直接访问：
`https://github.com/exomind-team/exomind/commit/<old-sha>`

**完全消除悬空对象的唯一途径**：联系 GitHub Support 请求立即 GC。

### 2.3 实际风险评级（针对本次事件）

| 风险项 | 实际概率 | 理由 |
|--------|----------|------|
| Events API 泄露扩散 | 低 | 需要知道仓库地址并主动查询，且30天后自动过期 |
| devlog 下游持久暴露 | **高** | ExoMind devlog 系统明确会同步 issue 标题 |
| 搜索引擎索引 | 中 | GitHub public issue 可被 Google 索引 |
| 邮件通知扩散 | 取决于关注者数量 | 一旦发送无法撤回，但关注者通常是可信的开发者 |
| 恶意存档 | 极低 | 针对性攻击的概率对小型开发项目极低 |

---

## 三、完整处置步骤

> **约束说明**：以下命令为标准操作规程，供执行时参照。本文档不实际执行任何命令。

### 阶段一：全面定位（执行前必须完成）

**1.1 确认 issue #762 的完整内容**

```bash
# 查看 issue 完整内容，记录所有含敏感信息的字段
gh issue view 762 --repo exomind-team/exomind --json title,body,comments
```

**1.2 搜索主库 issues 是否有其他相关泄露**

```bash
# 以导师姓名为关键词搜索（假设关键词为 $KEYWORD，执行时替换为真实姓名）
gh search issues --repo exomind-team/exomind "$KEYWORD" --json number,title

# 同时用通用角色词搜索
for kw in "导师" "老师" "师兄" "师姐"; do
  result=$(gh search issues --repo exomind-team/exomind "$kw" --json number,title 2>&1)
  [ "$result" != "[]" ] && echo "[$kw] $result"
done
```

**1.3 搜索主库代码文件**

```bash
gh search code --repo exomind-team/exomind "$KEYWORD"
```

**1.4 扫描 devlog 下游仓库**

ExoMind 的 devlog 系统（`publish-devlog.ts`、`publish-route.ts`）会将 issue 标题同步到 JSON/HTML 文件，必须检查：

```bash
# 获取 devlog 仓库所有 JSON/HTML 文件（需先确认 devlog 仓库名称）
gh api "repos/exomind-team/exomind-devlog/git/trees/HEAD?recursive=1" \
  --jq '.tree[] | select(.path | (endswith(".json") or endswith(".html"))) | .path'

# 逐文件检查内容
for path in $(上述输出); do
  content=$(gh api "repos/exomind-team/exomind-devlog/contents/$path" \
    --jq '.content' 2>/dev/null | base64 -d 2>/dev/null)
  echo "$content" | grep -q "$KEYWORD" \
    && echo "=== 命中: $path ===" && echo "$content" | grep "$KEYWORD"
done
```

**1.5 检查主库本地 Git 历史**

```bash
cd /path/to/exomind  # 替换为本地仓库路径
git log --oneline --all -S "$KEYWORD"   # 找含敏感词的 commit
git grep "$KEYWORD"                      # 当前工作区搜索
```

**1.6 检查 Events API（记录现状，无法清除）**

```bash
gh api "repos/exomind-team/exomind/events?per_page=100" \
  --jq '.[] | select(.type=="IssuesEvent") |
    {action: .payload.action, number: .payload.issue.number,
     title: .payload.issue.title, created_at: .created_at}' \
  | grep -A4 '"762"'
```

---

### 阶段二：清除 Issue #762

**2.1 混淆 issue（关键步骤，不可跳过）**

```bash
# 混淆标题和正文，让潜在爬虫抓到无意义内容
gh issue edit 762 --repo exomind-team/exomind --title "?" --body "?"
```

**2.2 确认混淆成功**

```bash
gh issue view 762 --repo exomind-team/exomind --json title,body
# 期望输出：{"title":"?","body":"?"}
```

**2.3 若 issue 有评论，逐条混淆含敏感信息的评论**

```bash
# 查看所有评论
gh issue view 762 --repo exomind-team/exomind --json comments --jq '.comments[] | {id:.id, body:.body}'

# 对含敏感信息的评论逐条混淆（使用 REST API）
gh api -X PATCH "repos/exomind-team/exomind/issues/comments/<COMMENT_ID>" \
  -f body="?"
```

**2.4 删除 issue**

```bash
gh issue delete 762 --repo exomind-team/exomind --yes
```

**2.5 验证删除成功（应返回 404 错误）**

```bash
gh issue view 762 --repo exomind-team/exomind
# 期望：返回错误 "issue not found" 或 GraphQL 错误
```

---

### 阶段三：清除 Git 历史（如定位阶段发现含敏感词的 commit）

> 仅在阶段一步骤 1.5 发现 Git 历史中存在敏感词时执行本阶段。

**3.1 创建替换规则文件**

```bash
# 规则格式：原文==>替换文本
# 替换文本需保留技术/业务语义，只去除人名
cat > /tmp/rules.txt << 'EOF'
<导师真实姓名>==>导师
<姓氏+老师>==>研究顾问
EOF
# 注意：执行时将 <> 占位符替换为真实内容
```

**3.2 在主库执行 filter-repo**

```bash
cd /path/to/exomind
git filter-repo --replace-text /tmp/rules.txt --force

# filter-repo 执行后会自动移除 remote，需重新添加
git remote add origin https://github.com/exomind-team/exomind.git
```

**3.3 本地验证（两条命令均应无输出）**

```bash
git log --oneline --all -S "<敏感原文>"
git grep "<敏感原文>"
# 均无输出 = 本地已清洁
```

**3.4 Force push 到远端**

```bash
git push --force origin dev
git push --force origin main
# 注意：需要对所有含旧历史的分支执行 force push
```

**3.5 通知 GitHub Support 立即 GC（推荐）**

访问 [GitHub Privacy Request](https://support.github.com/contact/privacy)，说明：
- 仓库：`exomind-team/exomind`
- 原因：不慎在 issue 和 Git 历史中暴露了真实人名（PII）
- 请求：立即清除悬空对象，不等待 90 天 GC

---

### 阶段四：清除 devlog 下游（如定位阶段发现命中）

> 仅在阶段一步骤 1.4 发现 devlog 仓库中含敏感词时执行。

**4.1 在 devlog 仓库本地执行 filter-repo**

```bash
cd /path/to/exomind-devlog  # 替换为 devlog 仓库本地路径

cat > /tmp/rules-devlog.txt << 'EOF'
<含敏感词的完整字符串>==>隐私内容已处置
EOF

git filter-repo --replace-text /tmp/rules-devlog.txt --force
git remote add origin https://github.com/exomind-team/exomind-devlog.git
```

**4.2 本地验证**

```bash
git log --oneline --all -S "<敏感原文>"
git grep "<敏感原文>" -- "*.json" "*.html"
```

**4.3 Force push devlog 仓库**

```bash
git push --force origin main
git push --force origin gh-pages  # 若存在 gh-pages 分支
```

**4.4 远端验证**

```bash
# 通过 GitHub API 直接检查远端文件内容
gh api "repos/exomind-team/exomind-devlog/contents/<可疑文件路径>" \
  --jq '.content' | base64 -d | grep "<敏感原文>"
# 无输出 = 清洁
```

---

### 阶段五：扩展扫描

处置完成后，以「导师姓名」为核心扩展排查，避免遗漏关联泄露：

```bash
# 检查是否有其他角色词泄露
for kw in "导师" "老师" "师兄" "师姐" "师弟" "师妹" "同学"; do
  result=$(gh search issues --repo exomind-team/exomind "$kw" --json number,title 2>&1)
  [ "$result" != "[]" ] && echo "[$kw] $result"
done

# 检查个人日程类关键词
for kw in "约好" "见面" "周末计划" "今晚" "明天下午"; do
  result=$(gh search issues --repo exomind-team/exomind "$kw" --json number,title 2>&1)
  [ "$result" != "[]" ] && echo "[$kw] $result"
done
```

---

### 阶段六：双盲验证

**路径 A（本地 Git）**

```bash
cd /path/to/exomind
git log --oneline --all -S "<敏感原文>"   # 期望：无输出
git grep "<敏感原文>"                      # 期望：无输出

cd /path/to/exomind-devlog
git log --oneline --all -S "<敏感原文>"   # 期望：无输出
git grep "<敏感原文>"                      # 期望：无输出
```

**路径 B（远程 API）**

```bash
# 确认 issue 已删除
gh issue view 762 --repo exomind-team/exomind  # 期望：404

# 确认代码搜索无结果
gh search code --repo exomind-team/exomind "<敏感原文>"  # 期望：空结果

# 确认 devlog 文件内容干净
# （参见阶段四步骤 4.4）
```

---

## 四、标准清除报告（处置后填写）

```markdown
## 隐私泄露处置报告 - 2026-04-02

**泄露内容**：issue #762 标题/正文中包含用户导师真实姓名
**敏感等级**：L1（真实人名）

### 暴露面清单

| 位置 | 内容描述 | 处置结果 |
|------|----------|----------|
| exomind-team/exomind #762 | issue 标题/正文含导师姓名 | ✅ 已混淆后删除 |
| devlog 下游 JSON/HTML | issue 标题同步文件 | [待确认] |
| Git 历史 | 代码文件中是否出现 | [待确认] |
| Events API | issue 创建事件（原始标题） | 🟠 30天窗口，无法主动清除 |
| 悬空 Git 对象 | force push 后旧 SHA | 🟠 ~90天 GC 窗口，已联系 Support |

### 验证结果

| 验证项 | 结果 |
|--------|------|
| 本地 `git log -S` | [待填写] |
| 本地 `git grep` | [待填写] |
| 远程 API issue 检查 | [待填写] |
| 远程 API 代码搜索 | [待填写] |
| devlog 文件内容检查 | [待填写] |
| Events API | 🟠 仍在30天窗口，原始标题已记录在事件流中 |

### 注意事项

1. **邮件通知不可撤回**：仓库关注者在 issue #762 创建时已收到含导师姓名的推送邮件，无法撤回。
2. **Events API 30天残留**：issue 创建事件在 Events API 中保留 30 天，此后自动过期。
3. **悬空对象**：若执行了 filter-repo + force push，旧 commit 对象在 GitHub 完成 GC 前仍可通过旧 SHA 访问。建议通过 GitHub Privacy Request 申请立即处理。
4. **搜索引擎缓存**：若 issue 页面已被搜索引擎索引，缓存可能在数周内仍可访问，可向 Google Search Console 提交移除请求。
```

---

## 五、后续预防建议

1. **issue 模板过滤**：在 `.github/ISSUE_TEMPLATE/` 中添加提醒，禁止在 issue 中填写真实人名。
2. **devlog 发布前审查**：`publish-devlog.ts` 发布前增加关键词扫描钩子，命中「老师、同学、导师」等词时阻止发布并提示。
3. **仓库 Watch 管控**：减少不必要的仓库 Watch 订阅，降低邮件通知的扩散范围。
4. **定期扫描**：参考 `scan-keywords.md` 中的关键词库，定期（每月一次）对组织内所有公开仓库执行扫描。
