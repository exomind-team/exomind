# Issue #659: debug 构建缺少 usesCleartextTraffic 修复计划

> **状态**：待执行
> **分支**：直接在 `dev` 上开发
> **关联 Issue**：#659
> **优先级**：P0（重大 bug，阻塞 Android 局域网连接）

---

## Context

Android 9+ (API 28+) 默认禁止 HTTP 明文流量（cleartext traffic）。ExoMind RT 在局域网上使用 HTTP，所以手机必须声明 `usesCleartextTraffic=true` 才能连接。

**当前状态**：`ensureReleaseCleartextTrafficInGradle` 只往 `getByName("release")` 块注入了 cleartext 配置，**debug 块完全遗漏**。debug 构建应该得到比 release 更宽松的权限——这是一个基本原则性错误。

**影响**：所有通过 `bun tauri android dev` 安装到手机的 debug 构建，都无法访问局域网 HTTP 服务（RT 连接、PouchDB 同步、mDNS 发现后的 HTTP 连接等）。

---

## 修复方案

核心思路：将 `ensureReleaseCleartextTrafficInGradle` 扩展为同时覆盖 debug 和 release 两个构建类型。函数重命名为 `ensureCleartextTrafficInGradle`（去掉 "Release"）。

---

## 步骤 1：修改 TypeScript 注入库

**文件**：`Scripts/dev/android-manifest-permission-lib.ts`

### 1.1 新增 `ensureDebugCleartextTrafficInGradle` 函数

在 `ensureReleaseCleartextTrafficInGradle`（行 315）之后新增一个函数，逻辑与 release 版完全对称，但匹配 `getByName("debug")` 块：

```ts
export function ensureDebugCleartextTrafficInGradle(buildGradleKts: string): GradlePatchResult {
  const debugWithCleartextPattern =
    /getByName\("debug"\)\s*\{[\s\S]*manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"true"/;
  if (debugWithCleartextPattern.test(buildGradleKts)) {
    return { buildGradleKts, changed: false };
  }

  const debugBlockOpenPattern = /getByName\("debug"\)\s*\{/;
  const match = buildGradleKts.match(debugBlockOpenPattern);
  if (!match) {
    return { buildGradleKts, changed: false };
  }

  const newline = buildGradleKts.includes('\r\n') ? '\r\n' : '\n';
  const updatedGradle = buildGradleKts.replace(
    debugBlockOpenPattern,
    `getByName("debug") {${newline}            ${RELEASE_CLEARTEXT_PLACEHOLDER}`
  );
  return { buildGradleKts: updatedGradle, changed: updatedGradle !== buildGradleKts };
}
```

**注意**：复用已有的 `RELEASE_CLEARTEXT_PLACEHOLDER` 常量（值是 `manifestPlaceholders["usesCleartextTraffic"] = "true"`），不需要新建常量——这个常量名虽然带 "RELEASE" 但实际值是通用的。如果觉得名字误导，可以重命名为 `CLEARTEXT_PLACEHOLDER`，但要同步更新所有引用和测试。**推荐先不重命名常量，只新增函数，最小改动。**

### 1.2 修改 `ensureReleaseCleartextTrafficInGradleFile` 函数

**文件**：`Scripts/dev/android-manifest-permission-lib.ts`（行 394-423）

在这个函数内部，在 release cleartext patch 之后，追加 debug cleartext patch：

```ts
export function ensureReleaseCleartextTrafficInGradleFile(
  buildGradlePath: string,
  desiredNdkVersion?: string | null
): GradleFilePatchResult {
  try {
    const originalGradle = readFileSync(buildGradlePath, 'utf8');
    const cleartextPatched = ensureReleaseCleartextTrafficInGradle(originalGradle);
    const debugCleartextPatched = ensureDebugCleartextTrafficInGradle(cleartextPatched.buildGradleKts);  // ★ 新增
    const patched = ensureDebugNativeLibsAreStrippedInGradle(debugCleartextPatched.buildGradleKts);
    const ndkPatched = ensureConfiguredNdkVersionInGradle(patched.buildGradleKts, desiredNdkVersion);
    const updatedGradle = ndkPatched.buildGradleKts;
    const changed = cleartextPatched.changed || debugCleartextPatched.changed || patched.changed || ndkPatched.changed;  // ★ 追加 debugCleartextPatched.changed

    if (!changed) {
      return originalGradle.includes(RELEASE_CLEARTEXT_PLACEHOLDER)
        && !originalGradle.includes(DEBUG_KEEP_SYMBOLS_MARKER)
        && (!desiredNdkVersion || originalGradle.includes(`ndkVersion = "${desiredNdkVersion}"`))
        ? { status: 'already-present', changed: false }
        : { status: 'invalid-gradle', changed: false };
    }

    writeFileSync(buildGradlePath, updatedGradle, 'utf8');
    return { status: 'updated', changed: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing-file', changed: false };
    }
    throw error;
  }
}
```

### 1.3 导出新函数

确保 `ensureDebugCleartextTrafficInGradle` 被 export（供测试引用）。

---

## 步骤 2：修改 PowerShell 脚本

**文件**：`Scripts/dev/tauri-wrapper.ps1`

### 2.1 新增 `Ensure-AndroidDebugCleartextTraffic` 函数

在 `Ensure-AndroidReleaseCleartextTraffic`（行 120-148）之后，新增对称的 debug 版本：

```powershell
function Ensure-AndroidDebugCleartextTraffic {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BuildGradlePath
  )

  if (-not (Test-Path -LiteralPath $BuildGradlePath)) {
    return
  }

  $content = Get-Content -LiteralPath $BuildGradlePath -Raw -Encoding UTF8
  $targetLine = 'manifestPlaceholders["usesCleartextTraffic"] = "true"'

  if ($content -match 'getByName\("debug"\)\s*\{[\s\S]*manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"true"') {
    return
  }

  $updated = [regex]::Replace(
    $content,
    'getByName\("debug"\)\s*\{',
    "getByName(`"debug`") {`r`n            $targetLine",
    1
  )

  if ($updated -ne $content) {
    Write-TextUtf8NoBom -Path $BuildGradlePath -Content $updated
    Write-Host "[tauri-wrapper] Enabled debug cleartext traffic in Android build.gradle.kts"
  }
}
```

### 2.2 在调用处追加 debug 补丁

**行 634** 附近（`# Patch before command`）和**行 692** 附近（`# Patch again for init flows`），在现有的 `Ensure-AndroidReleaseCleartextTraffic` 调用之后，追加 `Ensure-AndroidDebugCleartextTraffic`：

