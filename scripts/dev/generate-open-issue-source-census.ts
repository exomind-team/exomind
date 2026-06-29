#!/usr/bin/env bun
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type GhLabel = { name: string };
type OpenIssue = {
  number: number;
  title: string;
  body?: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  labels: GhLabel[];
};
type Verdict =
  | 'strong code evidence'
  | 'partial code evidence'
  | 'relevant area exists, requirement still unproven'
  | 'no code evidence'
  | 'research/governance track';
type Confidence = 'high' | 'medium' | 'low';
type Category = 'workflow' | 'test' | 'website' | 'script' | 'backend' | 'ui' | 'service' | 'config' | 'other';
type CodeFile = { path: string; pathLower: string; contentLower: string; category: Category };
type Selector = { type: 'exact' | 'prefix' | 'contains'; value: string };
type Domain = { label: string; patterns: RegExp[]; selectors: Selector[] };
type Signals = {
  requirementText: string;
  explicitPaths: string[];
  routeTokens: string[];
  envTokens: string[];
  flagTokens: string[];
  identifierTokens: string[];
  titleSlugs: string[];
  scoreTokens: string[];
};
type Manual = { verdict: Verdict; confidence: Confidence; kind: string; summary: string; evidence: string[] };
type Row = {
  issue: OpenIssue;
  kind: string;
  verdict: Verdict;
  confidence: Confidence;
  summary: string;
  anchors: string[];
};

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'docs', 'analysis', '2026-04-10-open-issue-source-census.md');
const FALLBACK = path.join(ROOT, 'temp', 'open-issues-with-body.json');
const ALLOWED_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs', '.astro', '.json', '.toml', '.yml', '.yaml', '.ps1', '.sh', '.css', '.html', '.sql']);
const KEEP_SECTIONS = [/背景/i, /目标/i, /scope/i, /范围/i, /非目标/i, /预期/i, /目标行为/i, /验收/i, /dod/i, /验证/i, /任务/i, /边界/i, /^要做$/i, /^不做$/i, /完成条件/i, /依赖/i, /关联/i];
const DROP_SECTIONS = [/实际/i, /现状/i, /当前实现/i, /观察到的现象/i, /已验证/i, /未验证/i, /待补证据/i, /上下文检索/i, /关键路径/i, /代码取证/i, /已定决策/i];
const GENERIC_TOKENS = new Set(['agent', 'agents', 'api', 'app', 'bind', 'block', 'build', 'bug', 'canonical', 'chore', 'ci', 'copy', 'current', 'default', 'delete', 'design', 'dev', 'dialog', 'discussion', 'docs', 'download', 'embedded', 'fallback', 'feat', 'features', 'fix', 'get', 'github', 'goal', 'host', 'http', 'https', 'hub', 'ime', 'issue', 'json', 'mcp', 'mesh', 'now', 'page', 'pages', 'partial', 'patch', 'perf', 'phase', 'plan', 'post', 'preview', 'pty', 'put', 'refactor', 'release', 'runtime', 'script', 'scripts', 'settings', 'signal', 'spa', 'strategy', 'sync', 'tag', 'task', 'terminal', 'test', 'timeblock', 'token', 'uri', 'url', 'website', 'workbench', 'workflow', 'worker']);
const SPOTLIGHT = [260, 261, 458, 476, 706, 709, 886, 897, 900, 901, 902, 903, 904];

