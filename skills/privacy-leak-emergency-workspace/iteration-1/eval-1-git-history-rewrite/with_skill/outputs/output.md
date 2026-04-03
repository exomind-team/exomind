# 隐私泄露应急处置方案
## exomind-team/exomind-devlog — 「与黎老师交流NARS翻译问题」

**生成日期**：2026-04-02
**泄露描述**：开发日报仓库 `exomind-team/exomind-devlog` 的 JSON 文件中包含真实人物称谓（「黎老师」）及具体交流内容（NARS翻译问题），已随 Git 历史推送到公开仓库。
**敏感等级**：L1（真实人名/称谓）+ L3（内部研究内容），综合定级 **P0 立即处理**

---

## 一、暴露面分析

在执行任何删除操作之前，必须先完整摸清所有可能携带该内容的位置。以下是针对 `exomind-devlog` 性质（开发日志/路线图自动同步仓库）的系统性分析。

### 1.1 主要暴露面

| # | 位置 | 类型 | 说明 |
|---|------|------|------|
| A | `exomind-devlog` 仓库 JSON 文件（当前 HEAD） | 文件内容 | 最直接暴露点，任何人可直接访问 |
| B | `exomind-devlog` Git 历史（所有 commits） | 悬空/历史对象 | force push 前所有 SHA 仍可通过 URL 访问（~90 天 GC 窗口） |
| C | GitHub Events API（push 事件） | 元数据 | 包含 push 前的 commit SHA，有效期 30 天 |
| D | GitHub 代码搜索索引 | 搜索索引 | 可通过 `gh search code` 检索到，删除后数天~数周失效 |
| E | 主库 `exomind-team/exomind`（若 devlog 是从主库同步生成） | 源头 | 若 devlog JSON 由主库 issue 标题自动同步，主库也可能存有原始条目 |
| F | GitHub Pages（若 devlog 开启了 Pages 部署） | 静态页面 | 已部署的 HTML 中可能包含该内容 |
| G | Wayback Machine / 搜索引擎缓存 | 外部存档 | 小仓库自动抓取频率低，但需确认 |
| H | 仓库关注者的邮件通知 | 不可撤回 | push/issue 创建时已触发，无法消除 |

### 1.2 定位命令（仅供参考，不执行）

**定位 devlog 仓库中的 JSON 文件（远程，逐文件扫描）：**

```bash
# 获取所有 JSON 文件路径
gh api "repos/exomind-team/exomind-devlog/git/trees/HEAD?recursive=1" \
  --jq '.tree[] | select(.path | endswith(".json")) | .path'

# 逐文件检查是否含关键词
for path in $(上述输出); do
  content=$(gh api "repos/exomind-team/exomind-devlog/contents/$path" \
    --jq '.content' 2>/dev/null | base64 -d 2>/dev/null)
  echo "$content" | grep -q "黎老师" \
    && echo "=== $path ===" && echo "$content" | grep "黎老师"
done
```

**定位本地 Git 历史：**

```bash
cd /path/to/exomind-devlog
git log --oneline --all -S "黎老师"
git log --oneline --all -S "NARS翻译"
git grep "黎老师"
git grep "NARS.*翻译"
```

**确认主库是否为源头（排查 exomind 主库）：**

```bash
gh search issues --repo exomind-team/exomind "黎老师" --json number,title
gh search code --repo exomind-team/exomind "黎老师"
gh search issues --repo exomind-team/exomind "NARS翻译" --json number,title
```

**确认 GitHub Pages 是否部署并包含敏感内容：**

```bash
# 若 devlog 有 Pages 部署，检查已发布的 HTML
curl -s "https://exomind-team.github.io/exomind-devlog/" | grep "黎老师"
```

---

## 二、威胁模型评估

### 2.1 各渠道持久化时间与可消除性

| 渠道 | 持续时长 | 可主动消除 | 实际风险 |
|------|----------|------------|----------|
| devlog JSON（HEAD 文件内容） | 直到 force push 覆盖 | ✅ 必须处理 | 高：任何人可读 |
| Git 历史中的旧 commit | ~90 天（GitHub GC 前） | ⚠️ 需联系 GitHub Support | 中：需知道旧 SHA |
| GitHub Events API（push 事件） | 30 天 | ❌ 无法主动清除 | 低：需主动查询 API |
| GitHub 代码搜索索引 | 数天~数周 | ❌ 无法主动清除，自然失效 | 低：有延迟，可接受 |
| Wayback Machine | 永久（若已抓取） | 需提交移除申请 | 低：小仓库自动抓取概率低 |
| 仓库关注者邮件 | 永久 | ❌ 无法撤回 | 低：取决于关注者范围 |