```powershell
Ensure-AndroidReleaseCleartextTraffic -BuildGradlePath $buildGradlePath
Ensure-AndroidDebugCleartextTraffic -BuildGradlePath $buildGradlePath  # ★ 新增
```

---

## 步骤 3：更新测试

**文件**：`tests/unit/scripts/android-manifest-permission-lib.test.ts`

### 3.1 新增 `ensureDebugCleartextTrafficInGradle` 测试用例

在 `describe('ensureReleaseCleartextTrafficInGradle')` 之后新增：

```ts
describe('ensureDebugCleartextTrafficInGradle', () => {
  it('injects cleartext placeholder into debug block when missing（debug 缺失时注入）', () => {
    const input = `android {
    buildTypes {
        getByName("debug") {
            isDebuggable = true
        }
        getByName("release") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
    }
}
`;

    const result = ensureDebugCleartextTrafficInGradle(input);

    expect(result.changed).toBe(true);
    expect(result.buildGradleKts).toMatch(
      /getByName\("debug"\)\s*\{[\s\S]*manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"true"/
    );
  });

  it('keeps gradle unchanged when debug cleartext already exists（已存在时保持不变）', () => {
    const input = `android {
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
        }
    }
}
`;

    const result = ensureDebugCleartextTrafficInGradle(input);

    expect(result.changed).toBe(false);
    expect(result.buildGradleKts).toBe(input);
  });
});
```

### 3.2 导入新函数

在测试文件顶部的 import 中追加 `ensureDebugCleartextTrafficInGradle`。

---

## 步骤 4：更新 CI 验证

**文件**：`.github/workflows/release.yml`

**行 400** 附近的 `Verify Android discovery patch persisted` 步骤中，追加 debug cleartext 校验：

```powershell
# 现有的 release 校验之后追加：
$debugCleartextPattern = 'getByName\("debug"\)\s*\{[\s\S]*manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"true"'
if (-not ($buildGradleContent -match $debugCleartextPattern)) {
  throw "Missing usesCleartextTraffic=true in debug block."
}
```

---

## 步骤 5：验证

```bash
bunx vitest run tests/unit/scripts/android-manifest-permission-lib.test.ts
bunx tsc --noEmit
```

---

## 关键文件索引

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `Scripts/dev/android-manifest-permission-lib.ts` | 新增函数 + 修改现有函数 | 核心修复 |
| `Scripts/dev/tauri-wrapper.ps1` | 新增函数 + 追加调用 | PowerShell 侧同步 |
| `tests/unit/scripts/android-manifest-permission-lib.test.ts` | 新增测试 | 覆盖 debug cleartext |
| `.github/workflows/release.yml` | 追加校验 | CI 防回归 |

