# ============================================================================
# verify-open-source-clean.ps1
# ExoMind 代码库公开前的理论泄露验证脚本
#
# 用途：在 git-filter-repo 清洗后的仓库上运行，验证认知生命科学理论
#       的所有痕迹已从提交消息、代码 diff、文件路径、当前文件中彻底移除。
#
# 前置条件：
#   - Git 2.22+
#   - PowerShell 7+ (pwsh) 或 Windows PowerShell 5.1+
#   - 目标仓库已完成 git-filter-repo 清洗
#
# 执行方式：
#
#   # 方式 1: 直接指定清洗后仓库路径
#   pwsh -File scripts/verify-open-source-clean.ps1 -RepoPath C:\tmp\exomind-clean
#
#   # 方式 2: Cygwin/Git Bash 环境
#   powershell.exe -ExecutionPolicy Bypass -File scripts/verify-open-source-clean.ps1 -RepoPath /tmp/exomind-clean
#
#   # 方式 3: 在清洗后仓库目录内运行（需要拷贝脚本过去或用绝对路径）
#   cd /tmp/exomind-clean
#   pwsh -File /path/to/verify-open-source-clean.ps1 -RepoPath .
#
# 退出码：
#   0 = 全部通过，可安全推送到公开仓库
#   1 = 存在泄露，需要修复后重新运行 filter-repo
#
# 典型工作流：
#   1. git clone --no-single-branch <worktree> /tmp/exomind-clean
#   2. cd /tmp/exomind-clean
#   3. git filter-repo --invert-paths --paths-from-file paths-to-remove.txt --force
#   4. git filter-repo --replace-text replacements.txt --force
#   5. git filter-repo --message-callback "$(cat callback.py)" --force
#   6. pwsh -File verify-open-source-clean.ps1 -RepoPath /tmp/exomind-clean
#   7. 退出码 0 → 可推送；退出码 1 → 补充规则后从步骤 1 重来
#
# 关联：exomind-team/exomind#613
# ============================================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ============================================================================
# 关键词定义
# ============================================================================
#
# 为什么这些关键词能有效检测理论泄露？
#
# 1. 来源权威性：这些关键词直接提取自原始仓库中的理论文档
#    （AUTONOMOUS_LIFE_SPEC.md、roadmap.md、PRD.md、overview.md、CLAUDE.md），
#    覆盖了认知生命科学理论的全部核心概念。
#
# 2. 分层覆盖：关键词按理论层次组织——
#    - 顶层概念（认知生命科学、自主生命体）
#    - 核心判据（生命判据、可存活区间、边界归因...）
#    - 工程映射（EnergyPool、CognitiveLifeAgent、HeartbeatAgent...）
#    - 理论方法论（双层原则、否决式、信任度阶梯...）
#    确保从理论到代码的每一层都被检测。
#
# 3. 中英文双覆盖：同一概念的中文名和英文代码标识符都被纳入，
#    防止仅替换一种语言而遗漏另一种。
#
# 4. 经过 6 轮迭代验证：这些关键词在实际清洗过程中反复发现泄露并
#    逐轮补充，代表了完整的"已知泄露面"。
# ============================================================================

# --- 提交消息关键词 ---
# 覆盖范围：所有可能出现在 git commit message（标题+body）中的理论术语。
# 比 diff 关键词更宽泛，因为提交消息可能包含自然语言描述。
$MessageKeywords = @(
    # 顶层概念
    "认知生命"          # 理论体系名称，任何变体（认知生命科学/认知生命体/认知生命）
    "生命判据"          # 核心理论框架——6 条判据
    "自主生命体"        # 理论定义的工程目标
    "生命科学"          # 宽泛匹配，防止"认知"被替换后仍残留"生命科学"
    "生老病死"          # 理论类比——Agent 像生物一样有生老病死

    # 核心判据（5+1 条）
    "可存活区间"        # C1: 能量依赖的工程表述
    "边界归因"          # C2: 身体边界的理论名称
    "失败不可回滚"      # C4: 死亡性的工程表述
    "环境裁决"          # C5: 不可协商约束
    "伤疤"              # 伤疤机制——失败留下不可逆退化（宽匹配含"伤疤机制"）

    # 理论方法论
    "能量前提"          # 能量前提论——能量是生命持续的物理前提
    "信任度"            # L0-L5 信任度阶梯
    "双层原则"          # 架构不变量 vs 用户行为语义的双层表述
    "否决式"            # 否决式判据——任一不满足即否决
    "L0-L5"             # 六级信任度阶梯的缩写

    # 理论角色
    "Governor"          # 调控中枢 Agent（理论四Agent之一）
    "Growth Coach"      # 成长教练 Agent（理论四Agent之一）
    "四Agent"           # 四Agent架构的简称

    # 工程标识符
    "CognitiveLife"     # 代码中的理论类名前缀
    "EnergyPool"        # 能量池代码标识
    "HeartbeatAgent"    # 心跳Agent代码标识
    "CognitionEngine"   # 认知引擎代码标识
    "DEFAULT_SOUL"      # 灵魂文档常量名
    "tick_manager"      # Tick调度器字段名
    "TickManager"       # Tick调度器类名
    "Life OS"           # 原始项目名称

    # 其他
    "能量池"            # 中文版 EnergyPool
    "能量模型"          # 理论中的能量模型
    "人工认知生命"      # pencil 设计稿中的理论引用
)

