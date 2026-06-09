# 2026-04-13 release/update metadata 新架构与单 origin 下载模型断层调查

> 状态：基于本仓库当前代码与文档的只读调查  
> 范围：`src/lib/services/update.service.ts`、`scripts/dev/release-pages-metadata-lib.ts`、`scripts/dev/sync-release-pages.ts`、`website/src/lib/downloads-data.ts`、[release.yml](../../.github/workflows/release.yml)、[release-pages.yml](../../.github/workflows/release-pages.yml)、`website/public/releases/*`、[2026-04-10-open-issue-source-census.md](2026-04-10-open-issue-source-census.md)、[2026-04-08-single-tag-github-pages-release-flow-implementation-plan.md](../plans/2026-04-08-single-tag-github-pages-release-flow-implementation-plan.md)

## 1. 问题定义

当前的断层，不是“release/update metadata 还没做出来”，而是**控制面已经切到 GitHub Pages 静态 metadata + preview/release 分流，但数据面仍然是每个 asset 只有一个最终下载 URL，且这个 URL 仍被默认理解为 GitHub Release**。

[2026-04-08-single-tag-github-pages-release-flow-implementation-plan.md](../plans/2026-04-08-single-tag-github-pages-release-flow-implementation-plan.md):5-8 已把新契约写死为：单一 `v0.x.y` tag、`preview/release` 由 GitHub Pages 静态 JSON 表达、官网与应用更新消费这些 JSON、安装包本体走 GitHub Release assets。[release.yml](../../.github/workflows/release.yml):3-21 和 [release-pages.yml](../../.github/workflows/release-pages.yml):27-60 也已经按这个方向落地。  
但这套新契约只解决了“版本信息从哪里读、preview/release 如何分流”，没有解决“同一个版本的安装包是否可以有多个下载源、消费者如何在这些源之间切换”。这一点在 `scripts/dev/release-pages-metadata-lib.ts:37-50`、`src/lib/services/update.service.ts:33-56`、`website/src/lib/downloads-data.ts:3-16` 上都能看到：asset schema 仍然只有单个 `url`。

所以真正的问题是：**metadata 层已经有 channel 维度，没有 source 维度。**

## 2. 当前 metadata 与渠道分流的新成果

先把已经完成的部分说清楚。当前仓库并不是旧的 `build/* / release/* + Cloudflare/R2 + 动态 API` 状态。

### 2.1 发布控制面已经切到 single-tag + Pages metadata

[2026-04-08-single-tag-github-pages-release-flow-implementation-plan.md](../plans/2026-04-08-single-tag-github-pages-release-flow-implementation-plan.md):5-8 明确要求：

- 唯一 tag 是 `v0.x.y`
- `preview/release` 由 GitHub Release `prerelease` 状态和 GitHub Pages metadata 共同表达
- 官网与更新检查消费静态 JSON
- 安装包本体走 GitHub Release assets

这不是停留在文档上。[release.yml](../../.github/workflows/release.yml):3-21 已经只监听 `v*` tag，并把 `VITE_UPDATE_BASE_URL` 固定到 `https://exomind-team.github.io/exomind/`；[release.yml](../../.github/workflows/release.yml):1419-1455 说明发布与 promotion 也都围绕同一个 GitHub Release 展开。[release-pages.yml](../../.github/workflows/release-pages.yml):50-60 则把 `scripts/dev/sync-release-pages.ts` 接进 Pages workflow，先同步 metadata，再构建站点。

`tests/ci/release-workflow-bun-install.test.ts:56-69`、`tests/ci/release-workflow-bun-install.test.ts:71-80`、`tests/ci/release-workflow-bun-install.test.ts:96-109` 进一步把这些约束写成静态守卫：必须是单 `v*` tag、必须有独立 Pages workflow、必须固定 `VITE_UPDATE_BASE_URL`、必须移除 Cloudflare R2 上传逻辑。

