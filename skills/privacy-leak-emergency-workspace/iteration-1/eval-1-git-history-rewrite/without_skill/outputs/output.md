# 隐私泄露应急处置方案

**目标仓库**：`exomind-team/exomind-devlog`
**敏感内容**：JSON 文件中包含「与黎老师交流NARS翻译问题」
**处置日期**：2026-04-02
**处置级别**：L1（真实人名）+ L3（内部交流内容）→ 优先级 P0，立即处理

---

## 为什么单独删除文件不够

在执行任何操作前，必须理解「仅删除当前文件」为何不足：

| 残留渠道 | 说明 | 可主动消除 |
|---------|------|-----------|
| Git 历史中的历史 commit | 敏感文本写入 JSON 时就已记录在 commit 里 | 需 filter-repo 重写 |
| Force push 后的悬空对象 | 旧 commit SHA 在 GitHub GC 前（约90天）仍可直接访问 | 需联系 GitHub Support |
| GitHub 代码搜索索引 | 重写后数天~数周内仍可搜到 | 自动失效 |
| Events API（30天窗口） | push 事件中记录了旧 commit SHA | 无法主动清除 |
| 外部缓存/爬虫 | 取决于仓库访问频率 | 风险较低 |

**结论**：必须用 `git filter-repo` 重写整个历史，再 force push，同时向 GitHub Support 请求立即 GC。

---

## 第一阶段：全面定位（执行前先确认所有暴露面）

### 1.1 确认主仓库中的敏感文件和提交

```bash
# clone devlog 仓库（如已 clone 则 cd 进去）
git clone https://github.com/exomind-team/exomind-devlog.git
cd exomind-devlog

# 找出所有含敏感词的 commit（应产生非空输出）
git log --oneline --all -S "黎老师"

# 找出当前工作区中含敏感词的文件
git grep "黎老师"

# 更宽泛的变体搜索（覆盖不同措辞）
git log --oneline --all -S "黎老师交流"
git log --oneline --all -S "NARS翻译"
```

记录上述命令输出的 commit hash 列表，后续验证时使用。

### 1.2 搜索主仓库 issues 和代码（远程）

```bash
# 搜索 issues 标题和正文
gh search issues --repo exomind-team/exomind-devlog "黎老师" --json number,title
gh search issues --repo exomind-team/exomind-devlog "NARS翻译" --json number,title

# 搜索代码
gh search code --repo exomind-team/exomind-devlog "黎老师"
gh search code --repo exomind-team/exomind-devlog "NARS翻译"
```

### 1.3 排查组织内所有公开库

```bash
# 逐库检查是否有扩散
for repo in $(gh repo list exomind-team --json name,isPrivate \
  --jq '.[] | select(.isPrivate==false) | .name'); do
  result=$(gh search code --repo "exomind-team/$repo" "黎老师" 2>&1)
  [ -z "$result" ] || [ "$result" = "[]" ] \
    && echo "✅ $repo: 无" || echo "⚠️  $repo: $result"
done
```

### 1.4 检查 Events API（记录旧 SHA，后续联系 Support 时需要）

```bash
gh api "repos/exomind-team/exomind-devlog/events?per_page=100" \
  --jq '.[] | select(.type=="PushEvent") |
    {sha: .payload.commits[].sha, message: .payload.commits[].message, created_at: .created_at}' \
  | grep -A2 "NARS\|黎老师" || echo "Events API 中无匹配（可能已超30天窗口）"
```

---

## 第二阶段：Git 历史重写

### 2.1 安装 git-filter-repo

```bash
# macOS
pip3 install git-filter-repo

# Linux
pip install git-filter-repo

# Windows（PowerShell，需 Python 环境）
pip install git-filter-repo
```

### 2.2 准备替换规则文件

规则原则：**仅去除人名，保留技术语义**，不使用空字符串（防止破坏 JSON 结构）。

