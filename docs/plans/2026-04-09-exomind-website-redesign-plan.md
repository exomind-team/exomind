# ExoMind 实验版官网改进实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 将现有 ExoMind Astro 官网复制到实验目录，基于 `exomind-content-design-principles.md` 八条原则进行内容层 + 结构层改进，验证通过后浏览器打开验收。

**Architecture:** 基于现有 Astro 5.5 项目，复制到 `temp/exomind-website-v2/`，对首页/下载页/about页进行内容与结构改进，参考 LazyTyper 布局节奏，全项目 `bun dev` 本地验证。

**Tech Stack:** Astro 5.5 + Tailwind CSS + 内联 SVG + 自定义 i18n（zh/en）

---

## 准备工作

### Task 0: 复制 Astro 项目到实验目录

**执行命令：**
```bash
cd H:/A137442/Develop/AGI/exomind
mkdir -p temp
cp -r website temp/exomind-website-v2
```

**验证：**
```bash
ls temp/exomind-website-v2/
# 预期：package.json / astro.config.mjs / src/ / public/ / content/
```

---

## 改进区块分解（可并行）

### Task 1: 首页 index.astro 全面改进

**文件：** `temp/exomind-website-v2/src/pages/index.astro`

**改动内容：**

#### 1.1 Hero 重写（原则一叙事身份 + 原则二痛点先行）

**当前（需要改）：**
```
标题: 你的生命成长助手
副标题: 用 AI 帮你记录、反思、成长。掌控自己的生命过程。
```

**新 Hero（叙事身份 C——"不过疲倦的生命教练"）：**
```
标签: 开源 · 本地优先 · AI 驱动
标题: 不过疲倦的生命教练，帮你看清每天发生了什么
副标题: 每天结束，你对自己这一天一无所知。ExoMind 是那个一直在线的记忆搭档——它记得你这一周真正在做什么，而不是你以为你在做什么。
```

**新 Hero 参考 LazyTyper 结构：** Badge + H1 + Sub + 双 CTA（主CTA 下载 + 次CTA 了解更多）

#### 1.2 痛点感知区块（新增，原 Hero 下方）

参考竞品 LazyTyper 的问题感知层，新增一个区块：

```
副标题: 你有没有这种感觉？
问题卡片（三选一）：
- "每天忙，但周末想不起来这周做了什么"
- "学了很多，但下周全忘光了"
- "AI 每次都是新对话，没有记忆"
```

#### 1.3 功能区升 L3（原则四）

**六功能 Before/After（逐条应用）：**

| 功能 | 当前（L1-L2） | 改进后（L3） |
|------|-------------|-------------|
| 事件日志 | "像写日记一样记录生活..." | "你不需要每天都写总结。ExoMind 会从你这一周的事件里挑出最重要的——某天深夜的那通电话、某个下午突然冒出来的想法——不会消失，不会被覆盖。" |
| 时间块 | "专注计时器 + 能量管理..." | "你知道自己周一上午效率最高吗？ExoMind 会从你的时间块历史里告诉你——然后帮你把最难的工作留到那个时候。" |
| AI 智能体 | "个性化的 AI 助手..." | "你不需要每次都从头解释你的背景。ExoMind 记得你是谁，在你卡住的时候——不是给你正确答案，而是给你一个你可能忘了的方向。" |
| 本地优先 | "数据存储在你的设备上..." | "你的记录不经过任何服务器。如果哪天服务器关了，你的每一行记录都还在你的设备里——不是云备份，是真的在你这里。" |
| 任务系统 | "不只是待办清单..." | "大多数待办清单只负责提醒你还有什么没做。ExoMind 会告诉你上周完成了什么，以及为什么那个目标没有完成，下次怎么调整。" |
| 全平台支持 | "Windows、macOS..." | "在公司用 Windows 回了一条灵感，回家打开 MacBook 继续写——不用同步，不用发给自己，ExoMind 已经在那里等你了。" |

#### 1.4 叙事节奏曲线设计（新增）

参考 LazyTyper 五段节奏，在功能区添加情感升华区块：
```
标题: 不是记录，是留下痕迹
描述: ExoMind 的时间轴是单向的。每个操作都留下了痕迹，你无法假装它没发生过。某天你会感谢今天写下的每一行。
```

#### 1.5 Social Proof 区块（新增，原则七）

参考 LazyTyper，在隐私区块下方添加：
```
标题: 已经在用 ExoMind 的人
GitHub Stars: [显示 ExoMind GitHub 仓库 star 数量]
用户数/事件数: [如果有真实数据就用，没有则用占位文案]
截图: [Now 页面截图，如果有的话]
```

#### 1.6 版本号更新

页面底部或 Hero 附近标注 `v0.4.5`（当前显示的是 v0.3.5）

---

### Task 2: 下载页 download.astro 改进

**文件：** `temp/exomind-website-v2/src/pages/download.astro`

**改动内容：**

#### 2.1 Hero 语态统一（原则一）

**当前：**
```
标题: 开始你的成长之旅
副标题: 免费下载，本地运行，数据完全属于你
```

**改进：**
```
标题: 下载 ExoMind，开始掌控你的每一天
副标题: v0.4.5 · 四大平台 · 完全免费 · 本地运行
```

