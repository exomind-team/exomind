# exomind-team/exomind 仓库隐私泄露扫描计划

> 适用场景：仓库由私有转为公开后，系统性排查是否有真实姓名、个人日程、内部策略等隐私信息被意外暴露。
>
> 本文档仅提供命令模板，**请在本地或授权环境中自行执行**，不会直接操作任何远程仓库。

---

## 目录

1. [扫描范围概述](#1-扫描范围概述)
2. [阶段一：GitHub Issues & PR 扫描](#2-阶段一github-issues--pr-扫描)
3. [阶段二：代码文件扫描](#3-阶段二代码文件扫描)
4. [阶段三：Git 历史扫描](#4-阶段三git-历史扫描)
5. [阶段四：开发日志 / devlog 扫描](#5-阶段四开发日志--devlog-扫描)
6. [阶段五：发现泄露后的应急处置](#6-阶段五发现泄露后的应急处置)
7. [扫描关键词参考清单](#7-扫描关键词参考清单)

---

## 1. 扫描范围概述

### 1.1 风险面分析

| 风险面 | 说明 | 优先级 |
|--------|------|--------|
| GitHub Issues / PRs | 评论中可能含真实姓名、内部讨论、日程安排 | P0（最高） |
| Git 提交历史 | commit message 或 diff 中可能含敏感上下文 | P0 |
| 代码源文件 | 硬编码的姓名、邮箱、电话、API Key、内部 URL | P0 |
| 开发日志 / devlog | docs/memory/logs.md、GitHub Pages 发布内容 | P1 |
| README / 文档 | 联系方式、真实身份、内部架构细节 | P1 |
| GitHub Pages | 已发布的静态站点可被 Google Cache | P1 |
| Release Assets | 二进制中嵌入的 debug 信息 | P2 |

### 1.2 本次扫描目标关键词类别

- **真实姓名**：中文姓名（2-4 汉字）、英文全名（First Last）
- **联系方式**：手机号、邮箱地址、微信号
- **个人日程**：日期 + 具体时间段的组合（如"周三下午开会"）
- **内部策略**：竞争对手分析、融资信息、薪资数据、OKR
- **凭证信息**：API Key、Token、密码、数据库连接串

---

## 2. 阶段一：GitHub Issues & PR 扫描

### 2.1 列举所有 Issues 和 PR

```bash
# 列出所有 open Issues（含标题和正文预览）
gh issue list \
  --repo exomind-team/exomind \
  --state all \
  --limit 500 \
  --json number,title,author,body,createdAt \
  > /tmp/all_issues.json

# 列出所有 PRs
gh pr list \
  --repo exomind-team/exomind \
  --state all \
  --limit 500 \
  --json number,title,author,body,createdAt \
  > /tmp/all_prs.json

# 快速查看 Issues 数量
cat /tmp/all_issues.json | python3 -c "import json,sys; data=json.load(sys.stdin); print(f'共 {len(data)} 条 Issues')"
```

### 2.2 提取 Issues 正文和所有评论

```bash
# 提取单条 Issue 的完整内容（包含所有评论）
# 注意：需要逐条抓取，可以编写循环
for issue_num in $(gh issue list --repo exomind-team/exomind --state all --limit 500 --json number --jq '.[].number'); do
  gh issue view "$issue_num" \
    --repo exomind-team/exomind \
    --json number,title,body,comments \
    >> /tmp/issues_full.json
  echo "---ISSUE_SEPARATOR---" >> /tmp/issues_full.json
done

# 提取所有 PR 的评论
for pr_num in $(gh pr list --repo exomind-team/exomind --state all --limit 500 --json number --jq '.[].number'); do
  gh pr view "$pr_num" \
    --repo exomind-team/exomind \
    --json number,title,body,comments \
    >> /tmp/prs_full.json
  echo "---PR_SEPARATOR---" >> /tmp/prs_full.json
done
```

### 2.3 在 Issues/PR 内容中搜索敏感关键词

```bash
# 使用 gh search 在 Issues 中搜索关键词（支持全文搜索）

# 搜索中文姓名模式（举例：张三、李四等常见名字结构）
gh search issues \
  --repo exomind-team/exomind \
  --limit 100 \
  "张 OR 李 OR 王 OR 陈 OR 刘" \
  --json number,title,url

# 搜索手机号模式（1开头11位）
gh search issues \
  --repo exomind-team/exomind \
  "1[3-9][0-9]{9}"

# 搜索邮箱关键词
gh search issues \
  --repo exomind-team/exomind \
  "@gmail.com OR @qq.com OR @163.com OR @outlook.com"

# 搜索内部会议/日程相关词汇
gh search issues \
  --repo exomind-team/exomind \
  "周会 OR 月会 OR 季度 OR OKR OR 融资 OR 投资人"

# 搜索薪资/财务相关
gh search issues \
  --repo exomind-team/exomind \
  "薪资 OR 工资 OR 月薪 OR 期权 OR 股权 OR 估值"

# 在本地 JSON 中用 grep 搜索（更精确）
grep -iE "(1[3-9][0-9]{9})" /tmp/issues_full.json
grep -iE "([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})" /tmp/issues_full.json
grep -iP "[\u4e00-\u9fa5]{2,4}(?:同学|老师|总|先生|女士)" /tmp/issues_full.json
```

### 2.4 扫描 Issue/PR 的 Labels 和 Milestones

```bash
# 查看所有 labels（可能含内部代号）
gh label list --repo exomind-team/exomind

# 查看所有 milestones
gh api repos/exomind-team/exomind/milestones \
  --jq '.[].title'

# 查看项目 (Projects) 列表
gh project list --owner exomind-team
```

---

## 3. 阶段二：代码文件扫描

### 3.1 克隆仓库到本地（如尚未克隆）

```bash
git clone https://github.com/exomind-team/exomind.git /tmp/exomind-scan
cd /tmp/exomind-scan
```

### 3.2 使用 ripgrep 扫描源码中的敏感信息

```bash
# 进入仓库目录
cd /tmp/exomind-scan

# === 邮箱地址扫描 ===
rg -i --glob '!*.lock' --glob '!node_modules/**' \
  "[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}" \
  --with-filename --line-number \
  > /tmp/scan_email.txt

# === 手机号扫描（中国大陆）===
rg --glob '!*.lock' \
  "1[3-9][0-9]{9}" \
  --with-filename --line-number \
  > /tmp/scan_phone.txt

# === API Key / Token 扫描 ===
rg -i \
  "(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|bearer\s+[a-z0-9\-]{20,})" \
  --glob '!*.lock' --glob '!node_modules/**' \
  --with-filename --line-number \
  > /tmp/scan_apikey.txt

# === 密码硬编码扫描 ===
rg -i \
  "(password|passwd|pwd)\s*[:=]\s*['\"][^'\"]{6,}" \
  --glob '!*.lock' --glob '!node_modules/**' \
  --with-filename --line-number \
  > /tmp/scan_password.txt

# === 数据库连接串 ===
rg -i \
  "(mongodb|postgres|mysql|redis|sqlite):\/\/[^\s'\"]{10,}" \
  --glob '!*.lock' \
  --with-filename --line-number \
  > /tmp/scan_db.txt

# === 私钥文件特征 ===
rg \
  "-----BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY-----" \
  --with-filename --line-number \
  > /tmp/scan_privatekey.txt

# === 中文真实姓名模式（常见姓氏 + 1-3字名）===
rg -P \
  "(?:张|王|李|刘|陈|杨|黄|赵|吴|周|徐|孙|马|朱|胡|郭|何|高|林|郑)[^\s\u4e00]{0}[\u4e00-\u9fa5]{1,3}" \
  docs/ --with-filename --line-number \
  > /tmp/scan_name.txt

# === 身份证号码 ===
rg \
  "[1-9][0-9]{5}(19|20)[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[0-9]{3}[0-9Xx]" \
  --with-filename --line-number \
  > /tmp/scan_id.txt

# === 内网 IP / 私有域名 ===
rg \
  "(192\.168\.[0-9]{1,3}\.[0-9]{1,3}|10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|\.internal\.|\.local\.)" \
  --glob '!*.lock' --with-filename --line-number \
  > /tmp/scan_internalip.txt

# === 扫描 docs/ memory/ 目录（通常含会议记录、日程）===
rg -i \
  "(日程|会议|开会|讨论|决策|策略|方案|竞品|竞争|融资|投资)" \
  docs/ --with-filename --line-number \
  > /tmp/scan_docs_sensitive.txt

# === 汇总所有扫描结果大小 ===
wc -l /tmp/scan_*.txt
```

### 3.3 扫描特定高风险文件类型

```bash
# 检查所有 .env 文件（可能含真实配置）
find /tmp/exomind-scan -name "*.env" -o -name ".env*" | grep -v node_modules | grep -v target

# 检查所有 config 文件
find /tmp/exomind-scan -name "config.*" -o -name "*.config.*" | grep -v node_modules | grep -v target | head -50

# 检查 JSON 配置文件中的凭证
rg -i "secret|token|password|key" \
  --glob '*.json' --glob '!package-lock.json' --glob '!*.lock' \
  --with-filename --line-number \
  /tmp/exomind-scan \
  > /tmp/scan_json_cred.txt

# 检查 TOML 配置（Rust 项目常见）
rg -i "secret|token|password|key|email" \
  --glob '*.toml' \
  --with-filename --line-number \
  /tmp/exomind-scan \
  > /tmp/scan_toml_cred.txt
```

### 3.4 检查 git-ignored 文件是否被意外提交

```bash
cd /tmp/exomind-scan

# 查看 .gitignore 规则列表
cat .gitignore

# 检查是否有应被忽略但已被追踪的文件
git ls-files | grep -E "\.(env|key|pem|p12|pfx|secret)$"

# 检查 .env 相关文件是否在版本控制中
git ls-files | grep "\.env"
```

---

## 4. 阶段三：Git 历史扫描

### 4.1 扫描提交 Message 中的敏感信息

```bash
cd /tmp/exomind-scan

# 列出所有 commit message，搜索敏感词
git log --all --oneline | \
  grep -iE "(姓名|真名|手机|邮件|密码|token|secret|key|融资|薪资|OKR)" \
  > /tmp/git_log_sensitive.txt

# 更详细的格式（含作者、时间）
git log --all --format="%H %ae %s" | \
  grep -iE "(password|token|secret|key|api)" \
  > /tmp/git_log_cred.txt

# 统计所有提交的作者邮箱（可能暴露真实邮箱）
git log --all --format="%ae" | sort -u \
  > /tmp/git_authors.txt

# 统计所有提交的作者姓名
git log --all --format="%an" | sort -u \
  > /tmp/git_author_names.txt

# 查看 .gitconfig 中是否留有真实姓名
git config --global --list | grep -E "(name|email)"
```

### 4.2 扫描历史 diff 中的敏感内容

```bash
cd /tmp/exomind-scan

# 在全历史 diff 中搜索邮箱（最全面但耗时）
git log --all -p | \
  grep -iE "[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}" \
  > /tmp/git_diff_email.txt

# 搜索历史中的手机号
git log --all -p | \
  grep -E "1[3-9][0-9]{9}" \
  > /tmp/git_diff_phone.txt

# 搜索历史中的 API Key 模式
git log --all -p | \
  grep -iE "(api_key|apikey|secret_key|access_token)\s*[:=]\s*['\"]?[A-Za-z0-9\-_]{20,}" \
  > /tmp/git_diff_apikey.txt

# 搜索历史中删除的敏感行（+/- 开头的 diff 行）
git log --all -p -S "password" --pickaxe-regex \
  > /tmp/git_pickaxe_password.txt

# 使用 git log -S 搜索特定字符串曾经出现过
git log --all -S "13812345678" --oneline  # 替换为真实手机号
git log --all -S "your@email.com" --oneline  # 替换为真实邮箱
```

### 4.3 使用专业工具扫描 Git 历史

```bash
# 方法一：使用 truffleHog（推荐，能检测高熵字符串和已知 Secret 模式）
pip install trufflehog
trufflehog git file:///tmp/exomind-scan \
  --only-verified \
  --json \
  > /tmp/trufflehog_results.json

# 方法二：使用 gitleaks
# 下载：https://github.com/gitleaks/gitleaks/releases
gitleaks detect \
  --source /tmp/exomind-scan \
  --report-format json \
  --report-path /tmp/gitleaks_report.json

# 方法三：使用 git-secrets（AWS 开源）
git secrets --scan-history  # 需要先安装并配置规则
```

### 4.4 检查特定历史文件

```bash
cd /tmp/exomind-scan

# 查看某个文件在历史上的所有版本（检查是否曾含敏感内容）
git log --all --full-history -- "docs/memory/logs.md"
git log --all --full-history -- "*.env"
git log --all --full-history -- "config*"

# 查看某次 commit 的完整 diff（替换 COMMIT_HASH）
git show COMMIT_HASH

# 列出所有曾经存在过的文件（包括已删除）
git log --all --diff-filter=D --summary | grep "delete mode"
```

---

## 5. 阶段四：开发日志 / devlog 扫描

### 5.1 扫描本地 docs/memory 目录

```bash
cd /tmp/exomind-scan

# 列出 memory 目录结构
find docs/memory -type f | sort

# 扫描日志文件中的人名
rg -P \
  "[\u4e00-\u9fa5]{2,4}(?:同学|老师|总|先生|女士|说|提出|建议|认为)" \
  docs/memory/ --with-filename --line-number

# 扫描日志中的日程信息
rg -i \
  "([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}|今天|明天|后天|周[一二三四五六日]|上午|下午|晚上)[^。\n]{0,30}(开会|讨论|见|约)" \
  docs/memory/ --with-filename --line-number

# 扫描内部策略词汇
rg -i \
  "(竞品|竞争对手|融资轮|估值|BD|商务谈判|合同|保密)" \
  docs/ --with-filename --line-number

# 扫描 devlog 相关文件
find . -name "*devlog*" -o -name "*dev-log*" -o -name "*日志*" | grep -v node_modules | grep -v target
```

### 5.2 检查 GitHub Pages 发布内容

```bash
# 查看仓库的 GitHub Pages 配置
gh api repos/exomind-team/exomind/pages \
  --jq '{status: .status, url: .html_url, source: .source}'

# 如果开启了 GitHub Pages，检查发布分支（通常是 gh-pages）
git fetch origin gh-pages 2>/dev/null && \
  git log origin/gh-pages --oneline -20

# 检查 gh-pages 分支上的内容
git show origin/gh-pages: 2>/dev/null | head -50

# 列出 gh-pages 分支上的所有文件
git ls-tree --name-only -r origin/gh-pages 2>/dev/null

# 在 gh-pages 内容中搜索敏感信息
git archive origin/gh-pages | tar -t 2>/dev/null | head -50

# 检查 GitHub Actions workflow 中是否配置了 Pages 部署
find .github/workflows -name "*.yml" -o -name "*.yaml" | xargs grep -l "pages" 2>/dev/null
```

### 5.3 检查 devlog 相关脚本

```bash
cd /tmp/exomind-scan

# 找到所有 devlog 相关脚本
find . -path "*/scripts*" -name "*devlog*" | grep -v node_modules
find . -path "*/scripts*" -name "*publish*" | grep -v node_modules

# 检查发布脚本中是否硬编码了敏感信息
cat scripts/dev/publish-devlog.ts 2>/dev/null
cat scripts/dev/publish-route.ts 2>/dev/null

# 扫描脚本文件中的敏感配置
rg -i "(secret|token|password|api_key|auth)" \
  scripts/ --with-filename --line-number
```

### 5.4 检查已发布的 GitHub Pages 内容（在线）

```bash
# 如果 GitHub Pages URL 已知，可以用 curl 检查
# 注意：这会真正访问公开内容

# 检查 Pages 是否可访问
curl -s -o /dev/null -w "%{http_code}" https://exomind-team.github.io/exomind/

# 抓取 sitemap（如果存在）
curl -s https://exomind-team.github.io/exomind/sitemap.xml | \
  grep -oE "https?://[^<]+" | head -30

# 检查特定路径
curl -s https://exomind-team.github.io/exomind/devlog/ | \
  grep -iE "(姓名|手机|邮件|内部)" | head -20
```

---

## 6. 阶段五：发现泄露后的应急处置

### 6.1 优先级排序

| 优先级 | 泄露类型 | 原因 | 响应时间 |
|--------|----------|------|----------|
| P0 | API Key / 密钥 / 密码 | 可被立即利用，造成直接损失 | 1小时内 |
| P0 | 身份证号 / 银行卡号 | 违反隐私法规，法律风险 | 1小时内 |
| P0 | 手机号 + 真实姓名组合 | 可用于定向诈骗 | 2小时内 |
| P1 | 内部商业策略 / 融资信息 | 竞争风险 | 24小时内 |
| P1 | 个人日程 / 行程 | 安全风险 | 24小时内 |
| P2 | 内部域名 / IP | 基础设施信息泄露 | 48小时内 |
| P2 | 内部人员列表（无联系方式）| 信息泄露但直接风险低 | 72小时内 |

### 6.2 立即操作：将仓库设为私有（暂时）

```bash
# 将仓库重新设为私有（争取处理时间）
gh api -X PATCH repos/exomind-team/exomind \
  -f private=true

# 确认已变更
gh api repos/exomind-team/exomind --jq '.private'
# 应输出: true
```

### 6.3 删除含敏感信息的 Issues / PRs

```bash
# 方法一：关闭并锁定（内容仍可见，但减少曝光）
gh issue close ISSUE_NUMBER --repo exomind-team/exomind \
  --reason "not planned"

# 方法二：删除 Issue（需要仓库 Admin 权限）
gh api -X DELETE repos/exomind-team/exomind/issues/ISSUE_NUMBER
# 注意：GitHub 通常不允许 API 删除 issue，需要通过网页操作

# 删除特定评论（comment_id 从 issue view 获取）
gh api -X DELETE repos/exomind-team/exomind/issues/comments/COMMENT_ID

# 删除 PR 的特定评论
gh api -X DELETE repos/exomind-team/exomind/pulls/comments/COMMENT_ID
```

### 6.4 清理代码文件中的敏感信息

```bash
cd /tmp/exomind-scan

# 步骤1：直接编辑文件，替换敏感内容
# 用占位符替换真实手机号
sed -i 's/13812345678/PHONE_REDACTED/g' path/to/file.ts

# 步骤2：提交修改
git add path/to/file.ts
git commit -m "security: redact personal information from config"

# 步骤3：推送
git push origin dev
```

### 6.5 清理 Git 历史（使用 git-filter-repo）

**警告：这会重写历史，需要所有协作者重新 clone 或 rebase。**

```bash
# 安装 git-filter-repo
pip install git-filter-repo

# --- 方法一：删除整个文件的历史 ---
# 从所有历史中删除 .env 文件
git filter-repo --path .env --invert-paths --force

# 从所有历史中删除 docs/memory/logs.md
git filter-repo --path docs/memory/logs.md --invert-paths --force

# --- 方法二：替换历史中的敏感字符串 ---
# 创建替换规则文件
cat > /tmp/replacements.txt << 'EOF'
13812345678==>PHONE_REDACTED
your@real-email.com==>user@example.com
真实姓名==>USERNAME
sk-abc123yourapikey==>API_KEY_REDACTED
EOF

# 执行字符串替换（替换所有历史中的敏感字符串）
git filter-repo \
  --replace-text /tmp/replacements.txt \
  --force

# --- 方法三：仅删除特定路径下文件 ---
git filter-repo \
  --path-glob "*.env" \
  --path-glob "*.key" \
  --path-glob "*.pem" \
  --invert-paths \
  --force

# 验证替换结果
git log --all -p | grep -c "PHONE_REDACTED"  # 应 > 0
git log --all -p | grep -c "13812345678"      # 应 = 0
```

### 6.6 使用 BFG Repo-Cleaner（备选方案）

```bash
# 下载 BFG
wget https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar \
  -O /tmp/bfg.jar

# 删除特定文件的历史
java -jar /tmp/bfg.jar \
  --delete-files ".env" \
  /tmp/exomind-scan

# 替换文本（需要创建 passwords.txt 文件）
echo "sk-abc123yourapikey" > /tmp/passwords.txt
java -jar /tmp/bfg.jar \
  --replace-text /tmp/passwords.txt \
  /tmp/exomind-scan

# BFG 操作后需要执行 gc 清理
cd /tmp/exomind-scan
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### 6.7 Force Push 注意事项

```bash
# 重写历史后，必须 force push（这是危险操作）
# 建议先备份原始仓库

# 备份原始状态
git bundle create /tmp/exomind-backup-$(date +%Y%m%d).bundle --all

# Force push 所有分支（谨慎！）
git push origin --force --all
git push origin --force --tags

# 或者只 force push 特定分支
git push origin +dev:dev
git push origin +main:main
```

### 6.8 下游缓存清理

```bash
# 1. 清理 GitHub 缓存（通过设置页面）
# 访问：https://github.com/exomind-team/exomind/settings
# 进入 "Danger Zone" -> 相关选项

# 2. 清理 GitHub Pages 缓存
# 在 GitHub Pages 设置中触发重新部署
gh api -X POST repos/exomind-team/exomind/pages/builds

# 3. 申请清除 Google Cache（对已被搜索引擎收录的页面）
# 访问：https://search.google.com/search-console
# 使用 URL 移除工具：https://search.google.com/search-console/remove-outdated-content

# 4. 清除 Bing Cache
# 访问：https://www.bing.com/webmaster/tools

# 5. 检查 Wayback Machine 是否已存档
curl -s "https://archive.org/wayback/available?url=github.com/exomind-team/exomind" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('archived_snapshots', {}))"

# 如已存档，申请排除：
# 发邮件至 info@archive.org 说明情况

# 6. 清除 npm/crates.io 等包注册表（如有发布）
# npm unpublish exomind@VERSION  （仅 72 小时内有效）
# cargo yank --vers VERSION exomind
```

### 6.9 事后操作清单

```
[ ] 1. 确认仓库已重新公开（如需要）
[ ] 2. 通知所有协作者重新 clone（因为历史已重写）
[ ] 3. 使受影响的 API Key 失效（在相应平台撤销 Token）
[ ] 4. 如有手机号泄露，评估是否需要更换号码
[ ] 5. 向相关人员（如果有他人信息被泄露）发送通知
[ ] 6. 检查并更新 .gitignore，防止未来再次泄露
[ ] 7. 配置 GitHub Secret Scanning（自动检测未来的 Secret 泄露）
[ ] 8. 添加 pre-commit hook 阻止敏感文件提交
```

### 6.10 配置 pre-commit hook 防止未来泄露

```bash
# 安装 pre-commit
pip install pre-commit

# 创建 .pre-commit-config.yaml
cat > .pre-commit-config.yaml << 'EOF'
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
  - repo: https://github.com/awslabs/git-secrets
    rev: master
    hooks:
      - id: git-secrets
EOF

# 安装 hooks
pre-commit install
```

---

## 7. 扫描关键词参考清单

### 7.1 中文敏感词汇

```
# 人员相关
同学 老师 总裁 总监 经理 主任 负责人
先生 女士 小姐 同志
联系方式 手机号 电话 微信 QQ

# 日程/会议
日程 会议 开会 周会 月会 季度会
讨论 碰头 约 见面 出差 行程
今天 明天 周一 周二 周三 周四 周五

# 商业机密
融资 投资 估值 股权 期权 薪资 工资
竞品 竞争对手 BD 商务 合同 保密 NDA
OKR KPI 季度目标 年度计划

# 内部信息
内部 私密 仅内部 不对外 机密 敏感
测试环境 生产环境 staging prod

# 策略词汇
战略 路线图 roadmap 优先级 规划
```

### 7.2 英文敏感词汇

```
# 凭证相关
password passwd pwd secret token
api_key apikey access_token auth_token
private_key secret_key bearer

# 联系方式
@gmail.com @qq.com @163.com @hotmail.com
@outlook.com @yahoo.com @icloud.com

# 内部信息
internal confidential private restricted
do not share not for distribution

# 基础设施
localhost 127.0.0.1 192.168. 10.0.
.internal .local staging prod admin

# 常见泄露模式
BEGIN RSA PRIVATE KEY
BEGIN OPENSSH PRIVATE KEY
-----BEGIN CERTIFICATE-----
sk- (OpenAI API Key 前缀)
ghp_ (GitHub Personal Access Token)
glpat- (GitLab Personal Access Token)
```

### 7.3 正则表达式速查

```regex
# 中国手机号
1[3-9]\d{9}

# 邮箱地址
[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}

# 身份证号
[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]

# IPv4（私有网段）
(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})

# GitHub Token
ghp_[A-Za-z0-9]{36}

# OpenAI API Key
sk-[A-Za-z0-9]{48}

# 通用高熵字符串（可能是密钥）
[A-Za-z0-9+/]{40,}={0,2}
```

---

## 附录：扫描执行顺序建议

```
Day 1（前4小时）：
  1. 将仓库设为私有（争取处理时间）                 [6.2]
  2. 扫描 Issues/PR（最可能含直接的个人信息）        [阶段一]
  3. 扫描代码文件中的 API Key / 密码                [阶段二，重点]

Day 1（后4小时）：
  4. 扫描 Git 历史 commit message                  [4.1]
  5. 使用 truffleHog / gitleaks 深度扫描           [4.3]
  6. 紧急处理 P0 级泄露                            [6.3-6.7]

Day 2：
  7. 扫描 docs/memory 等文档目录                   [阶段四]
  8. 检查 GitHub Pages 内容                        [5.2]
  9. 处理 P1 级泄露

Day 3：
  10. 清除下游缓存（Google、Wayback Machine 等）   [6.8]
  11. 配置防护措施（pre-commit hook）              [6.10]
  12. 重新将仓库设为公开（确认清理完毕后）
  13. 编写事后复盘报告
```

---

*本文档生成时间：2026-04-02*
*适用仓库：exomind-team/exomind*
*文档版本：v1.0*
