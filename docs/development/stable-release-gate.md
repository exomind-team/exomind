# Stable Release Gate（稳定版发布门禁）

## 1. 目标（Goal）

为稳定版发布建立最小可行门禁（Minimum Viable Gate，最低可行门禁）：

1. 先过自动化测试，再允许进入 release 构建与发布。
2. 门禁失败时，不生成 GitHub Release，不上传 R2 构建产物。
3. 保持流程轻量，不追求 100% 覆盖率。

## 2. 当前可用测试（Available Tests）

已存在并可直接复用：

1. `vitest` 单元/集成测试（unit/integration tests，单元/集成测试）。
2. `playwright` 端到端测试（E2E tests，端到端测试），含独立 issue 配置。
3. `cargo test -p exomind-runtime` runtime 测试（Rust runtime tests，运行时测试）。
4. `tsc + vite build` 构建验证（build verification，构建校验）。

## 3. 稳定版最低门禁（Minimum Stable Gate）

稳定版 tag（`release/*` 或 `v*`）必须通过以下命令：

1. `bun run build:ci`
2. `bun run test:release:core`
3. `bun run test:release:e2e`
4. `bun run test:release:runtime`

对应聚合命令：

```bash
bun run test:release:gate
```

其中：

1. `test:release:core` 聚焦核心配置与 EventLog/同步主链路。
2. `test:release:e2e` 使用 `eventlog.test.ts` 作为稳定冒烟用例。
3. `test:release:runtime` 确保 `exomind-runtime` 健康。

## 4. CI 门禁接入（CI Integration）

`release.yml` 新增 `release-gate` job：

1. 当 tag 为 `release/*` 或 `v*` 时启用门禁并执行 `bun run test:release:gate`。
2. `build-android` / `build-windows` / `build-macos` / `build-linux` 全部依赖 `release-gate`。
3. `create-release` 额外要求 `release-gate` 成功。

结果：

1. 门禁失败 -> 构建/发布链路被阻断。
2. 门禁通过 -> 继续桌面 + Android 构建、GitHub Release、R2 上传。

## 5. 待补测试（Gaps To Fill）

当前仍建议后续补强（非本次强制）：

1. 多设备同步 E2E（multi-device sync E2E，多设备同步端到端）。
2. Android 真机安装后关键路径自动化（device acceptance automation，设备验收自动化）。
3. Windows 安装包安装/升级自动化（installer upgrade automation，安装包升级自动化）。
4. Release 后下载链接与更新 API 的端到端校验（post-release validation，发布后验证）。

## 6. 手动验收清单（Manual QA Checklist）

自动化通过后，发布人至少执行一次人工检查：

1. Windows 安装包可安装、可启动、主页面可进入。
2. Android arm64 APK 可安装、可启动、可进入 EventLog 页面。
3. 基本路由可切换：`/eventlog` -> `/settings` -> `/eventlog`。
4. EventLog 可新增一条事件并刷新后仍可见。
5. 设置页导入/导出入口可见并可触发文件选择。
6. Release 页面资产命名符合预期（`windows-x64-setup`、`android-arm64`、`android-x86`）。
7. R2 `latest.json` 可读取且版本字段与 tag 一致。

## 7. 推荐发布步骤（Recommended Flow）

1. 本地先跑门禁：

```bash
bun install --frozen-lockfile
bun run test:release:gate
```

2. 打稳定版 tag（任选其一规范）：

```bash
# 规范 A（兼容旧流程）
git tag release/v0.3.3
git push origin release/v0.3.3

# 规范 B（简洁稳定版）
git tag v0.3.3
git push origin v0.3.3
```

3. 观察 GitHub Actions 的 `Build & Release`。
4. 确认 `release-gate` 通过。
5. 确认构建 job 通过（Windows/macOS/Linux/Android）。
6. 确认 `create-release` + `upload-r2` 成功。