### 2.2 为什么不能只删文件

如果只删除 JSON 文件并提交新 commit：

```
旧 commit（含敏感内容） ← 仍可通过 SHA 直接访问
        ↓
新 commit（删除文件）
```

Git 对象存储模型决定了旧 commit 的文件树快照不会被"覆盖"，只是不再被分支指向。任何人只要持有旧的 commit SHA（可从 Events API push 事件获取），在 90 天 GC 窗口内仍可通过 `https://github.com/exomind-team/exomind-devlog/commit/<old-sha>` 直接访问。

**唯一有效的技术手段**：`git filter-repo` 重写历史 + force push，使旧内容的 SHA 消失（变为悬空对象，无分支指向），再联系 GitHub Support 申请提前 GC。

### 2.3 force push 后的残留机制

```
重写前：  main → C3(含敏感内容) → C2 → C1
重写后：  main → C3'(已替换)    → C2'→ C1'
                C3 → C2 → C1   ← 悬空对象，~90天内可直接访问
```

悬空对象访问路径：
```
https://github.com/exomind-team/exomind-devlog/commit/<old-C3-sha>
https://github.com/exomind-team/exomind-devlog/blob/<old-C3-sha>/<file>.json
```

### 2.4 实际威胁评估

对于 `exomind-devlog` 这类开发日志仓库：

- **高风险**：当前 HEAD 中的 JSON 文件内容——公开可读，搜索引擎可能已索引
- **中风险**：悬空对象（force push 后）——需知道旧 SHA，而旧 SHA 出现在 Events API push 事件中，有效期 30 天
- **低风险**：已接收邮件通知的关注者——取决于仓库关注者数量，通常开发日志仓库关注者有限
- **最低风险**：Wayback Machine——除非有人手动触发保存，小型 devlog 仓库自动抓取频率极低

---

## 三、处置方案（完整命令）

> **重要前置声明**：以下命令仅为处置方案描述，按约束不在真实仓库执行。执行前须先完成第二阶段的全面定位，确认所有敏感内容的确切位置和文本内容。

### 3.1 阶段一：定位确认（执行前必做）

```bash
# 克隆 devlog 仓库（本地操作更可靠）
git clone https://github.com/exomind-team/exomind-devlog.git
cd exomind-devlog

# 找出所有含关键词的 commit
git log --oneline --all -S "黎老师"
git log --oneline --all -S "与黎老师"
git log --oneline --all -S "NARS翻译"

# 查看具体是哪个文件、哪些行（示例：假设命中了 commit abc1234）
git show abc1234 -- "*.json" | grep -C3 "黎老师"

# 当前工作区检查
git grep "黎老师"
git grep -l "NARS.*翻译\|翻译.*NARS"
```

**记录以下信息后再进入下一阶段**：
- 含敏感内容的文件路径（如 `routes/2026/2026-03-15.json`）
- 敏感文本的精确原文（包括所有变体，如有多处）
- 涉及的 commit SHA 列表

### 3.2 阶段二：构造替换规则文件

根据定位结果，构造 `git filter-repo --replace-text` 使用的规则文件。

**规则文件格式**：`<敏感原文>==><替换后文本>`（每行一条）

```bash
cat > /tmp/nars-rules.txt << 'EOF'
与黎老师交流NARS翻译问题==>NARS术语翻译问题研究
与黎老师交流 NARS 翻译问题==>NARS 术语翻译问题研究
与黎老师交流数学/法律领域的 NARS 翻译问题并沉淀术语结论==>NARS 术语翻译问题研究与沉淀
黎老师==>领域专家
EOF
```

**替换原则**：
- ✅ 保留技术语义（NARS、翻译问题、术语沉淀），只去除人名/称谓
- ✅ 覆盖所有已知变体（带/不带空格、完整句/片段）
- ✅ 替换后文本不为空（空字符串会破坏 JSON 结构）
- ✅ 优先覆盖最完整的长句，避免短句规则漏匹配长句中的同一内容

### 3.3 阶段三：执行 git filter-repo 重写历史