```bash
cat > /tmp/devlog-rules.txt << 'EOF'
与黎老师交流NARS翻译问题==>NARS术语翻译问题研究
与黎老师交流 NARS 翻译问题==>NARS 术语翻译问题研究
与黎老师交流NARS翻译==>NARS翻译问题研究
黎老师==>外部专家
EOF
```

> **说明**：需要覆盖所有实际存在的变体。执行 1.1 的 `git log -S` 后，根据实际输出补充变体到规则文件中。

### 2.3 备份原始仓库（重要）

```bash
# 在 devlog 仓库的父目录执行
cp -r exomind-devlog exomind-devlog.bak
```

### 2.4 执行历史重写

```bash
cd exomind-devlog

# 执行 filter-repo（会重写所有分支的完整历史）
git filter-repo --replace-text /tmp/devlog-rules.txt --force
```

> **注意**：`git filter-repo` 执行后会**自动移除 remote**，必须重新添加：

```bash
git remote add origin https://github.com/exomind-team/exomind-devlog.git
```

### 2.5 本地验证（必须通过才能继续）

```bash
# 验证1：历史中不应再有敏感词（应无输出）
git log --oneline --all -S "黎老师"
git log --oneline --all -S "NARS翻译问题"

# 验证2：当前工作区不应有敏感词（应无输出）
git grep "黎老师"
git grep "黎老师交流"

# 验证3：抽查具体 JSON 文件内容
# （将 <path-to-file> 替换为 1.1 中 git grep 找到的实际文件路径）
git show HEAD:<path-to-file> | grep "黎老师" || echo "✅ 当前版本已清洁"
```

**如果任一验证有输出**：检查替换规则是否覆盖了该变体，补充到规则文件后重新执行 2.4。

---

## 第三阶段：Force Push 到远端

### 3.1 推送所有分支

```bash
# 推送主分支（按实际主分支名替换 main）
git push --force origin main

# 如果有其他分支也需要推送（按实际情况）
# git push --force origin --all
```

### 3.2 远程验证

```bash
# 通过 GitHub API 直接检查远端文件内容（替换 <path> 为实际文件路径）
gh api "repos/exomind-team/exomind-devlog/contents/<path>" \
  --jq '.content' | base64 -d | grep "黎老师" \
  && echo "⚠️ 远端仍有残留！" || echo "✅ 远端已清洁"

# 代码搜索验证（等待索引更新后再查，可能需要数分钟~数小时）
gh search code --repo exomind-team/exomind-devlog "黎老师"
```

---

## 第四阶段：请求 GitHub Support 加速 GC

Force push 后旧 commit 变为悬空对象，默认约 90 天后才被 GitHub GC。若对残留窗口有顾虑，应立即联系 Support：

**操作步骤**：