const DOMAINS: Domain[] = [
  {
    label: 'website / docs',
    patterns: [/website/i, /\bdocs\b/i, /getting-started/i, /features/i, /download page/i, /官网|文档|快速起步|功能简介|下载页/i],
    selectors: [
      { type: 'prefix', value: 'website/src/' },
      { type: 'prefix', value: 'tests/e2e/' },
      { type: 'exact', value: 'website/src/lib/docs.ts' },
      { type: 'exact', value: 'website/src/i18n/index.ts' },
    ],
  },
  {
    label: 'agent / pty / workbench',
    patterns: [/\bagent\b/i, /\bpty\b/i, /terminal/i, /workbench/i, /pane/i, /\bdialog\b/i, /window/i, /终端|工作台|窗格|平铺|会话/i],
    selectors: [
      { type: 'prefix', value: 'src/ui/app/pages/agents/' },
      { type: 'prefix', value: 'src/ui/app/components/Pty' },
      { type: 'prefix', value: 'tests/unit/ui/agent-hub/' },
      { type: 'prefix', value: 'crates/exomind-cli/' },
      { type: 'prefix', value: 'crates/exomind-runtime/src/pty/' },
      { type: 'prefix', value: 'crates/exomind-runtime/src/routes/pty' },
      { type: 'prefix', value: 'crates/exomind-runtime/src/routes/agents' },
      { type: 'prefix', value: 'crates/exomind-runtime/src/routes/agent_sessions' },
      { type: 'exact', value: 'src/ui/app/pages/AgentsPage.tsx' },
      { type: 'contains', value: 'workbench' },
    ],
  },
  {
    label: 'goal / task / timeblock',
    patterns: [/\bgoal\b/i, /\btask\b/i, /timeblock/i, /目标系统|目标|任务系统|任务|时间块|专注/i],
    selectors: [
      { type: 'contains', value: 'goal' },
      { type: 'contains', value: 'GoalsPage' },
      { type: 'contains', value: 'task' },
      { type: 'contains', value: 'timeblock' },
      { type: 'exact', value: 'src/lib/services/task.service.ts' },
      { type: 'exact', value: 'crates/exomind-runtime/src/routes/timeblocks.rs' },
    ],
  },
  {
    label: 'eventlog / reminder',
    patterns: [/eventlog/i, /\brecord\b/i, /reminder/i, /事件日志|记录页|提醒/i],
    selectors: [
      { type: 'contains', value: 'eventlog' },
      { type: 'contains', value: 'record' },
      { type: 'contains', value: 'reminder' },
      { type: 'exact', value: 'src/lib/services/reminder-scheduler.service.ts' },
      { type: 'exact', value: 'src/ui/app/components/ReminderNotifier.tsx' },
    ],
  },
  { label: 'settings / shortcut', patterns: [/settings/i, /shortcut/i, /hotkey/i, /设置|快捷键/i], selectors: [{ type: 'contains', value: 'settings' }, { type: 'contains', value: 'shortcut' }] },
  { label: 'voice / media', patterns: [/voice/i, /\basr\b/i, /\btts\b/i, /audio/i, /realtime/i, /语音|音频/i], selectors: [{ type: 'contains', value: 'voice' }, { type: 'contains', value: 'asr' }, { type: 'contains', value: 'tts' }, { type: 'contains', value: 'audio' }, { type: 'contains', value: 'realtime' }] },
  {
    label: 'tooling / dev-manager',
    patterns: [/dev-manager/i, /esm/i, /cjs/i, /\bbun\b/i, /vitest/i, /tauri manager/i, /incremental build/i, /构建产物|增量构建|脚本工具链|强制 esm|禁止 cjs/i],
    selectors: [
      { type: 'prefix', value: 'scripts/dev/tauri' },
      { type: 'prefix', value: 'scripts/test/' },
      { type: 'prefix', value: 'tests/unit/scripts/' },
      { type: 'exact', value: 'scripts/lib/pr-lock-api.ts' },
      { type: 'exact', value: 'package.json' },
      { type: 'exact', value: 'vitest.config.ts' },
      { type: 'exact', value: 'tests/setup.ts' },
    ],
  },
  {
    label: 'ci / release / distribution',
    patterns: [/\bci\b/i, /workflow/i, /runner/i, /required checks/i, /merge gate/i, /review/i, /release/i, /preview/i, /promotion/i, /version/i, /\btag\b/i, /distribution/i, /download/i, /mirror/i, /门禁|评审|构建|发布|版本|分发|下载|镜像|对象存储|onedrive/i],
    selectors: [
      { type: 'prefix', value: '.github/workflows/' },
      { type: 'prefix', value: 'tests/ci/' },
      { type: 'prefix', value: 'scripts/dev/release' },
      { type: 'exact', value: 'scripts/dev/build-tag.ts' },
      { type: 'exact', value: 'scripts/dev/sync-release-pages.ts' },
      { type: 'exact', value: 'package.json' },
      { type: 'exact', value: 'tsconfig.json' },
      { type: 'exact', value: 'website/src/lib/downloads-data.ts' },
      { type: 'exact', value: 'website/src/components/DownloadPageContent.astro' },
      { type: 'exact', value: 'src/lib/services/update.service.ts' },
    ],
  },
  {
    label: 'runtime / sync',
    patterns: [/\bruntime\b/i, /\brt\b/i, /\bsync\b/i, /replication/i, /mesh/i, /signal/i, /pair/i, /proposal/i, /auth/i, /port/i, /config/i, /websocket/i, /运行时|同步|复制|信号|配对|提案|端口|配置/i],
    selectors: [
      { type: 'prefix', value: 'crates/exomind-runtime/' },
      { type: 'prefix', value: 'src/lib/services/runtime' },
      { type: 'prefix', value: 'src/services/runtime' },
      { type: 'prefix', value: 'src/lib/services/signal' },
      { type: 'prefix', value: 'src/lib/services/runtime-mesh' },
      { type: 'prefix', value: 'src/lib/adapters/tauri-runtime' },
      { type: 'prefix', value: 'src/ui/hooks/' },
      { type: 'exact', value: 'src-tauri/src/commands/runtime_commands.rs' },
    ],
  },
];

