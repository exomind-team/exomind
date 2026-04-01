# Dev-Daily 技能维护手册

> **目标读者**：修改此技能的 Agent（包括未来的你）
> **用途**：避免重复翻车，确保修改后的技能正常工作

---

## 关键架构

### 双仓库架构

```
exomind 仓库（开发）
├── .claude/skills/dev-daily/
│   ├── assets/report-template.html  ← 完整模板（含渲染引擎）
│   ├── references/AGENTS.md         ← 方法论
│   └── references/prompt.md         ← 执行提示词

exomind-devlog 仓库（发布）
├── assets/
│   ├── report-engine.js             ← 渲染引擎（从模板提取）
│   └── report-style.css             ← 样式（从模板提取）
└── reports/
    ├── YYYY-MM-DD-HHmmss.json       ← 标准数据层
    ├── YYYY-MM-DD-HHmmss.html       ← loader HTML（仅含 dataFile + engine/style 引用）
    ├── latest.json                  ← 最新报告 JSON
    └── manifest.json                ← 发布索引（标准入口）
```

### 发布流程

1. Agent 生成完整 HTML → `temp/exomind-daily-report-*.html`
2. 发布脚本提取 `REPORT` → 生成 `reports/*.json`
3. 发布脚本生成 loader HTML → `reports/*.html`
4. 发布脚本刷新 `reports/latest.json` 与 `reports/manifest.json`
5. loader HTML 引用 `../assets/report-engine.js` 和 `../assets/report-style.css`
6. 推送到 GitHub Pages

---

## 翻车记录与防范

### 🔥 翻车 #1：渲染引擎未同步（2026-04-01）

**症状**：
- 本地 HTML 显示正常
- 发布到 GitHub Pages 后缺少"Issue 时效清点"模块
- 质量拦截测试通过，但发布后功能缺失

**根本原因**：
- 在 `report-template.html` 中添加了 `poolHealth` 渲染逻辑
- 但 `exomind-devlog/assets/report-engine.js` 没有同步更新
- 发布的 loader HTML 引用的是旧版本的渲染引擎

**为什么质量拦截没发现**：
- 质量拦截只检查本地完整 HTML 的数据完整性
- 不检查发布后的 loader HTML 是否能正确渲染

**防范措施**：

#### ✅ 必做：修改模板后同步渲染引擎

当你修改 `report-template.html` 中的渲染逻辑时（`// ╔══` 分隔线之后的代码），**必须**同步更新 `exomind-devlog/assets/report-engine.js`：

```bash
# 1. 提取渲染引擎代码
sed -n '/^\/\/ ╔══════════════════════════════════════════════════════════════════╗$/,/^<\/script>$/p' \
  .claude/skills/dev-daily/assets/report-template.html | sed '$d' \
  > ../exomind-devlog/assets/report-engine.js

# 2. 提交到 devlog 仓库
cd ../exomind-devlog
git add assets/report-engine.js
git commit -m "chore(devlog): sync report-engine.js from latest template"
git push origin main

# 3. 等待 GitHub Pages 构建（约 30 秒）
```

#### ✅ 必做：发布后验证

发布后，访问 GitHub Pages 链接，手动检查新功能是否显示：

```bash
# 等待 Pages 构建
sleep 30

# 检查新功能是否存在
curl -sS "https://exomind-team.github.io/exomind-devlog/reports/YYYY-MM-DD-HHmmss.html" \
  | grep "新功能关键词"
```

#### 🔮 未来改进：自动化同步

在 `scripts/dev/publish-devlog.ts` 中添加自动同步逻辑：