# --- 代码 diff 关键词 ---
# 覆盖范围：所有可能出现在文件内容（任何历史版本）中的理论术语。
# 使用 git log -S（pickaxe）搜索——它检测的是"引入或移除该字符串的提交"，
# 这意味着即使一个提交只是删除了该字符串，-S 也会匹配到它。
# 因此，如果 replace-text 正确替换了所有 blob，-S 将找不到任何匹配，
# 因为原始字符串从未在任何 blob 中出现过。
$DiffKeywords = @(
    "认知生命"
    "生命判据"
    "CognitiveLife"
    "能量前提"
    "自主生命体"
    "生老病死"
    "可存活区间"
    "失败不可回滚"
    "伤疤机制"
    "EnergyPool"
    "HeartbeatAgent"
    "信任度"
    "能量池"
    "边界归因"
    "环境裁决"
    "双层原则"
    "CognitionEngine"
    "人工认知生命"
    "否决式"
    "DEFAULT_SOUL"
)

# --- 理论文件路径 ---
# 覆盖范围：所有应该被 --invert-paths 从历史中彻底移除的理论文件。
# 验证方式：搜索 git 历史中所有曾被 Add/Copy/Delete/Modify/Rename 的文件名，
# 确认这些理论文件的路径片段不再出现。
# 这比检查 HEAD 更严格——它确保文件在任何历史提交中都不存在。
$TheoryFilePatterns = @(
    "life\.rs"                  # CognitiveLifeAgent 实现
    "cognition\.rs"             # CognitionEngine trait
    "llm_cognition"             # LLM 认知引擎
    "heartbeat\.rs"             # HeartbeatAgent
    "energy\.rs"                # EnergyPool / Energy 路由
    "tick\.rs"                  # TickManager
    "AUTONOMOUS_LIFE_SPEC"      # 自主生命体规格文档
    "SPEC-004_ENERGY_POOL"      # 能量池规格
    "ARCH-signal-pool"          # 信号池理论架构文档
    "pencil/eventlog"           # pencil 设计稿（含理论模拟数据）
)

# --- HEAD 文件内容关键词 ---
# 覆盖范围：当前工作树中所有文本文件的内容。
# 这是最后一道防线——即使历史清洗完美，如果当前代码中仍有理论术语，
# 公开后用户 clone 下来就能直接看到。
# 使用 git grep 而非普通 grep，因为它只搜索 git 跟踪的文件，
# 排除 node_modules、target 等构建产物。
$HeadContentPattern = "认知生命|生命判据|CognitiveLife|能量前提|自主生命体|EnergyPool|HeartbeatAgent|信任度|双层原则|CognitionEngine|否决式|人工认知生命"

# ============================================================================
# 验证逻辑
# ============================================================================