const MANUAL: Record<number, Manual> = {
  260: { verdict: 'no code evidence', confidence: 'high', kind: 'ci / release / distribution', summary: '需求是 `dev` 分支 required checks + 失败阻断合并；当前仓库内没有可审计的 branch-protection/ruleset 配置，相关 PR workflow 也没有自动触发链路。', evidence: ['.github/workflows/pr-review.yml:3 `pull_request` 触发被注释，工作流只剩 `workflow_dispatch`。', '.github/workflows/runtime-ci.yml:3 `pull_request` 触发被注释，不构成自动 required check。', '.github/workflows/website-tests.yml:6 `pull_request` 触发被注释，不构成自动 required check。'] },
  261: { verdict: 'relevant area exists, requirement still unproven', confidence: 'high', kind: 'ci / release / distribution', summary: '自动评审 area 存在，但当前实现不是“评审先于构建且失败阻断 build”的门禁链路。', evidence: ['.github/workflows/pr-review.yml:13 仍是 `workflow_dispatch`，不是 PR 自动链路。', '.github/workflows/pr-review.yml:16 与 :60 的 review job 都设置了 `continue-on-error: true`。', '.github/workflows/pr-review.yml:137 与 :181 只有发评论 job `needs` review；没有任何 build job `needs` review。'] },
  458: { verdict: 'partial code evidence', confidence: 'high', kind: 'ci / release / distribution', summary: '发布链路有拆分动作和测试守卫，但 issue 要求的 workflow 进一步拆分、tsconfig exclude 收窄、clean 脚本与磁盘清理策略并未全部落地。', evidence: ['.github/workflows/release-pages.yml:1 Pages 发布已拆出独立 workflow。', '.github/workflows/release.yml:1 仍是单个超大主 workflow，没有 reusable workflow 分层。', 'tsconfig.json:32 仍排除 `src/lib/db/**`、`src/lib/ws/**`、`src/backend/**`。', 'package.json:5 没有项目级 `clean` script。', 'tests/ci/release-workflow-bun-install.test.ts:71 有 release workflow 静态测试守卫。'] },
  476: { verdict: 'relevant area exists, requirement still unproven', confidence: 'high', kind: 'tooling / dev-manager', summary: '仓库基线已转向 ESM，但“Scripts 工具链强制 ESM，禁止 CJS”这条硬约束没有真正成立。', evidence: ['package.json:5 仓库声明 `\"type\": \"module\"`。', 'package.json:41 仍直接调用多个 `.cjs` 脚本。', 'scripts/lib/pr-lock-api.ts:123 仍有 `require(\"child_process\")` 反例。'] },
  706: { verdict: 'partial code evidence', confidence: 'high', kind: 'ci / release / distribution', summary: '单一版本号、canonical `v0.x.y` tag、preview/release 元数据分流已经形成主链路，但“自动版本迭代机制”在当前代码里仍依赖人工执行 build-tag / push / promote 入口。', evidence: ['package.json:4、src-tauri/Cargo.toml:3、src-tauri/tauri.conf.json:4 三处版本号对齐。', 'scripts/dev/build-tag.ts:1 提供 canonical tag 构建入口，但仍需人工执行。', '.github/workflows/release.yml:4 与 :1431 处理 `v*` tag 与 promote 逻辑。', 'scripts/dev/release-pages-metadata-lib.ts:3 负责 preview/release Pages metadata 分流。', 'tests/ci/release-workflow-bun-install.test.ts:56 对旧 `build/` / `release/` tag 语义有回归守卫。'] },
  709: { verdict: 'partial code evidence', confidence: 'high', kind: 'ci / release / distribution', summary: '主发布 workflow 已切到 GitHub-hosted runner，但 issue 文本点名的 Android Ubuntu runner、Rust cache、macOS 签名/公证与上传链路并未全部在代码中出现。', evidence: ['.github/workflows/release.yml:27、:537、:1010、:1091 的构建 job 已使用 GitHub-hosted runner。', '.github/workflows/release.yml 中 Android 仍跑在 Windows runner，而非 issue 里要求的 Ubuntu。', 'tests/ci/release-workflow-bun-install.test.ts:83 有“不要回退 self-hosted”静态守卫。'] },
  886: { verdict: 'relevant area exists, requirement still unproven', confidence: 'high', kind: 'ci / release / distribution', summary: '下载/更新分发栈存在，但当前代码模型仍是单一 GitHub URL，不是“对象存储 + OneDrive 兜底”的多源分发。', evidence: ['scripts/dev/release-pages-metadata-lib.ts:37 资产 schema 只有单个 `url`。', 'scripts/dev/sync-release-pages.ts:289 直接把 GitHub `browser_download_url` 写进元数据。', 'website/src/lib/downloads-data.ts:398 fallback 仍指向 GitHub Release。', 'src/lib/services/update.service.ts:33 只消费单个 `downloadUrl`。'] },
  867: { verdict: 'relevant area exists, requirement still unproven', confidence: 'high', kind: 'agent / pty / workbench', summary: '统一外链 opener 已存在，但当前 `PtyTerminal` 仍使用默认 `WebLinksAddon()`，没有把 Ctrl+点击外链接到统一系统浏览器打开链路。', evidence: ['src/lib/utils/open-external.ts:1 已有统一外链打开契约。', 'src/ui/app/components/PtyTerminal.tsx 当前仍使用默认 `WebLinksAddon()`，未接统一 opener。'] },
  868: { verdict: 'partial code evidence', confidence: 'high', kind: 'runtime / sync', summary: '本地 SSE replay、confirmed peer SQLite backfill、runtime proposal replication 都已存在，但前端恢复合同仍未把 Proposal 与断线窗口补齐语义统一证明出来。', evidence: ['src/lib/services/rt-domain-backfill.service.ts confirmed peer backfill 只覆盖 EventLog / Task / TimeBlock。', 'crates/exomind-runtime/src/signal/actors/replication_actor.rs 已有 `proposal.replication.upserted`。', '当前未见“断线窗口 checkpoint / 恢复语义 + 双真实 Tauri 故事”的直接自动化证据。'] },
  897: { verdict: 'partial code evidence', confidence: 'high', kind: 'agent / pty / workbench', summary: '新 PTY WS 主路径与重连连续性主干已经明显存在，但 issue 要求的“旧前端继续可用旧 POST/SSE 兼容面”与完整协议边界没有被当前代码证明。', evidence: ['crates/exomind-runtime/src/routes/pty.rs:39 与 :930 已有 `/pty/:id/ws` 协议与 WS 路由。', 'crates/exomind-runtime/src/routes/pty.rs:1444 与 :1798 有 WS 输入确认和重连回放测试。', 'crates/exomind-runtime/src/routes/pty.rs:1372 与 :1397 明确让旧 `input/stream` 兼容面返回 404。', 'src/ui/app/components/PtyTerminal.tsx:119、:170、:187、:993、:1181 已以 WS 为新前端主路径并显式处理协议不兼容。', 'src/ui/app/components/pty-input.ts 使用 WS 输入通道。'] },
  892: { verdict: 'relevant area exists, requirement still unproven', confidence: 'high', kind: 'agent / pty / workbench', summary: 'AI registry 的 default/fallback 静态解析已存在，但 broker 侧没有 Router v1 所需的 routing trace、session stickiness 与 circuit breaker 合同。', evidence: ['src/lib/ai-registry/resolution.ts:1 已有 capability -> default/fallback 静态解析。', 'crates/exomind-runtime/src/agent/broker.rs:1 当前 broker 能力边界中看不到 `RouteIntent / RouteDecision / RoutingTrace` 等 Router v1 合同。'] },
  893: { verdict: 'no code evidence', confidence: 'high', kind: 'eventlog / reminder', summary: '到期推进仍依赖前端 scheduler 轮询与 UI 挂载，仓库里没有 RT 侧 due actor；对“headless 由 runtime 接管”的需求存在强反证。', evidence: ['src/lib/services/reminder-scheduler.service.ts:1 仍由前端 scheduler 轮询并 `markTriggered`。', '当前代码里看不到 RT 侧 reminder due actor 的实现合同。'] },
  894: { verdict: 'partial code evidence', confidence: 'high', kind: 'agent / pty / workbench', summary: '输入 WS 与无自动 fallback 主干已经存在，但 issue 的阶段目标仍要求“输出保留 SSE、旧路由不删除”；当前代码已经越过这个阶段，不能按原文直接记完成。', evidence: ['src/ui/app/components/pty-input.ts 已使用 WS 输入。', '当前代码已把输出主路径推进到 WS，且旧兼容面不再保留，说明代码状态已偏离该 issue 的原始阶段约束。'] },
  895: { verdict: 'research/governance track', confidence: 'high', kind: 'other product area', summary: '这条 issue 本身是协作架构调研题，不应按“源码已实现”口径治理。', evidence: ['issue 标题与标签都指向 research / architecture。'] },
  896: { verdict: 'partial code evidence', confidence: 'high', kind: 'runtime / sync', summary: 'runtime 库层已支持 `port=0` 随机端口并回传真实绑定端口，但 Tauri embedded 启动层仍默认 9124，`AddrInUse` 分支没有自动换端口重试。', evidence: ['crates/exomind-runtime/tests/runtime_startup.rs 已覆盖 `port=0` 随机端口绑定。', 'src-tauri/src/commands/runtime_commands.rs 仍未把 `AddrInUse` 自动重试到随机端口。', 'src-tauri/src/lib.rs 仍保留固定端口启动假设。'] },
  900: { verdict: 'relevant area exists, requirement still unproven', confidence: 'high', kind: 'tooling / dev-manager', summary: '测试工具链主体在走 Vitest，但 issue 讨论的 Bun 兼容风险并没有通过默认脚本或兼容 shim 被真正消解。', evidence: ['package.json:36 `test` 仍是 `vitest`，没有显式固化成 `bun x vitest` / `npx vitest`。', 'scripts/test/unit.ps1:38 仍调用 `bun run test`。', 'tests/setup.ts:1 没有把完整 `vi` API 主动注入全局的兼容层。'] },
  881: { verdict: 'relevant area exists, requirement still unproven', confidence: 'high', kind: 'ci / release / distribution', summary: 'updater 主链路存在，但“自动下载预览版更新开关已接线”并没有被当前代码证明。', evidence: ['src/lib/services/update.service.ts 与更新状态卡存在，说明 updater area 存在。', '当前报告未把该开关的设置项与自动下载行为闭环证据视为已实现。'] },
  901: { verdict: 'relevant area exists, requirement still unproven', confidence: 'high', kind: 'agent / pty / workbench', summary: '平铺工作台与 spawn dialog 都在，但“目标窗格承接创建中/失败态，而不是 dialog 按钮阻塞”这条异步反馈模型没有落地。', evidence: ['src/ui/app/pages/agents/TiledGrid.tsx:1114 EmptyPane 仍只有空窗格/新建/绑定，没有窗格级 pending/error 占位。', 'src/ui/app/components/PtySpawnDialog.tsx:404 `handleSpawn()` 期间由 dialog 本地 `loading` 承担主反馈。', 'src/ui/app/pages/AgentsPage.tsx:284 的 pending binding 仍以 `ptyId` 出现后才开始回填。', 'tests/unit/ui/agent-hub/agents-page.tiled-workbench.issue841.test.tsx:688 与 pty-spawn-dialog.test.tsx:805 只覆盖最终回填/对话框链路。'] },
  902: { verdict: 'relevant area exists, requirement still unproven', confidence: 'high', kind: 'tooling / dev-manager', summary: 'manager area 完整，但默认行为仍是实例级隔离 target dir；issue 要求的 shared-by-default + `--separate` 回退模型没有成立。', evidence: ['scripts/dev/tauri-dev-manager.ts:36 没有 `--separate` CLI 选项。', 'scripts/dev/tauri-dev-manager.ts:376 总是启动 `bun run tauri dev` 的实例链路。', 'scripts/dev/tauri-dev-target-dir-lib.ts:106 默认落到 `target/tauri-dev/<instance>`。', 'scripts/dev/tauri-wrapper.ps1:465 注入 `CARGO_TARGET_DIR` 到实例目录。', 'tests/unit/scripts/tauri-wrapper.test.ts:81 与 tauri-dev-target-dir-lib.test.ts:8 都把隔离 target dir 视为当前契约。'] },
  903: { verdict: 'relevant area exists, requirement still unproven', confidence: 'high', kind: 'website / docs', summary: '首页已经提到 Agent terminal / signal network，但 issue 指向的 `/docs` 首页与 `Getting Started` 目标表面没有相应入口、下一步指引和边界标记。', evidence: ['website/src/pages/index.astro:27 已有终端工作台/信号网络 narrative mention。', 'website/src/components/docs/DocsHome.astro:21 的 docs home 仍围绕 capture / voice / time blocks / tasks / pairing / FAQ。', 'website/src/lib/docs.ts:5 与 :834 没有 Agent terminal / signal network 发布入口。', 'website/src/pages/getting-started.astro:15 与 :537 没有“下一步去 Agent terminal / signal network”的承接。'] },
  904: { verdict: 'relevant area exists, requirement still unproven', confidence: 'high', kind: 'website / docs', summary: '`/features` 页面存在，但当前主结构仍是静态功能卡网格，未达到“截图 / 演示型 showcase 页面”的要求。', evidence: ['website/src/pages/features.astro:9 与 :61 仍以静态 feature card grid 为主体。', 'website/src/pages/en/features.astro:8 与中文页同构，仍是静态卡片页。', 'website/src/i18n/index.ts:31 的功能描述仍是抽象 marketing copy，不是界面/工作流展示。', 'tests/e2e/website.smoke.test.ts:4 只有站点可访问 smoke test，没有 showcase 媒体结构断言。'] },
};