#### 2.2 OS 选择卡片（参考 LazyTyper 三列/GoLutra 三卡片）

当前是文字链接列表，改进为四列卡片（Windows/macOS/Linux/Android），每张卡片含：
- 平台图标（内联 SVG）
- 平台名称
- 系统要求（一行）
- 下载按钮
- 架构选择（可选，如 x64/arm64）

#### 2.3 FAQ 防流失区块（新增，原则六）

**新增位置：** 下载按钮下方，版本历史之前

**四问：**
1. "我的数据会被保存到云端吗？" → 回答：本地优先，数据完全在本地
2. "没有网络的时候还能用吗？" → 回答：完全离线可用
3. "和其他笔记应用相比，ExoMind 有什么不同？" → 回答：AI 有记忆，理解你的习惯和目标
4. "我需要每天主动打开它吗？" → 回答：ExoMind 在后台运行，在你需要的时刻主动出现

#### 2.4 版本号更新

将当前显示的版本（需确认是 v0.3.5）更新为 `v0.4.5`

---

### Task 3: About 页面哲学叙事层（原则八）

**文件：** `temp/exomind-website-v2/src/pages/about.astro`

**改动内容：**

在现有 About 内容之后，新增一个"设计哲学"区块：

```
标题: 为什么 ExoMind 不可删除？
描述: 大多数应用把数据当作"用户可以随时删除的东西"。我们不这样认为。

你在 ExoMind 里写下的每一行记录，是你这段时间存在的证据——和照片、日记一样，有它存在的意义。所以我们把删除设计成"放弃"，而不是"清理"。
这不是限制，是你的选择。

三行设计原则（简化版 C1-C6）：
- C5 死亡性：永久删除 ExoMind 持有的数据 = 杀死它持续运行的记忆
- C6 不可回滚：每个操作都留下了痕迹，你无法假装它没发生过
- 持续运行：ExoMind 在你不在的时候，也在帮你整理
```

---

### Task 4: 功能页 features.astro 小改

**文件：** `temp/exomind-website-v2/src/pages/features.astro`

**改动内容：**

功能描述全部升到 L3（复用 Task 1 的六功能 L3 文案）

---

### Task 5: OG 标签补全

**文件：** `temp/exomind-website-v2/src/layouts/BaseLayout.astro`

**新增 head meta（参考 LazyTyper 的完整 OG 设置）：**
```html
<meta property="og:title" content="ExoMind — 不过疲倦的生命教练" />
<meta property="og:description" content="每天结束，你对自己这一天一无所知。ExoMind 帮你看清每天发生了什么，记住你是谁。" />
<meta property="og:image" content="/og-image.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="ExoMind — 不过疲倦的生命教练" />
<meta name="twitter:description" content="每天结束，你对自己这一天一无所知。ExoMind 帮你看清每天发生了什么。" />
<meta name="twitter:image" content="/og-image.jpg" />
```

**注意：** 需要一张 `/public/og-image.jpg`（可用现有截图或占位）

---

### Task 6: 英文版 i18n 同步

**文件：** `temp/exomind-website-v2/src/i18n/index.ts`

更新英文翻译键以匹配新中文 Hero 文案（如果英文页面也需要更新的话）

---

## 验证与启动

### Task 7: 构建验证

```bash
cd temp/exomind-website-v2
bun install
bun build
```

**预期：** 构建成功，0 错误

### Task 8: 启动 Dev 服务器

```bash
cd temp/exomind-website-v2
bun dev --host 0.0.0.0 --port 4321
```

**验证：**
```bash
curl -sS -D - -o /dev/null http://127.0.0.1:4321 | head -n 5
# 预期：HTTP 200
```

### Task 9: 浏览器打开

```python
import webbrowser
webbrowser.open('http://127.0.0.1:4321')
```

---

## 执行顺序

```
[Task 0] 复制项目
    ↓
[并行] Task 1（首页）+ Task 2（下载页）+ Task 3（About）+ Task 4（功能页）+ Task 5（OG标签）
    ↓
[Task 6] i18n 英文同步（可选，视时间）
    ↓
[Task 7] 构建验证
    ↓
[Task 8] 启动 Dev 服务器
    ↓
[Task 9] 浏览器打开 + 复核
```

---

## 文件修改清单

| 文件 | 改动类型 |
|------|---------|
| `src/pages/index.astro` | Hero 重写 + 新增区块（痛点/社会证明/情感升华） |
| `src/pages/download.astro` | OS 卡片 + FAQ 防流失 + 版本号 |
| `src/pages/about.astro` | 设计哲学区块 |
| `src/pages/features.astro` | 功能描述升 L3 |
| `src/layouts/BaseLayout.astro` | OG 标签 |
| `src/i18n/index.ts` | 英文翻译同步（可选） |

---

## 参考素材

- LazyTyper Hero 结构：`badge + h1 + sub + 双CTA + hero image`
- LazyTyper 五段节奏：`情绪锚点 → 理性证明 → 场景代入 → 社会证明 → FAQ兜底 → CTA`
- 内容设计原则文档：`docs/product/exomind-content-design-principles.md`
- 竞品分析报告：`docs/product/exomind-website-competitive-analysis.md`