### 2.2 metadata 已经不是单一 latest API，而是 preview/release/timeline 三路静态视图

`scripts/dev/release-pages-metadata-lib.ts:53-74` 定义了三类静态输出：

- `PagesReleaseVersionsIndex`：按 `preview` / `release` 分开的 versions index
- `PagesReleaseMetadata`：每个版本的 metadata
- `PagesReleaseTimeline`：独立 timeline 视图

`scripts/dev/release-pages-metadata-lib.ts:163-197` 会按 GitHub Release 的 `prerelease` 状态拆出 `preview` 与 `release` 两条 versions index；`scripts/dev/release-pages-metadata-lib.ts:199-255` 还会单独生成 timeline。  
`scripts/dev/sync-release-pages.ts:305-327` 则把这些视图实际写入 `website/public/releases/preview/latest.json`、`website/public/releases/preview/versions.json`、`website/public/releases/release/latest.json`、`website/public/releases/release/versions.json` 与 `website/public/releases/timeline.json`。

checked-in 产物也证明这条链已经跑通：

- `website/public/releases/preview/latest.json:1-80` 已有完整 preview metadata。
- `website/public/releases/release/versions.json:1-5` 当前存在 release index 文件，只是内容还是空。
- `website/public/releases/timeline.json:1-54` 已有 timeline，且同时包含 preview 最新版本与 release 侧历史条目。

### 2.3 官网与桌面更新都已经转向静态 metadata 消费

桌面端 `src/lib/services/update.service.ts:11-22` 会把 `VITE_UPDATE_BASE_URL` 规范化为 metadata 基址，`src/lib/services/update.service.ts:125-166` 再固定去读 `/releases/${channel}/latest.json` 与 `/releases/${channel}/versions.json`。这和计划里的目标 URL（[2026-04-08-single-tag-github-pages-release-flow-implementation-plan.md](../plans/2026-04-08-single-tag-github-pages-release-flow-implementation-plan.md):144-151）一致。  
对应测试也已经围绕 Pages metadata 改写：`tests/unit/services/update.service.test.ts:123-142` 断言更新检查从 Pages `latest.json` 取值，`tests/unit/services/update.service.test.ts:190-200` 断言版本历史来自 Pages `versions.json`。

官网端 `website/src/lib/downloads-data.ts:334-377` 也优先加载本地静态 JSON，只在本地 JSON 不存在或内容为空时才退到远端 fallback。

结论很简单：**新 metadata 架构已经存在，而且已经是主路径。**

## 3. 资产 schema、网站、桌面端仍保留的单源假设

问题在于，主路径虽然换了，asset 语义却没有换。

### 3.1 asset schema 仍然只有单个最终 URL

`scripts/dev/release-pages-metadata-lib.ts:37-42` 的 `PagesReleaseAsset` 只有 `name`、`url`、`size`、`sha256` 四个字段，没有 `primary` / `mirrors[]` / `origins[]` / `regions` 之类的 source 结构。  
`scripts/dev/release-pages-metadata-lib.ts:123-137` 在生成 metadata 时，直接把 GitHub Release asset 的 `browserDownloadUrl` 写进这个单一 `url` 字段。

`scripts/dev/sync-release-pages.ts:271-293` 更直接：`toSummary()` 从 GitHub Release REST 响应里取 `browser_download_url`，再交给 metadata builder。也就是说，Pages metadata 当前不是“描述一个可切换的源集合”，而是“提前把某一个最终下载 URL 烧录进去”。

checked-in 产物印证了这一点。`website/public/releases/preview/latest.json:7-65` 中每个 asset 的 `url` 都是 `https://github.com/exomind-team/exomind/releases/download/...` 绝对地址，没有第二来源，也没有 source 标识。

### 3.2 网站消费层同样把下载理解成单链接