1. 访问 https://support.github.com/contact/privacy
2. 选择「Personal Information Removal」或「GDPR request」
3. 提供以下信息：
   - 仓库：`exomind-team/exomind-devlog`
   - 问题描述：「The repository contains personal information (a real person's name) that was committed by mistake. We have rewritten history using git filter-repo and force pushed, but dangling objects with old commits may still be accessible via their SHA hashes. Please run GC immediately or invalidate the old commit SHAs.」
   - 如果在 3.1 的 Events API 检查中找到了旧 SHA，附上这些 SHA

---

## 第五阶段：扩展扫描

处置完成后，以「黎老师」为核心向外扩展排查，确认无关联泄露。

### 5.1 关联关键词扫描

```bash
# 扫描 devlog 仓库中其他可能包含人名的内容
for kw in "老师" "同学" "导师" "师兄" "师姐" "朋友" "约好" "见面" "周末计划"; do
  result=$(gh search issues --repo exomind-team/exomind-devlog "$kw" --json number,title 2>&1)
  [ "$result" != "[]" ] && [ -n "$result" ] && echo "[$kw] $result"
done
```

```bash
# 本地 JSON/HTML 文件扫描（在已 clone 的仓库内执行）
cd exomind-devlog
for kw in "老师" "同学" "导师" "周末计划" "约好"; do
  result=$(git grep -l "$kw" -- "*.json" "*.html" 2>/dev/null)
  [ -n "$result" ] && echo "[$kw] 命中文件: $result"
done
```

### 5.2 主仓库交叉核查

```bash
# 检查主仓库 exomind 是否也有关联泄露（如 issue 里引用了同一次交流）
gh search issues --repo exomind-team/exomind "黎老师" --json number,title
gh search issues --repo exomind-team/exomind "NARS翻译" --json number,title
```

---

## 第六阶段：双盲验证与处置报告

### 双盲验证

**路径 A（本地）**：

```bash
cd exomind-devlog
git log --oneline --all -S "黎老师"   # 期望：无输出
git grep "黎老师"                       # 期望：无输出
```

**路径 B（远程）**：

```bash
gh search code --repo exomind-team/exomind-devlog "黎老师"   # 期望：无结果
gh search issues --repo exomind-team/exomind-devlog "黎老师" --json number,title  # 期望：[]
```

两条路径结果一致（均为空）才可确认清洁。

---

### 处置报告模板

处置完成后填写以下报告（可粘贴到相关 issue 或内部记录中）：

```markdown
## 隐私泄露处置报告 - 2026-04-02

**泄露内容**：exomind-devlog 仓库 JSON 文件中包含「与黎老师交流NARS翻译问题」
**敏感等级**：L1（真实人名）
**处置人**：[填写]
**处置完成时间**：[填写]

### 暴露面清单

| 位置 | 内容片段 | 处置结果 |
|------|----------|----------|
| exomind-devlog/[具体文件路径] | 「与黎老师交流NARS翻译问题」| ✅ filter-repo 已重写 |
| Git 历史 commit [旧SHA] | 同上 | 🟠 悬空对象，已申请 GitHub Support GC |
| GitHub 代码搜索索引 | 同上 | 🟠 重写后数天内自动失效 |

### 验证结果

| 验证项 | 结果 |
|--------|------|
| 本地 `git log -S "黎老师"` | ✅ 无残留 |
| 本地 `git grep "黎老师"` | ✅ 无残留 |
| 远程 API 文件内容检查 | ✅ 无残留 |
| GitHub 代码搜索 | 🟠 索引更新中（预计数小时~数天） |
| Events API | ⚠️ 旧 push 事件中 SHA 仍在30天窗口内 |
| GitHub Support GC 请求 | [填写状态] |

### 注意事项

1. **悬空对象**：Force push 后旧 commit 约90天后被 GitHub 自动 GC，已提交 Support 请求加速处理。
2. **已接收邮件通知**：若有仓库关注者在 commit 时收到了邮件通知，邮件内容无法撤回——这是不可消除的风险。
3. **扩展扫描结论**：[填写扩展扫描结果，如「未发现其他关联隐私内容」]
```

---

## 快速操作摘要（按序执行）

```
1. git clone + 全面 git log -S / git grep 定位
2. 准备 /tmp/devlog-rules.txt 替换规则
3. cp -r 备份原始仓库
4. git filter-repo --replace-text /tmp/devlog-rules.txt --force
5. git remote add origin ... （filter-repo 会删掉 remote）
6. 本地双验证：git log -S + git grep 均无输出
7. git push --force origin main
8. 远程验证：gh api contents + gh search code
9. 提交 GitHub Support 请求加速 GC
10. 扩展扫描关联关键词
11. 填写处置报告
```

---

## 残留风险说明

| 风险项 | 程度 | 说明 |
|--------|------|------|
| 悬空 Git 对象 | 中 | ~90 天后 GC，已请求 Support 加速 |
| GitHub 代码搜索索引 | 低 | 重写后数天内失效，搜索结果消失 |
| Events API | 低 | devlog 仓库关注者较少，30天后自动清除 |
| 邮件通知 | 不可消除 | 仅影响已关注仓库的用户，风险可控 |
| Wayback Machine | 极低 | devlog 类仓库被自动存档概率很低 |