```bash
# 确保已安装 git-filter-repo
pip install git-filter-repo
# 或：pip3 install git-filter-repo
# 验证：git filter-repo --version

# 进入克隆目录（filter-repo 要求在仓库根目录）
cd /path/to/exomind-devlog

# 执行历史重写（对所有分支、所有 commit、所有文件内容）
git filter-repo \
  --replace-text /tmp/nars-rules.txt \
  --force

# ⚠️ 重要：filter-repo 执行后会自动移除所有 remote 配置
# 必须重新添加 remote
git remote add origin https://github.com/exomind-team/exomind-devlog.git
```

**参数说明**：
- `--replace-text /tmp/nars-rules.txt`：按规则文件对所有 blob 内容做文本替换
- `--force`：允许在非全新克隆的仓库上运行（filter-repo 默认要求全新克隆作为保护措施）

### 3.4 阶段四：本地验证（force push 前必做）

```bash
# 验证 1：检查所有历史中是否还有敏感内容
git log --oneline --all -S "黎老师"
# 期望输出：（空，无任何结果）

git log --oneline --all -S "与黎老师"
# 期望输出：（空）

git log --oneline --all -S "NARS翻译"
# 期望输出：（空，因为已替换为"NARS 术语翻译问题研究"）

# 验证 2：检查当前工作区
git grep "黎老师"
# 期望输出：（空）

# 验证 3：抽查替换后内容的语义是否合理（JSON 格式是否完整）
git log --oneline -10
git show HEAD -- <含敏感内容的文件路径> | head -50
# 确认 JSON 格式正确，替换后文本语义通顺
```

**仅当以上所有验证均通过（无残留），才继续执行 force push。**

### 3.5 阶段五：Force Push

```bash
# 推送所有分支（devlog 仓库通常只有一个主分支）
git push --force origin main

# 若仓库有多个分支（如 gh-pages），需逐一处理
git push --force origin gh-pages

# 若不确定分支列表
git branch -a
git push --force origin --all
```

**⚠️ 注意事项**：
- Force push 会重写远端历史，所有其他 clone 的副本将无法正常 fast-forward，需要重新克隆
- 若仓库有其他协作者，需提前告知
- Force push 后 GitHub 不会立即 GC 悬空对象，旧 SHA 仍可访问约 90 天

### 3.6 阶段六：远程验证

```bash
# 通过 GitHub API 直接检查远端文件内容（绕过本地缓存）
# 替换 <file-path> 为实际含敏感内容的文件路径
gh api "repos/exomind-team/exomind-devlog/contents/<file-path>" \
  --jq '.content' | base64 -d | grep "黎老师"
# 期望输出：（空，无残留）

# 通过代码搜索验证（注意：搜索索引有延迟，不是实时的）
gh search code --repo exomind-team/exomind-devlog "黎老师"
# 期望：搜索索引更新后无结果（可能需要等待数天）

# 直接通过 curl 访问 raw 文件（验证 HEAD）
curl -s "https://raw.githubusercontent.com/exomind-team/exomind-devlog/main/<file-path>" \
  | grep "黎老师"
# 期望输出：（空）
```

### 3.7 阶段七：联系 GitHub Support（可选，针对悬空对象）

若对 90 天 GC 窗口存在顾虑，通过以下方式申请提前清除：