`website/src/lib/downloads-data.ts:3-16` 的 `StaticReleaseAsset` 同样只有一个 `url`。  
`website/src/lib/downloads-data.ts:403-438` 的 `resolvePlatformDownload()` 读取的是 `latest.assets[platformKey].url`；`website/src/lib/downloads-data.ts:455-469` 的 `buildHistoryEntries()` 也只会导出一个 `downloadUrl`。

更关键的是，网站 fallback 不是“切到另一个 metadata 源”，而是**直接回到 GitHub Releases API**：

- `website/src/lib/downloads-data.ts:82-86` 把 repo 和 GitHub API 基址写死为 `exomind-team/exomind` 与 `https://api.github.com/repos`
- `website/src/lib/downloads-data.ts:270-315` 远端 fallback 直接请求 GitHub Releases API
- `website/src/lib/downloads-data.ts:334-377` 本地静态 JSON 失败后，直接调用这个 GitHub fallback
- `website/src/lib/downloads-data.ts:398-400` 历史版本页面 fallback 链接也直接回 GitHub Release tag 页面

这意味着网站现在的“兜底”逻辑仍然不是多源分发，而是**GitHub 仍是最终真相源**。

还有一个细节很重要：`website/src/lib/downloads-data.ts:158-174` 从 GitHub API 重建 asset 时，会把 `sha256` 直接置空。也就是说，一旦走 fallback，连 Pages metadata 才能提供的 hash 完整性都丢了。这进一步说明 GitHub API fallback 是补站点可用性，不是为 mirror/source 切换设计的。

### 3.3 桌面更新服务也只认单个 `downloadUrl`

`src/lib/services/update.service.ts:33-40` 的 `UpdateInfo` 只有一个 `downloadUrl`；`src/lib/services/update.service.ts:43-56` 的 `ReleaseAsset` 同样只有一个 `url`。  
`src/lib/services/update.service.ts:129-156` 在检查更新时，只会取当前平台 asset 的单个 `url` 并填入 `downloadUrl`。  
`src/lib/services/update.service.ts:172-204` 的下载逻辑签名是 `downloadUpdate(downloadUrl: string, expectedSha256?: string)`，整个调用链从头到尾都假定“最终只有一个待打开的下载地址”。

UI 层也没有 source 概念。`src/ui/stores/update-store.ts:22-45` 的持久化状态只有 `channel`、`checkInterval`、`autoDownloadPreview`，没有 `updateSource` 或等价字段。`src/ui/app/components/UpdateSettingsCard.tsx:12-128` 只允许切换 `release/preview` 和自动下载预览版；`src/ui/app/components/UpdateStatusCard.tsx:43-53`、`src/ui/app/components/UpdateStatusCard.tsx:128-136` 则只会把那个单一 `downloadUrl` 传进 `downloadUpdate()`。

这和 [2026-04-10-open-issue-source-census.md](2026-04-10-open-issue-source-census.md):195-199 对 `#890`、`#886` 的判断是一致的：更新源切换、多源分发这两个需求区域有代码基础，但 source 维度并未真正落进实现合同。

## 4. 为什么这使多源切换困难

困难不在于“缺个枚举值”，而在于 source 维度目前被彻底压扁了。

### 4.1 metadata 基址可以切，asset 源却不能切

`src/lib/services/update.service.ts:11-22` 确实允许用 `VITE_UPDATE_BASE_URL` 改 metadata 基址，这说明控制面可以搬家。  
但 `src/lib/services/update.service.ts:121-126` 只是用这个 base 去拼 `latest.json` / `versions.json` 的地址；一旦 JSON 里写的是绝对 GitHub 下载链接，后续 `src/lib/services/update.service.ts:152-156`、`src/lib/services/update.service.ts:172-204` 就会原样使用它。

也就是说，当前系统真正支持的是“切 metadata 站点”，不是“切下载源”。如果 mirror 需求是“官网/内地/OneDrive 三选一”，单改 `VITE_UPDATE_BASE_URL` 根本不够，因为二进制 URL 已经在 JSON 里固化成 GitHub 绝对链接了。