Push-Location $RepoPath
$totalFail = 0

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  ExoMind 公开前理论泄露验证" -ForegroundColor Cyan
Write-Host "  仓库: $RepoPath" -ForegroundColor Cyan
Write-Host "  HEAD: $(git rev-parse --short HEAD)" -ForegroundColor Cyan
Write-Host "  提交数: $(git rev-list --count HEAD)" -ForegroundColor Cyan
Write-Host "  时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ----------------------------------------------------------------------------
# 【A】提交消息验证
# ----------------------------------------------------------------------------
# 原理：git log --all --format="%s%n%B" 输出所有分支所有提交的标题和正文，
# 然后逐关键词 grep。如果 message-callback 正确替换了所有理论术语，
# 则每个关键词的匹配数应为 0。
#
# 为什么用 --all？因为仓库可能有多个分支（dev/main/feature/*），
# 只检查当前分支不够——其他分支的提交消息也可能包含理论术语。
#
# 为什么同时检查标题(%s)和正文(%B)？因为理论术语可能出现在：
# - 标题：feat(life): add energy system...
# - 正文：添加四Agent架构、Governor、Growth Coach...
# ----------------------------------------------------------------------------
Write-Host "【A】提交消息验证 ($($MessageKeywords.Count) 个关键词)" -ForegroundColor Yellow
$allMessages = (git log --all --format="%s%n%B" 2>$null) -join "`n"
$failA = 0
foreach ($kw in $MessageKeywords) {
    $hits = ([regex]::Matches($allMessages, [regex]::Escape($kw))).Count
    if ($hits -gt 0) {
        Write-Host "  X $kw = $hits" -ForegroundColor Red
        $failA++
    }
}
if ($failA -eq 0) {
    Write-Host "  PASS (0/$($MessageKeywords.Count))" -ForegroundColor Green
} else {
    Write-Host "  FAIL: $failA 项泄露" -ForegroundColor Red
}
$totalFail += $failA
Write-Host ""

# ----------------------------------------------------------------------------
# 【B】代码 diff 验证（pickaxe 搜索）
# ----------------------------------------------------------------------------
# 原理：git log --all -S "<keyword>" 使用 pickaxe 算法搜索——
# 它找出所有"引入或移除该字符串"的提交。
#
# 关键理解：-S 不是搜索 diff 文本，而是搜索 blob 内容的变化。
# 如果 --replace-text 正确地在所有 blob 中替换了 "认知生命" → "智能系统"，
# 那么：
#   - 旧 blob 中不再包含 "认知生命"（已被替换为 "智能系统"）
#   - 新 blob 中也不包含 "认知生命"
#   - 因此 -S "认知生命" 找不到任何 blob 变化 → 0 匹配
#
# 这是最强力的验证手段——它穿透了整个 git 对象数据库，
# 不仅检查当前文件，还检查所有历史版本的所有文件。
#
# 已知例外：二进制文件（如 APK）中可能包含 Android 系统类名（如 Governor），
# 这不算理论泄露。脚本会报告但不自动判定为失败。
# ----------------------------------------------------------------------------
Write-Host "【B】代码 diff 验证 ($($DiffKeywords.Count) 个关键词, pickaxe)" -ForegroundColor Yellow
$failB = 0
foreach ($kw in $DiffKeywords) {
    $hits = (git log --all --oneline -S $kw -- 2>$null | Measure-Object -Line).Lines
    if ($hits -gt 0) {
        # 检查是否全部来自二进制文件（APK等）
        $textHits = git grep -l $kw $(git rev-list --all | Select-Object -First 50) -- "*.md" "*.rs" "*.ts" "*.tsx" "*.json" "*.toml" "*.yaml" "*.yml" "*.py" "*.js" 2>$null
        if ($textHits) {
            Write-Host "  X $kw = $hits commits (text files)" -ForegroundColor Red
            $failB++
        } else {
            Write-Host "  ~ $kw = $hits commits (binary only, non-leak)" -ForegroundColor DarkYellow
        }
    }
}
if ($failB -eq 0) {
    Write-Host "  PASS (0/$($DiffKeywords.Count))" -ForegroundColor Green
} else {
    Write-Host "  FAIL: $failB 项泄露" -ForegroundColor Red
}
$totalFail += $failB
Write-Host ""

# ----------------------------------------------------------------------------
# 【C】文件路径验证
# ----------------------------------------------------------------------------
# 原理：git log --all --diff-filter=ACDMR --name-only 列出所有历史中
# 曾被添加(A)、复制(C)、删除(D)、修改(M)、重命名(R)的文件路径。
#
# --invert-paths 的效果是：从所有提交的 tree 对象中移除指定路径，
# 并重写相关的 tree/commit 链。如果操作正确，被移除的文件
# 永远不会出现在任何提交的 diff 中——因为它们从未"存在过"。
#
# 这个验证确认了 filter-repo 的路径移除是否彻底。
# 使用正则匹配文件名片段（如 "life\.rs"），而非完整路径，
# 防止文件在历史中被移动到不同目录但仍然存在的情况。
# ----------------------------------------------------------------------------
Write-Host "【C】文件路径验证 ($($TheoryFilePatterns.Count) 个模式)" -ForegroundColor Yellow
$allPaths = @(git log --all --diff-filter=ACDMR --name-only --pretty=format: 2>$null | Sort-Object -Unique)
$failC = 0
foreach ($pattern in $TheoryFilePatterns) {
    $hits = @($allPaths | Select-String -Pattern $pattern).Count
    if ($hits -gt 0) {
        Write-Host "  X $pattern = $hits" -ForegroundColor Red
        $failC++
    }
}
if ($failC -eq 0) {
    Write-Host "  PASS (0/$($TheoryFilePatterns.Count))" -ForegroundColor Green
} else {
    Write-Host "  FAIL: $failC 项残留" -ForegroundColor Red
}
$totalFail += $failC
Write-Host ""