1. 访问 [GitHub Privacy Request](https://support.github.com/contact/privacy)
2. 说明情况：仓库已做 force push 重写历史，旧 commit 包含个人身份信息（PII），请求立即执行 GC 清除悬空对象
3. 提供仓库地址：`https://github.com/exomind-team/exomind-devlog`

---

## 四、主库 exomind-team/exomind 排查

devlog JSON 文件中的内容通常来自主库的 issue 标题或 commit message 的自动同步。需排查主库是否同样存有该内容。

### 4.1 主库 Issues 排查

```bash
# 搜索 issue 标题/正文
gh search issues --repo exomind-team/exomind "黎老师" --json number,title,body
gh search issues --repo exomind-team/exomind "NARS翻译" --json number,title,body

# 若命中，执行 Issue 清除流程：混淆 → 确认 → 删除
gh issue edit <N> --repo exomind-team/exomind --title "?" --body "?"
gh issue view <N> --repo exomind-team/exomind --json title,body  # 确认混淆成功
gh issue delete <N> --repo exomind-team/exomind --yes
```

### 4.2 主库代码/文件排查

```bash
gh search code --repo exomind-team/exomind "黎老师"
```

若命中，按与 devlog 相同的流程执行 filter-repo 历史重写。

---

## 五、扩展扫描（处置后执行）

以「黎老师」为核心，向外排查关联隐私风险。

### 5.1 扩展关键词扫描（devlog + 主库）

```bash
for kw in "老师" "同学" "导师" "师兄" "师姐" "黎" "周末计划" "约好" "见面"; do
  result=$(gh search issues --repo exomind-team/exomind-devlog "$kw" \
    --json number,title 2>&1)
  [ "$result" != "[]" ] && echo "[$kw] $result"
done

for kw in "老师" "同学" "导师" "周末计划" "约好"; do
  result=$(gh search issues --repo exomind-team/exomind "$kw" \
    --json number,title 2>&1)
  [ "$result" != "[]" ] && echo "[$kw] $result"
done
```

### 5.2 devlog JSON 文件全量扫描

```bash
cd /path/to/exomind-devlog  # 已 force push 后重新 clone
for kw in "老师" "同学" "师兄" "导师" "周末计划" "约好" "黎"; do
  result=$(git grep -l "$kw" -- "*.json" "*.html" 2>/dev/null)
  [ -n "$result" ] && echo "[$kw] $result"
done
```

---

## 六、标准清除报告模板

处置完成后，填写以下报告并归档。

```markdown
## 隐私泄露处置报告 - 2026-04-02

**泄露内容**：devlog JSON 文件中包含「黎老师」（真实人物称谓）及具体交流内容
**敏感等级**：L1（真实人名/称谓）+ L3（内部研究内容）
**处置优先级**：P0

### 暴露面清单

| 位置 | 内容片段 | 处置结果 |
|------|----------|----------|
| exomind-devlog/<文件路径> | 「与黎老师交流NARS翻译问题」 | ✅ filter-repo 替换 + force push |
| exomind-devlog Git 历史（所有 commit） | 同上 | ✅ filter-repo 已重写 / 🟠 悬空对象 ~90天窗口 |
| exomind 主库 issues（若存在） | 同上 | ✅ 已混淆删除 / ➖ 未命中 |
| GitHub Events API | push 事件含旧 SHA | 🟠 30天窗口内可访问，无法主动清除 |
| GitHub 代码搜索索引 | 已索引旧内容 | 🟠 数天~数周自然失效 |
| Wayback Machine | 未确认 | ➖ 待核查 |

### 验证结果

| 验证项 | 结果 |
|--------|------|
| 本地 `git log -S "黎老师"` | ✅ 无残留 |
| 本地 `git grep "黎老师"` | ✅ 无残留 |
| 远程 API 文件内容检查 | ✅ 无残留 |
| `gh search code` | ⏳ 待索引更新后确认 |

### 注意事项

- 悬空对象（force push 前的旧 commit）在 ~90 天 GC 窗口内仍可通过旧 SHA 直接访问。若需提前清除，联系 GitHub Support 提交 Privacy Request。
- Events API 中的 push 事件包含旧 commit SHA，30天内仍在窗口。实际风险：需主动查询且知道仓库地址。
- 已接收 push 通知的仓库关注者无法撤回通知，但 devlog 仓库关注者通常有限。
```

---

## 七、关键注意事项汇总

1. **替换规则覆盖度是成败关键**：执行 filter-repo 前，必须通过 `git log -S` 找出所有变体（带/不带空格、完整句/缩写），并全部写入规则文件，避免遗漏。

2. **filter-repo 会移除 remote**：执行后必须立即重新 `git remote add origin ...`，否则 push 命令无法执行。

3. **local 验证先于 force push**：`git log -S` 和 `git grep` 均无结果后，才执行 force push。

4. **GitHub Pages 需单独处理**：若 devlog 仓库启用了 GitHub Pages（如 `gh-pages` 分支或 `docs/` 目录），该分支同样需要重写或重新生成，静态 HTML 中也可能包含敏感内容。

5. **90 天悬空对象窗口**：这是 GitHub 平台的不可完全消除的残留，属于已知风险，通过联系 Support 可缩短窗口。

6. **处置后不要立即关闭告警**：扩展扫描（阶段四）应在 filter-repo + force push 完成后执行，确认没有遗漏的关联隐私点。