const sh = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const norm = (v?: string | null) => (v ?? '').replace(/\uFEFF/g, '').replace(/\r\n?/g, '\n');
const uniq = <T>(values: T[]) => [...new Set(values.filter(Boolean as unknown as (v: T) => boolean))];

function loadIssues(): { issues: OpenIssue[]; source: string } {
  try {
    const raw = sh('gh', ['issue', 'list', '--state', 'open', '--limit', '500', '--json', 'number,title,body,url,createdAt,updatedAt,labels']);
    return { issues: JSON.parse(raw) as OpenIssue[], source: 'gh issue list --state open --limit 500' };
  } catch {
    if (!existsSync(FALLBACK)) throw new Error(`Cannot load open issues; fallback missing: ${FALLBACK}`);
    let raw = readFileSync(FALLBACK);
    if (raw[0] === 0xff && raw[1] === 0xfe) raw = raw.subarray(2);
    return { issues: JSON.parse(raw.toString('utf16le')) as OpenIssue[], source: 'temp/open-issues-with-body.json (utf16le fallback)' };
  }
}

function isCodeFile(file: string): boolean {
  if (file.startsWith('docs/') || file.startsWith('temp/') || file.startsWith('website/public/') || file.startsWith('.tmp/') || file.startsWith('.claude/') || file.startsWith('.codex/')) return false;
  if (['package.json', 'tsconfig.json', 'vitest.config.ts', 'bunfig.toml', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json'].includes(file)) return true;
  return ALLOWED_EXT.has(path.extname(file).toLowerCase());
}

function category(file: string): Category {
  if (file.startsWith('.github/workflows/')) return 'workflow';
  if (file.startsWith('tests/') || file.includes('.test.') || file.includes('.spec.')) return 'test';
  if (file.startsWith('website/src/')) return 'website';
  if (file.startsWith('scripts/')) return 'script';
  if (file.startsWith('crates/') || file.startsWith('src-tauri/')) return 'backend';
  if (file.startsWith('src/ui/')) return 'ui';
  if (['package.json', 'tsconfig.json', 'vitest.config.ts'].includes(file) || file.endsWith('Cargo.toml') || file.endsWith('tauri.conf.json') || file.endsWith('.toml')) return 'config';
  if (file.startsWith('src/lib/') || file.startsWith('src/services/')) return 'service';
  return 'other';
}

function loadCode(): CodeFile[] {
  return sh('git', ['ls-files'])
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean)
    .filter(isCodeFile)
    .map((file) => {
      const content = readFileSync(path.join(ROOT, file), 'utf8');
      return { path: file, pathLower: file.toLowerCase(), contentLower: content.toLowerCase(), category: category(file) };
    });
}

function heading(raw: string) {
  return raw.replace(/^[#\s]+/, '').replace(/[：:]+/g, ' ').replace(/[()（）]/g, ' ').replace(/\s+/g, ' ').trim();
}

function requirementText(issue: OpenIssue) {
  const body = norm(issue.body);
  if (!body.trim()) return issue.title;
  const kept = [issue.title];
  let keep = true;
  for (const line of body.split('\n')) {
    const m = line.match(/^(#+)\s*(.+)$/);
    if (m) {
      const h = heading(m[2]);
      if (DROP_SECTIONS.some((r) => r.test(h))) {
        keep = false;
        continue;
      }
      if (KEEP_SECTIONS.some((r) => r.test(h))) {
        keep = true;
        kept.push(line);
        continue;
      }
      keep = false;
      continue;
    }
    if (keep) kept.push(line);
  }
  return kept.join('\n').trim();
}

function explicitPaths(text: string) {
  return uniq(text.match(/(?:\.github|src-tauri|src|crates|website|scripts|tests)\/[A-Za-z0-9_./\-[\]]+\.(?:ts|tsx|js|jsx|mjs|cjs|rs|astro|json|yml|yaml|toml|ps1|sh|css|html|sql)/g) ?? []);
}
const routeTokens = (text: string) => uniq(text.match(/\/[A-Za-z0-9_\-:[\].]+(?:\/[A-Za-z0-9_\-:[\].]+)+/g) ?? []);
const envTokens = (text: string) => uniq(text.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []);
const flagTokens = (text: string) => uniq(text.match(/--[a-z0-9][a-z0-9-]*/g) ?? []);
const backticks = (text: string) => uniq([...text.matchAll(/`([^`]{2,120})`/g)].map((m) => m[1].trim()));
function identifierTokens(text: string) {
  return uniq(backticks(text).filter((chunk) => !chunk.includes('/') && (chunk.startsWith('--') || /^[A-Z][A-Z0-9_]{2,}$/.test(chunk) || /[A-Z]/.test(chunk) || /\./.test(chunk) || /:/.test(chunk))));
}
function titleSlugs(title: string) {
  const values: string[] = [];
  const m = title.match(/^[a-z-]+\(([^)]+)\)/i);
  if (m) values.push(...m[1].split(/[,\s/]+/));
  return uniq(values.map((v) => v.trim().toLowerCase()).filter((v) => v.length >= 3 && !GENERIC_TOKENS.has(v)));
}

function signals(issue: OpenIssue): Signals {
  const text = requirementText(issue);
  const slugs = titleSlugs(issue.title);
  return {
    requirementText: text,
    explicitPaths: explicitPaths(text),
    routeTokens: routeTokens(text),
    envTokens: envTokens(text),
    flagTokens: flagTokens(text),
    identifierTokens: identifierTokens(text),
    titleSlugs: slugs,
    scoreTokens: uniq([...routeTokens(text), ...envTokens(text), ...flagTokens(text), ...identifierTokens(text), ...slugs].map((v) => v.toLowerCase()).filter((v) => v.length >= 3 && !GENERIC_TOKENS.has(v))).slice(0, 14),
  };
}

function matchSelector(file: string, selector: Selector) {
  return selector.type === 'exact' ? file === selector.value : selector.type === 'prefix' ? file.startsWith(selector.value) : file.toLowerCase().includes(selector.value.toLowerCase());
}

function domains(issue: OpenIssue, s: Signals) {
  const haystack = `${issue.title}\n${issue.labels.map((l) => l.name).join(' ')}`;
  return DOMAINS.filter((d) => d.patterns.some((r) => r.test(haystack)));
}

function candidates(files: CodeFile[], ds: Domain[], s: Signals) {
  const byPath = new Map<string, CodeFile>();
  for (const p of s.explicitPaths) {
    const file = files.find((f) => f.path === p);
    if (file) byPath.set(file.path, file);
  }
  for (const d of ds) for (const file of files) if (d.selectors.some((sel) => matchSelector(file.path, sel))) byPath.set(file.path, file);
  for (const slug of s.titleSlugs) for (const file of files) {
    const compactSlug = slug.replace(/[^a-z0-9]+/g, '');
    const compactPath = file.pathLower.replace(/[^a-z0-9]+/g, '');
    if (file.pathLower.includes(slug) || (compactSlug && compactPath.includes(compactSlug))) byPath.set(file.path, file);
  }
  return [...byPath.values()].slice(0, 120);
}

function research(issue: OpenIssue, s: Signals, ds: Domain[]) {
  const labels = issue.labels.map((l) => l.name.toLowerCase());
  if (labels.includes('research')) return true;
  if (/^(design|research|analysis|spec|proposal|discussion)\(/i.test(issue.title)) return true;
  if (/^(epic)\(/i.test(issue.title) && ds.length <= 1 && s.scoreTokens.length <= 2) return true;
  return false;
}

function tokenHits(files: CodeFile[], tokens: string[]) {
  const anchors: string[] = [];
  const matched = new Set<string>();
  for (const file of files) {
    const hits = tokens.filter((t) => file.pathLower.includes(t) || file.contentLower.includes(t));
    if (hits.length) {
      hits.forEach((h) => matched.add(h));
      anchors.push(`${file.path} [${file.category}; tokens: ${hits.slice(0, 4).join(', ')}]`);
    }
  }
  return { anchors, matched: [...matched] };
}

function heuristicSummary(verdict: Verdict, kind: string, files: CodeFile[], matched: string[]) {
  const filePreview = files.slice(0, 3).map((f) => f.path).join(', ');
  const tokenPreview = matched.slice(0, 4).join(', ');
  if (verdict === 'research/governance track') return '这条 issue 的交付物更偏向设计/治理/研究，不宜仅用“源码已实现/未实现”口径强判关闭。';
  if (verdict === 'no code evidence') return '从需求段抽出的目标表面没有在当前代码面中命中可执行入口；仓库里看不到足以支撑验收点的源码链路。';
  if (verdict === 'partial code evidence') return `当前代码在 ${kind} 主干上已有多处命中（${filePreview || '见候选模块'}），并出现 ${tokenPreview || '若干需求 token'}，但仍不足以证明 DoD 已闭环。`;
  return `仓库里能看到 ${kind} 相关代码区（${filePreview || '见候选模块'}），但还没有把 issue 关键约束${tokenPreview ? `（${tokenPreview}）` : ''}证明成完整实现。`;
}

function evaluate(issue: OpenIssue, files: CodeFile[]): Row {
  const manual = MANUAL[issue.number];
  if (manual) return { issue, kind: manual.kind, verdict: manual.verdict, confidence: manual.confidence, summary: manual.summary, anchors: manual.evidence };
  const s = signals(issue);
  const ds = domains(issue, s);
  const hits = candidates(files, ds, s);
  const { anchors, matched } = tokenHits(hits, s.scoreTokens);
  const kind = ds[0]?.label ?? 'other product area';
  const hasImpl = hits.some((f) => f.category !== 'test');
  const hasTest = hits.some((f) => f.category === 'test') || anchors.some((a) => a.includes('[test;'));
  let verdict: Verdict = 'no code evidence';
  let confidence: Confidence = 'low';
  if (research(issue, s, ds)) {
    verdict = 'research/governance track';
    confidence = 'medium';
  } else if (hits.length === 0) {
    verdict = 'no code evidence';
  } else if (anchors.length >= 3 && matched.length >= 2 && hasImpl && hasTest) {
    verdict = 'partial code evidence';
    confidence = 'medium';
  } else {
    verdict = 'relevant area exists, requirement still unproven';
    confidence = anchors.length >= 2 || ds.length >= 2 ? 'medium' : 'low';
  }
  return {
    issue,
    kind,
    verdict,
    confidence,
    summary: heuristicSummary(verdict, kind, hits, matched),
    anchors: uniq([...anchors, ...hits.slice(0, 3).map((f) => `${f.path} [${f.category}]`)]).slice(0, 4),
  };
}

const esc = (v: string) => v.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
function countTable(entries: Array<[string, number]>, headers: [string, string]) {
  return [`| ${headers[0]} | ${headers[1]} |`, '| --- | ---: |', ...entries.map(([label, count]) => `| ${esc(label)} | ${count} |`)].join('\n');
}

function manualSection(rows: Map<number, Row>) {
  return SPOTLIGHT.map((n) => {
    const row = rows.get(n);
    if (!row) return '';
    return [`### [#${n}](${row.issue.url}) ${row.issue.title}`, `- Verdict: \`${row.verdict}\``, `- Confidence: \`${row.confidence}\``, `- Why: ${row.summary}`, '- Code evidence:', ...row.anchors.map((a) => `  - ${a}`)].join('\n');
  }).filter(Boolean).join('\n\n');
}

function appendix(rows: Row[]) {
  const lines = ['| Issue | Kind | Verdict | Confidence | Why | Code anchors |', '| --- | --- | --- | --- | --- | --- |'];
  for (const row of rows) {
    const labels = row.issue.labels.map((l) => l.name).join(', ');
    const issueCell = `[#${row.issue.number}](${row.issue.url}) ${esc(row.issue.title)}<br><sub>${esc(labels)}</sub>`;
    const anchors = row.anchors.length ? row.anchors.slice(0, 3).map(esc).join('<br>') : 'none';
    lines.push(`| ${issueCell} | ${esc(row.kind)} | ${esc(row.verdict)} | ${row.confidence} | ${esc(row.summary)} | ${anchors} |`);
  }
  return lines.join('\n');
}

function main() {
  const { issues, source } = loadIssues();
  const files = loadCode();
  const rows = issues.slice().sort((a, b) => b.number - a.number).map((issue) => evaluate(issue, files));
  const rowMap = new Map(rows.map((row) => [row.issue.number, row]));
  const verdictCounts = new Map<string, number>();
  const kindCounts = new Map<string, number>();
  for (const row of rows) {
    verdictCounts.set(row.verdict, (verdictCounts.get(row.verdict) ?? 0) + 1);
    kindCounts.set(row.kind, (kindCounts.get(row.kind) ?? 0) + 1);
  }

  const report = [
    '# Open Issue Source Census (Code-First Rebuild)',
    '',
    `- Date: ${new Date().toISOString().slice(0, 10)}`,
    `- Scope: ${issues.length} current open issues`,
    `- Issue source: ${source}`,
    `- Code surfaces scanned: ${files.length} tracked files under workflows / source / scripts / tests / website source / configs`,
    '- Truth sources: issue title + requirement sections (`背景 / 目标 / 预期 / 验收 / 完成条件 / 边界`) and current repository code',
    '- Explicitly excluded as implementation evidence: issue “实际/当前实现/观察到的现象” sections, issue comments, PR text, daily/route reports, Markdown planning docs, and direct issue-id references in code',
    '',
    '## Method',
    '',
    '1. Pull the current open issue pool from GitHub; fall back to the local UTF-16 export only when GitHub CLI is unavailable.',
    '2. For each issue, strip the body down to requirement-bearing sections and ignore all “当前实现 / 现状 / 已验证 / 观察到的现象” prose.',
    '3. Scan only executable repository surfaces: workflows, scripts, source files, tests, website source, and config files.',
    '4. Apply high-confidence manual calibrations to issues with strong positive or negative code evidence; everything else uses a conservative heuristic.',
    '5. Verdicts:',
    '   - `strong code evidence`: only used when the code itself proves the requested behavior and there is a guard against silent regression.',
    '   - `partial code evidence`: the requested behavior is meaningfully present in code, but the issue DoD is still not closed.',
    '   - `relevant area exists, requirement still unproven`: related modules/pages/workflows exist, but the code does not prove the specific requirement.',
    '   - `no code evidence`: the requirement text does not currently map to a provable implementation surface in code.',
    '   - `research/governance track`: the issue deliverable is primarily design/governance/research rather than a code-closure candidate.',
    '',
    '## Metrics',
    '',
    countTable([...verdictCounts.entries()].sort((a, b) => b[1] - a[1]), ['Verdict', 'Count']),
    '',
    countTable([...kindCounts.entries()].sort((a, b) => b[1] - a[1]), ['Kind', 'Count']),
    '',
    '## Requested Notes',
    '',
    '- `#362 fix(release): 补齐 macOS/Linux 安装包产物与下载链路（v0.3.6）` is currently `CLOSED`, so it is not part of this open-issue census.',
    '',
    '## High-Confidence Manual Calibrations',
    '',
    manualSection(rowMap),
    '',
    '## Full Appendix',
    '',
    appendix(rows),
    '',
  ].join('\n');

  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, report, 'utf8');
  process.stdout.write(`${OUTPUT}\n`);
}

main();