### 4.2 source 选择在消费者眼里根本不存在

当前 schema 里没有 source 维度，消费者看见的只是最终字符串：

- Pages metadata 看见 `asset.url`
- 官网下载组件看见 `primary.url`
- 桌面更新看见 `downloadUrl`

一旦用户想切“GitHub | 官网 | 内地”，消费者没有任何可以决策的结构化信息。它拿不到“有哪些源、优先级是什么、当前地区该选谁、失败后如何退避”。这就是为什么 `#890` 到现在仍只能算 `partial code evidence`，见 [2026-04-10-open-issue-source-census.md](2026-04-10-open-issue-source-census.md):195-199。

### 4.3 当前 fallback 反而把 GitHub 单源假设重新钉死

`website/src/lib/downloads-data.ts:334-377` 的 fallback 逻辑表面上是“站点容错”，本质上却是“无论本地 metadata 怎样，最终还是信 GitHub”。  
这带来两个直接后果：

- 本地 metadata 故障时，网站不会转到另一个官方镜像，而是回到 GitHub Releases API
- 即使未来 Pages metadata 支持多源，只要 fallback 仍是 GitHub API，就会在异常路径上重新退回单源假设

换句话说，今天的 fallback 不是 source abstraction，而是 GitHub hard fallback。

### 4.4 现有测试也在固化“静态 metadata + GitHub 绝对下载链接”的预期

这不是注释层面的历史味道，而是测试已经把它变成契约：

- `tests/unit/scripts/release-pages-metadata.test.ts:84-97` 断言 metadata 里的 asset `url` 就是 GitHub Release 下载链接
- `tests/unit/services/update.service.test.ts:123-142` 断言桌面更新检查返回的 `downloadUrl` 是 GitHub Release asset URL
- `tests/unit/services/update.service.test.ts:225-245` 说明 `downloadUpdate()` 虽然接受相对路径，但主测试仍围绕 GitHub 绝对链接组织
- `tests/unit/website-download-api.test.ts:44-60`、`tests/unit/website-download-api.test.ts:67-117` 断言官网主下载和附加下载都直接指向 GitHub Release assets

这说明相对 URL 支持只是一个未被生产链使用的逃生口，不是现行分发模型。

## 5. 迁移阻力

### 5.1 需要改的不是一个点，而是一整条合同链

如果要支持多源，至少要同时改：

- metadata schema：`PagesReleaseAsset` / `StaticReleaseAsset` / `ReleaseAsset`
- metadata 生成脚本：不能再把 `browser_download_url` 直接塞进单一 `url`
- 网站 fallback：不能再直接回 GitHub Releases API
- 桌面 update service：不能只返回单个 `downloadUrl`
- UI/store：必须引入 source 选择或 source policy
- 测试：现有大量断言都要从“直接等于 GitHub URL”改成“按 source policy 解析”

这就是为什么 `#886` 在 census 里被标成 `relevant area exists, requirement still unproven`，而不是“快完成了”，见 [2026-04-10-open-issue-source-census.md](2026-04-10-open-issue-source-census.md):109-118、[2026-04-10-open-issue-source-census.md](2026-04-10-open-issue-source-census.md):199。

### 5.2 发布历史本身还处在过渡态

`scripts/dev/release-pages-metadata-lib.ts:100-103`、`scripts/dev/release-pages-metadata-lib.ts:199-215` 说明 timeline 仍兼容 `release/*` 旧 tag；但是 versions index 生成逻辑 `scripts/dev/release-pages-metadata-lib.ts:111-147` 只接受 canonical `v0.x.y` + manifest 对齐的 release。  
结果就是当前 checked-in 状态里：

- `website/public/releases/release/latest.json:1` 是 `null`
- `website/public/releases/release/versions.json:1-5` 是空列表
- `website/public/releases/timeline.json:33-38` 却仍有 `release/v0.3.5`