```typescript
// 在 main() 函数中，发布前先检查并更新渲染引擎
function syncRenderEngine(reportPath: string, devlogDir: string): boolean {
  const html = readFileSync(reportPath, 'utf-8');

  // 提取渲染引擎代码
  const engineStart = html.indexOf('// ╔══════════════════════════════════════════════════════════════════╗');
  const engineEnd = html.lastIndexOf('</script>');

  if (engineStart === -1 || engineEnd === -1) {
    throw new Error('无法提取渲染引擎代码');
  }

  const engineCode = html.substring(engineStart, engineEnd);
  const enginePath = join(devlogDir, 'assets', 'report-engine.js');

  // 检查是否需要更新
  const currentEngine = existsSync(enginePath) ? readFileSync(enginePath, 'utf-8') : '';
  if (currentEngine !== engineCode) {
    console.log('🔄 检测到渲染引擎更新，同步到 devlog 仓库...');
    writeFileSync(enginePath, engineCode, 'utf-8');
    git(devlogDir, 'add', 'assets/report-engine.js');
    git(devlogDir, 'commit', '-m', 'chore(devlog): sync report-engine.js from latest template');
    console.log('✓ 渲染引擎已更新');
    return true; // 需要额外推送
  }

  return false;
}
```

---

## 修改检查清单

当你修改 dev-daily 技能时，按以下清单检查：

### 📝 修改 AGENTS.md 或 prompt.md

- [ ] 更新数据采集命令
- [ ] 更新校验清单
- [ ] 更新质量红线
- [ ] 测试：生成一份日报，确保新规则生效

### 🎨 修改 report-template.html（数据结构）

- [ ] 在 `REPORT` 对象中添加新字段
- [ ] 更新 `publish-devlog.ts` 的 `validateReportCompleteness()` 函数，添加新字段的校验
- [ ] 测试：运行 `bun scripts/dev/publish-devlog.ts --dry-run`，确保质量拦截通过

### 🔧 修改 report-template.html（渲染逻辑）

- [ ] 修改 `// ╔══` 分隔线之后的渲染代码
- [ ] **关键**：提取渲染引擎代码，更新到 `exomind-devlog/assets/report-engine.js`
- [ ] 提交并推送 devlog 仓库
- [ ] 测试：生成并发布一份日报，访问 GitHub Pages 确认新功能显示

### 🚀 修改 publish-devlog.ts

- [ ] 更新质量拦截逻辑
- [ ] 更新 `reports/*.json` / `reports/*.html` / `reports/latest.json` / `reports/manifest.json` 生成逻辑
- [ ] 测试：运行 `bun scripts/dev/publish-devlog.ts --dry-run`

---

## 测试流程

### 完整测试（推荐）

```bash
# 1. 生成本地 HTML
bun run devlog:extract --type report  # 读取上期报告
# 手动生成日报或使用 dev-daily 技能

# 2. 语法检查
sed -n '/<script>/,/<\/script>/p' temp/exomind-daily-report-*.html | sed '1d;$d' > temp/check.js
node --check temp/check.js

# 3. 质量拦截测试
bun scripts/dev/publish-devlog.ts --report temp/exomind-daily-report-*.html --dry-run

# 4. 发布到 GitHub Pages
bun run devlog:publish

# 5. 等待构建并验证
sleep 30
curl -sS "https://exomind-team.github.io/exomind-devlog/reports/YYYY-MM-DD-HHmmss.html" | grep "关键功能"
```

### 快速测试（仅本地）

```bash
# 1. 生成日报
# 2. 在浏览器中打开本地 HTML
python3 -m http.server 8766 --bind 0.0.0.0 --directory temp &
termux-open-url "http://127.0.0.1:8766/exomind-daily-report-*.html"
```

---

## 常见问题

### Q: 为什么要用"JSON + loader HTML"而不是完整 HTML？

**A**:
- **优势**：数据与渲染分离，读取侧可以直接读 JSON，渲染引擎和样式也能共享
- **劣势**：需要同步两个仓库，容易出现本次这样的翻车

### Q: 能否合并两个仓库？

**A**:
- `exomind` 是开发仓库，包含完整代码
- `exomind-devlog` 是发布仓库，只包含日报和资源文件
- 分离的好处：devlog 仓库轻量，GitHub Pages 构建快

### Q: 如何确保不再翻车？

**A**:
1. **阅读此文档**：每次修改前先读这个文件
2. **遵循检查清单**：按清单逐项检查
3. **完整测试**：本地测试 + 发布测试
4. **自动化**：未来实现自动同步渲染引擎

---

## 版本历史

- v1.0 (2026-04-01): 初始版本，记录渲染引擎未同步翻车
