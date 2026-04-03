# 隐私泄露应急处置方案

**事件概述**：exomind-team/exomind 仓库 Issue #762 中包含导师真实姓名，需彻底清除。

---

## 第一步：关闭并删除 Issue #762

GitHub Issue 删除需要仓库管理员权限（Admin 或 Owner）。

```bash
# 1. 先关闭 issue（标记为 not planned）
gh issue close 762 --repo exomind-team/exomind --reason "not planned"

# 2. 删除 issue（需要 Admin 权限）
gh issue delete 762 --repo exomind-team/exomind --yes
```

> **注意**：如果你没有 Admin 权限，需要联系仓库 Owner 执行删除。删除 Issue 是不可逆操作。

---

## 第二步：检查关联内容是否也包含敏感信息

Issue #762 可能有关联的评论、PR 引用或 commit 引用，逐一排查：

```bash
# 查看 issue 详情（执行删除前先核实内容）
gh issue view 762 --repo exomind-team/exomind

# 搜索是否有 PR 引用了该 issue
gh pr list --repo exomind-team/exomind --search "762" --state all

# 搜索代码中是否有引用
gh search code "762" --repo exomind-team/exomind
```

---

## 第三步：检查 devlog / GitHub Pages 是否有下游副本

如果项目有自动生成的 devlog 或发布到 GitHub Pages 的报告，这些系统可能已经抓取了 Issue #762 的内容：

```bash
# 检查 GitHub Pages 是否已发布包含该 issue 的内容
# 查看 gh-pages 分支或 docs/ 目录
gh api repos/exomind-team/exomind/git/refs --jq '.[] | select(.ref | contains("pages"))'

# 如果有 gh-pages 分支，检查其内容
gh api repos/exomind-team/exomind/contents/ --ref gh-pages
```

如果发现 GitHub Pages 上有副本，需要：
1. 找到对应的生成脚本或源文件
2. 删除或替换其中的敏感内容
3. 重新构建并推送更新后的 Pages 内容

---

## 第四步：检查 Git 历史中是否有提交包含该信息

如果敏感信息曾被提交到代码文件（而非仅在 Issue 中），需要清理 Git 历史：

```bash
# 先在本地克隆仓库
git clone https://github.com/exomind-team/exomind.git
cd exomind

# 搜索历史中是否有包含敏感内容的提交
# 将 "导师真实姓名" 替换为实际姓名
git log --all --oneline -S "导师真实姓名"
git grep "导师真实姓名" $(git rev-list --all)
```

如果 Git 历史中有该内容，使用 `git-filter-repo` 清除：

```bash
# 安装 git-filter-repo
pip install git-filter-repo

# 从所有历史中删除包含敏感内容的字符串
# 将 SENSITIVE_NAME 替换为实际姓名（注意：这会重写历史）
git filter-repo --replace-text <(echo "导师真实姓名==>REDACTED")

# 强制推送清理后的历史（需要仓库 Admin 权限）
git push origin --force --all
git push origin --force --tags
```

> **警告**：`git filter-repo` + force push 会重写整个仓库历史，所有协作者需要重新 clone。执行前务必通知团队。

---

## 第五步：撤销 GitHub 对已删除内容的缓存

GitHub 会缓存一些内容。删除 Issue 后：

1. 等待 GitHub 的搜索索引自动更新（通常数小时至 24 小时）
2. 如果内容已被 Google 等搜索引擎收录，可以向 Google 提交移除请求：
   - 访问 https://search.google.com/search-console/remove-outdated-content
   - 提交包含敏感信息的具体 URL

---

## 第六步：检查是否有外部镜像

```bash
# 检查是否有已知镜像站点抓取了该仓库
# 常见镜像：gitee、sourcegraph 等
# 手动访问以下地址检查（将 URL 中的仓库名替换为实际地址）
# https://sourcegraph.com/github.com/exomind-team/exomind
```

如果发现镜像站点有副本，需要联系对应平台删除或等待其同步删除。

---

## 处置优先级总结

| 步骤 | 紧急程度 | 操作难度 | 说明 |
|------|---------|---------|------|
| 删除 Issue #762 | 🔴 立即 | 低 | 最核心操作，立即执行 |
| 检查关联 PR/代码引用 | 🔴 立即 | 低 | 防止其他地方仍有引用 |
| 检查 GitHub Pages | 🟠 当天 | 中 | devlog 系统可能有副本 |
| 检查 Git 历史 | 🟡 次日 | 高 | 仅当历史提交中有此信息时需要 |
| 处理搜索引擎缓存 | 🟡 次日 | 低 | 被收录后才需要 |
| 处理外部镜像 | 🟢 本周内 | 高 | 视镜像站点情况而定 |

---

## 注意事项

1. **执行删除前先截图留证**：记录 Issue #762 的完整内容，便于后续确认清理是否彻底。
2. **通知相关人员**：如果有团队成员已 fork 了仓库，需要通知他们同步删除本地副本。
3. **Git 历史重写是破坏性操作**：如果 Issue 中的信息仅存在于 Issue 本身（非代码提交），则不需要执行 `git filter-repo`，删除 Issue 即可。
4. **GitHub 删除 Issue 后 URL 会显示 404**，但 API 可能短暂仍可访问，这是正常现象。
