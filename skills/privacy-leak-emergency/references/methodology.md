# 隐私泄露应急：五阶段方法论

---

## 第一阶段：定性分级

判断敏感等级，决定处置优先级：

| 等级 | 类型 | 示例 | 优先级 |
|------|------|------|--------|
| **L1** | 真实人名 | 老师/朋友/同事姓名 | P0 立即 |
| **L2** | 个人日程 | 「周末3/15-16计划」「约了某人见面」 | P0 立即 |
| **L3** | 内部战略 | 商业分析、项目内部评估文档 | P1 当天 |
| **L4** | 技术内部信息 | 未公开架构细节、内部 commit hash | P2 按需 |

---

## 第二阶段：全面定位

**不能只看泄露源头**——相同内容可能已同步到 devlog、GitHub Pages、其他仓库。

### 搜索主库 issues 和代码

```bash
gh search issues --repo <owner>/<repo> "<关键词>" --json number,title
gh search code --repo <owner>/<repo> "<关键词>"
```

### 搜索组织内所有公开库

```bash
for repo in $(gh repo list <org> --json name,isPrivate \
  --jq '.[] | select(.isPrivate==false) | .name'); do
  result=$(gh search code --repo "<org>/$repo" "<关键词>" 2>&1)
  [ -z "$result" ] || [ "$result" = "[]" ] \
    && echo "✅ $repo: 无" || echo "⚠️  $repo: $result"
done
```

注意：`gh search code` 有 API rate limit，批量搜索时如遇 403 需等待 30 秒后重试。

### 扫描下游系统（devlog / GitHub Pages）

```bash
# 获取仓库所有 JSON/HTML 文件路径
gh api "repos/<owner>/<repo>/git/trees/HEAD?recursive=1" \
  --jq '.tree[] | select(.path | (endswith(".json") or endswith(".html"))) | .path'

# 批量检查内容（建议用后台任务以避免超时）
for path in $(上述输出); do
  content=$(gh api "repos/<owner>/<repo>/contents/$path" \
    --jq '.content' 2>/dev/null | base64 -d 2>/dev/null)
  echo "$content" | grep -q "<关键词>" \
    && echo "=== $path ===" && echo "$content" | grep "<关键词>"
done
```

### 检查本地 Git 历史

```bash
cd /path/to/repo
git log --oneline --all -S "<关键词>"   # 找含该词的 commit
git grep "<关键词>"                     # 当前工作区搜索
```

### 检查 Events API（30 天窗口）

```bash
gh api "repos/<owner>/<repo>/events?per_page=100" \
  --jq '.[] | select(.type=="IssuesEvent") |
    {action: .payload.action, number: .payload.issue.number,
     title: .payload.issue.title, created_at: .created_at}'
```

---

## 第三阶段：系统清除

### Issue / PR 清除

**流程：混淆 → 确认 → 删除 → 验证**

```bash
# 1. 混淆（让缓存抓到无意义内容而非原文）
gh issue edit <N> --repo <owner>/<repo> --title "?" --body "?"

# 2. 确认混淆成功
gh issue view <N> --repo <owner>/<repo> --json title,body

# 3. 删除
gh issue delete <N> --repo <owner>/<repo> --yes

# 4. 验证（应返回 GraphQL 错误，即 404）
gh issue view <N> --repo <owner>/<repo>
```

若 issue 有评论，评论内容也需逐条检查是否含敏感信息。

### Git 历史重写（文件内容）

适用场景：敏感词在文件内容中，已推送到 GitHub 远端。

```bash
# 安装（首次）
pip install git-filter-repo

# 创建替换规则文件
# 格式：敏感原文==>替换后文本
# 必须覆盖所有变体（缩写、不同措辞）
cat > /tmp/rules.txt << 'EOF'
与黎老师交流数学/法律领域的 NARS 翻译问题并沉淀术语结论==>NARS 术语翻译问题研究与沉淀
与黎老师交流 NARS 翻译问题并沉淀术语结论==>NARS 术语翻译问题研究与沉淀
周末计划 3/15-16==>移动端开发计划
EOF

# 在目标仓库根目录执行
cd /path/to/repo
git filter-repo --replace-text /tmp/rules.txt --force
# ⚠️ filter-repo 执行后会自动移除 remote，需重新添加：
git remote add origin https://github.com/<owner>/<repo>.git

# 本地验证（两条命令均应无输出）
git log --oneline --all -S "<敏感原文>"
git grep "<敏感原文>"

# Force push
git push --force origin main
```

**替换文本原则**：
- ✅ 保留技术/业务语义，仅去除人名和具体日期
- ✅ 不使用空字符串（会破坏 JSON/HTML 结构）
- ✅ 同时覆盖所有已知变体

### 远程验证

```bash
# 通过 GitHub API 直接检查远端文件内容
gh api "repos/<owner>/<repo>/contents/<path>" \
  --jq '.content' | base64 -d | grep "<关键词>"
# 无输出 = 清洁
```

---

## 第四阶段：扩展扫描

见 `scan-keywords.md` 获取完整关键词库和过滤规则。

扩展扫描的目标：以已处理的泄露为中心，向外排查是否存在关联的其他隐私信息，避免「处理了一处、遗漏了相关的」。

---

## 第五阶段：双盲验证与报告

### 双盲验证

用两条独立路径各搜索一遍，结果一致才可确认清洁：

**路径 A（本地）**：
```bash
git log --oneline --all -S "<关键词>"
git grep "<关键词>"
```

**路径 B（远程）**：
```bash
gh search issues/code + API 文件内容逐一检查
```

### 标准清除报告

```markdown
## 隐私泄露处置报告 - YYYY-MM-DD

**泄露内容**：[描述]
**敏感等级**：L[1-4]

### 暴露面清单

| 位置 | 内容片段 | 处置结果 |
|------|----------|----------|
| repo/issues#N | 「...」 | ✅ 已混淆删除 |
| devlog/routes/latest.json | title 字段含人名 | ✅ filter-repo 已清除 |
| Git 历史 commit abc123 | 同上 | 🟠 悬空对象，~90天窗口 |

### 验证结果

| 验证项 | 结果 |
|--------|------|
| 本地 `git log -S` | ✅ 无残留 |
| 本地 `git grep` | ✅ 无残留 |
| 远程 API 文件内容检查 | ✅ 无残留 |
| Events API | ✅ 已过30天 / ⚠️ 仍在窗口（原始标题已记录在事件流中） |

### 注意事项
[如有未能完全消除的残留，在此说明原因和剩余风险]
```