---

## ⚠️ 不要做清单（Codex 必读）

| 禁止项 | 原因 |
|--------|------|
| **不要重命名 `RELEASE_CLEARTEXT_PLACEHOLDER` 常量** | 虽然名字带 RELEASE 但值是通用的，重命名会触发大量引用更新，不值得在本 PR 中做 |
| **不要重命名 `ensureReleaseCleartextTrafficInGradle` 函数** | 同上，保持向后兼容，新函数叫 `ensureDebugCleartextTrafficInGradle` |
| **不要改动 AndroidManifest.xml 模板** | cleartext 是通过 Gradle `manifestPlaceholders` 注入的，不是直接改 XML |
| **不要改动 `ensureRequiredAudioPermissionsInManifest`** | 权限注入逻辑不变 |
| **不要改动 `ensureMdnsMulticastLockInMainActivity`** | multicast lock 逻辑不变 |
| **不要改动 `android-manifest-permission.ts` 的入口逻辑** | 入口调的是 `ensureReleaseCleartextTrafficInGradleFile`，该函数内部已经会调用新的 debug patch |

## ⚠️ 容易出错的关键点

1. **正则匹配 `getByName("debug")`**：注意 Gradle 文件中 debug 块可能在 release 块前面或后面，不要假设顺序
2. **`RELEASE_CLEARTEXT_PLACEHOLDER` 的值**：它是 `manifestPlaceholders["usesCleartextTraffic"] = "true"`，注意引号转义
3. **PowerShell 字符串转义**：`` ` `` 是 PowerShell 的转义字符，`` `" `` 表示双引号，`` `r`n `` 表示回车换行
4. **CI 校验正则**：PowerShell 的 `-match` 使用 .NET 正则语法，`[\s\S]` 可以匹配换行
5. **`ensureReleaseCleartextTrafficInGradleFile` 中的 `already-present` 判断**：当前只检查 `RELEASE_CLEARTEXT_PLACEHOLDER` 是否存在。修改后应同时检查 debug 块中也有 cleartext——但为了最小改动，可以先不改这个判断，因为如果 release 有但 debug 没有，`debugCleartextPatched.changed` 会是 true，不会进入 `already-present` 分支

---

## 验证总表

| 场景 | 操作 | 期望结果 |
|------|------|---------|
| debug 缺失 | debug 块没有 cleartext | 注入成功 |
| debug 已有 | debug 块已有 cleartext | 保持不变 |
| release 缺失 | release 块没有 cleartext | 注入成功（原有行为不变） |
| 两者都缺失 | 两个块都没有 | 两个都注入 |
| 两者都有 | 两个块都有 | 保持不变 |
| tsc | `bunx tsc --noEmit` | 零错误 |
| 测试 | `bunx vitest run tests/unit/scripts/android-manifest-permission-lib.test.ts` | 通过 |

---

## 完成回填

- 完成时间：2026-03-22
- 执行结果：已完成
- 实际改动：
  - `Scripts/dev/android-manifest-permission-lib.ts`
    - 新增 `ensureDebugCleartextTrafficInGradle`
    - 在 `ensureReleaseCleartextTrafficInGradleFile` 中串入 debug cleartext patch
    - 额外修正 debug 检测范围，只检查 `debug` 块本身，避免误命中后续 `release` 块中的 cleartext
  - `Scripts/dev/tauri-wrapper.ps1`
    - 新增 `Ensure-AndroidDebugCleartextTraffic`
    - 在两个既有 patch 调用点后追加 debug cleartext patch
    - 额外修正 PowerShell 侧 debug 检测范围，只检查 `debug` 块本身
  - `tests/unit/scripts/android-manifest-permission-lib.test.ts`
    - 新增 `ensureDebugCleartextTrafficInGradle` 的 2 个用例
  - `.github/workflows/release.yml`
    - 追加 debug block 的 cleartext 校验
- 验证结果：
  - `bunx vitest run tests/unit/scripts/android-manifest-permission-lib.test.ts` 通过（20/20）
  - `bunx tsc --noEmit` 通过
- 备注：
  - 按计划保持了 `RELEASE_CLEARTEXT_PLACEHOLDER`、`ensureReleaseCleartextTrafficInGradle`、入口脚本和 AndroidManifest 模板不变
  - 工作区中另有未跟踪目录 `docs/analysis/`，本次未触碰