这说明发布链路本身还背着一层“历史 release 兼容面”。在这种状态下再引入多源，会碰到一个额外问题：**旧 tag 历史到底要不要补 mirror metadata，还是只对新 canonical release 生效。**

### 5.3 仓库已经把“去 R2、去动态 API、收口到 GitHub Pages + GitHub Release”当成现行正确方向

这本身没错，但它意味着多源分发如果要回来，不能偷偷加旁路。

[2026-04-08-single-tag-github-pages-release-flow-implementation-plan.md](../plans/2026-04-08-single-tag-github-pages-release-flow-implementation-plan.md):113-161 明确要求删除旧 `/api/versions`、`/api/update/check`、`/api/download/...` 动态接口，并让下载按钮直接跳 GitHub Release asset URL。  
`tests/ci/release-workflow-bun-install.test.ts:103-109` 还把“不得再出现 Cloudflare R2 上传逻辑”写成了测试守卫。

因此后续如果真的做“对象存储 + OneDrive 兜底”，不能回到旧式“另外偷偷传一份 R2 URL”。必须先重写当前静态 metadata 契约，让多源成为一等公民。

## 6. 建议的后续验证问题

1. asset schema 的 source 维度要长什么样？
   现在所有实现都只有 `url`。需要先决定是 `primary + mirrors[]`、还是 `origins[region][provider]`、还是 `candidates[] + priority`。

2. `VITE_UPDATE_BASE_URL` 未来只是 metadata base，还是也要承载 source policy？
   现状见 `src/lib/services/update.service.ts:11-22` 与 [release.yml](../../.github/workflows/release.yml):17-21。如果它只是 metadata base，就不能被误当成“更新源切换”。

3. 官网 fallback 还要不要直接回 GitHub Releases API？
   现状见 `website/src/lib/downloads-data.ts:270-377`。如果保留这条路径，多源分发在异常路径上仍会退回 GitHub 单源。

4. mirror 的完整性合同怎么表达？
   当前只有 Pages metadata 链路能稳定给出 `sha256`，而 GitHub API fallback 会把 `sha256` 置空，见 `website/src/lib/downloads-data.ts:169-174`。多源之后是继续共用单 hash，还是引入签名 manifest，需要先定。

5. 桌面端 source 选择是 build-time、runtime policy，还是用户设置？
   当前 store/UI 只有 `channel`，见 `src/ui/stores/update-store.ts:22-45`、`src/ui/app/components/UpdateSettingsCard.tsx:23-128`。如果 issue #890 真要落地，这里必须增加新维度。

6. 历史 release 怎么迁移？
   当前 `release` index 为空但 timeline 仍保留旧 `release/v0.3.5`，见 `website/public/releases/release/versions.json:1-5`、`website/public/releases/timeline.json:33-38`。需要明确旧版本是否补 source metadata，还是只保证新 canonical release。

7. 官网与桌面端是否必须共享同一套 source policy？
   现状两边都共用单 `url` 语义，但 fallback 行为并不完全相同。多源之后，如果网站允许“官网优先、GitHub 兜底”，桌面端是否也要同样策略，需要先定，不然会出现“网站能下、桌面 updater 还在指向 GitHub”的分叉。

## 7. 结论

release/update metadata 新架构已经成立，且主路径已经切到 single-tag + GitHub Pages 静态 metadata。这部分不是瓶颈。  
当前真正的断层在于：**控制面有了 `preview/release/timeline` 这些“视图分流”，但数据面仍然是“每个 asset 一个最终 URL”，并且这个 URL 从生成脚本、checked-in JSON、网站 fallback、桌面 updater、UI/store 到测试契约，整体上都还把 GitHub 当成默认且唯一的真实下载源。**

所以，多源切换现在难，不是因为少了几条 if/else，而是因为 source 根本还不是现行分发合同的一部分。要做 `#886` / `#890`，首先得把 source 从隐含前提提升为 schema、状态、fallback 和测试里的显式维度。