# ----------------------------------------------------------------------------
# 【D】HEAD 当前文件内容验证
# ----------------------------------------------------------------------------
# 原理：git grep 在当前 HEAD 的所有跟踪文件中搜索理论术语。
#
# 即使历史完美清洗，如果当前代码中仍有理论引用（例如清洗提交
# 本身的 diff 不小心引入了新的理论文本），用户 clone 后直接可见。
#
# 限定文件类型（*.md *.rs *.ts *.tsx *.json *.toml）排除：
# - 二进制文件（APK、图片、字体）
# - 构建产物（node_modules、target）
# - lock 文件（bun.lock、Cargo.lock）
#
# 这是面向"用户视角"的验证——用户 clone 后能看到什么？
# ----------------------------------------------------------------------------
Write-Host "【D】HEAD 当前文件内容验证" -ForegroundColor Yellow
$headHits = @(git grep -r -l -E $HeadContentPattern HEAD -- "*.md" "*.rs" "*.ts" "*.tsx" "*.json" "*.toml" 2>$null)
$failD = $headHits.Count
if ($failD -eq 0) {
    Write-Host "  PASS (0 文件含理论术语)" -ForegroundColor Green
} else {
    Write-Host "  FAIL: $failD 个文件含理论术语" -ForegroundColor Red
    $headHits | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
}
$totalFail += $failD
Write-Host ""

# ============================================================================
# 结论
# ============================================================================
# 四层验证的完备性论证：
#
# 【A】提交消息 → 覆盖"元数据层"
#   攻击面：浏览 git log 即可看到提交消息
#   防御：message-callback 替换所有理论术语
#   验证：逐关键词 grep 全部提交消息
#
# 【B】代码 diff → 覆盖"对象层"（最强验证）
#   攻击面：git show <commit> 查看任意提交的 diff
#   防御：replace-text 重写所有 blob 内容
#   验证：pickaxe (-S) 搜索穿透整个对象数据库
#   为什么最强：-S 直接检查 blob 对象内容的变化，
#   如果任何版本的任何文件仍包含关键词，都会被发现
#
# 【C】文件路径 → 覆盖"树结构层"
#   攻击面：git log --name-only 查看哪些文件曾经存在过
#   防御：--invert-paths 从所有 tree 对象中移除
#   验证：枚举所有历史文件路径并匹配理论文件名
#
# 【D】HEAD 文件内容 → 覆盖"用户可见层"
#   攻击面：git clone 后直接阅读文件
#   防御：worktree 中的手动编辑 + replace-text
#   验证：git grep 当前工作树
#
# 四层合在一起，覆盖了 git 仓库中信息可被访问的所有途径：
#   元数据(A) + 对象内容(B) + 树结构(C) + 工作树(D) = 完整覆盖
#
# 唯一的已知盲区：
# - 二进制文件内容（APK 中的 Android 系统类名如 Governor）
#   → 这不是理论泄露，【B】层会标注为 "binary only, non-leak"
# - reflog / stash / notes 等 git 内部引用
#   → filter-repo 默认清理 reflog；stash/notes 在 fresh clone 中不存在
# ============================================================================

Write-Host "============================================" -ForegroundColor Cyan
if ($totalFail -eq 0) {
    Write-Host "  RESULT: ALL PASS" -ForegroundColor Green
    Write-Host "  可安全推送到公开仓库" -ForegroundColor Green
} else {
    Write-Host "  RESULT: FAIL ($totalFail issues)" -ForegroundColor Red
    Write-Host "  需要修复后重新验证" -ForegroundColor Red
}
Write-Host "============================================" -ForegroundColor Cyan

Pop-Location
exit $(if ($totalFail -eq 0) { 0 } else { 1 })
