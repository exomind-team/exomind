import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export type ArtifactKind = 'apk' | 'aab';

export interface ArtifactSizeSummary {
  kind: ArtifactKind;
  path: string;
  sizeBytes: number;
  sizeMB: number;
  universal: boolean;
  debug: boolean;
}

export interface AndroidMetaCheckReport {
  productName: string;
  errors: string[];
  warnings: string[];
  infos: string[];
  artifacts: ArtifactSizeSummary[];
}

// 目标：安装包应稳定控制在 <100MB，常态建议接近 20MB。
const SOFT_APK_SIZE_MB = 40;
const HARD_APK_SIZE_MB = 100;
const SOFT_DEBUG_APK_SIZE_MB = 180;
const HARD_DEBUG_APK_SIZE_MB = 250;
const SOFT_AAB_SIZE_MB = 60;
const HARD_AAB_SIZE_MB = 100;

export function parseAndroidStringValues(xml: string): Record<string, string> {
  const values: Record<string, string> = {};
  const stringPattern = /<string\s+name="([^"]+)">([\s\S]*?)<\/string>/g;

  for (const match of xml.matchAll(stringPattern)) {
    const key = match[1];
    const rawValue = match[2] ?? '';
    const normalizedValue = rawValue
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .trim();
    values[key] = normalizedValue;
  }

  return values;
}

export function resolveMissingIconFiles(
  iconPaths: string[],
  existsFn: (absolutePath: string) => boolean = existsSync,
  baseDir = process.cwd(),
): string[] {
  return iconPaths
    .map((iconPath) => resolve(baseDir, iconPath))
    .filter((absolutePath) => !existsFn(absolutePath));
}

export function collectArtifactSizeSummary(
  files: string[],
  sizeFn: (absolutePath: string) => number = (absolutePath) => statSync(absolutePath).size,
): ArtifactSizeSummary[] {
  return files
    .filter((filePath) => filePath.endsWith('.apk') || filePath.endsWith('.aab'))
    .map((filePath) => {
      const sizeBytes = sizeFn(filePath);
      const sizeMB = Number((sizeBytes / (1024 * 1024)).toFixed(2));
      const kind: ArtifactKind = filePath.endsWith('.apk') ? 'apk' : 'aab';
      const debug = kind === 'apk' && /(^|[\\/])debug([\\/]|$)|-debug\.apk$/i.test(filePath);
      return {
        kind,
        path: filePath,
        sizeBytes,
        sizeMB,
        universal: /universal/i.test(filePath),
        debug,
      };
    });
}

function walkFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const files: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function extractBundleIcons(config: unknown): string[] {
  if (!config || typeof config !== 'object') return [];
  const bundle = (config as Record<string, unknown>).bundle;
  if (!bundle || typeof bundle !== 'object') return [];
  const icon = (bundle as Record<string, unknown>).icon;
  if (!Array.isArray(icon)) return [];
  return icon.filter((item): item is string => typeof item === 'string');
}

export function runAndroidMetaCheck(repoRoot = process.cwd()): AndroidMetaCheckReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];

  const srcTauriDir = join(repoRoot, 'src-tauri');
  const tauriConfigPath = join(srcTauriDir, 'tauri.conf.json');
  const tauriConfigRaw = readFileSync(tauriConfigPath, 'utf8');
  const tauriConfig = JSON.parse(tauriConfigRaw) as Record<string, unknown>;
  const productName = typeof tauriConfig.productName === 'string' ? tauriConfig.productName : '';

  if (!productName) {
    errors.push('`src-tauri/tauri.conf.json` 缺少有效的 `productName`。');
  } else {
    infos.push(`productName = ${productName}`);
  }

  const iconPaths = extractBundleIcons(tauriConfig);
  if (iconPaths.length === 0) {
    warnings.push('`bundle.icon` 未配置，无法检查图标文件。');
  } else {
    const missing = resolveMissingIconFiles(iconPaths, existsSync, srcTauriDir);
    for (const missingPath of missing) {
      errors.push(`缺少图标文件: ${relative(repoRoot, missingPath)}`);
    }
    if (missing.length === 0) {
      infos.push(`bundle.icon 共 ${iconPaths.length} 个文件存在。`);
    }
  }

  const androidStringsPath = join(
    srcTauriDir,
    'gen',
    'android',
    'app',
    'src',
    'main',
    'res',
    'values',
    'strings.xml',
  );

  if (!existsSync(androidStringsPath)) {
    warnings.push('未找到 Android strings.xml（尚未执行 android init/build 时属正常）。');
  } else {
    const values = parseAndroidStringValues(readFileSync(androidStringsPath, 'utf8'));
    const appName = values.app_name;
    const mainTitle = values.main_activity_title;

    if (!appName || !mainTitle) {
      errors.push('Android strings.xml 缺少 `app_name` 或 `main_activity_title`。');
    } else {
      if (appName !== productName) {
        errors.push(`app_name 不匹配：期望 "${productName}"，实际 "${appName}"。`);
      }
      if (mainTitle !== productName) {
        errors.push(`main_activity_title 不匹配：期望 "${productName}"，实际 "${mainTitle}"。`);
      }
      if (appName === productName && mainTitle === productName) {
        infos.push('Android app_name / main_activity_title 与 productName 一致。');
      }
    }
  }

  const androidResDir = join(srcTauriDir, 'gen', 'android', 'app', 'src', 'main', 'res');
  if (!existsSync(androidResDir)) {
    warnings.push('未找到 Android res 目录（尚未执行 android init/build 时属正常）。');
  } else {
    const resFiles = walkFiles(androidResDir);
    const hasLauncher = resFiles.some((filePath) => /ic_launcher\.png$/i.test(filePath));
    const hasRound = resFiles.some((filePath) => /ic_launcher_round\.png$/i.test(filePath));
    if (!hasLauncher || !hasRound) {
      errors.push('Android launcher 图标不完整（缺少 ic_launcher.png 或 ic_launcher_round.png）。');
    } else {
      infos.push('Android launcher 图标文件存在。');
    }
  }

  const outputsDir = join(srcTauriDir, 'gen', 'android', 'app', 'build', 'outputs');
  const artifacts = collectArtifactSizeSummary(walkFiles(outputsDir));

  if (artifacts.length === 0) {
    warnings.push('未找到 APK/AAB 产物（尚未执行打包时属正常）。');
  } else {
    for (const artifact of artifacts) {
      infos.push(`${artifact.kind.toUpperCase()} ${artifact.sizeMB}MB - ${relative(repoRoot, artifact.path)}`);
      if (artifact.kind === 'apk' && artifact.debug) {
        // Debug APK includes symbols and diagnostics（Debug 包含符号与诊断信息，体积会明显更大）
        if (artifact.sizeMB > HARD_DEBUG_APK_SIZE_MB) {
          errors.push(`Debug APK 体积过大（>${HARD_DEBUG_APK_SIZE_MB}MB）：${relative(repoRoot, artifact.path)}`);
        } else if (artifact.sizeMB > SOFT_DEBUG_APK_SIZE_MB) {
          warnings.push(`Debug APK 体积偏大（>${SOFT_DEBUG_APK_SIZE_MB}MB）：${relative(repoRoot, artifact.path)}`);
        }
      } else if (artifact.kind === 'apk' && artifact.sizeMB > HARD_APK_SIZE_MB) {
        errors.push(`APK 体积过大（>${HARD_APK_SIZE_MB}MB）：${relative(repoRoot, artifact.path)}`);
      } else if (artifact.kind === 'apk' && artifact.sizeMB > SOFT_APK_SIZE_MB) {
        warnings.push(`APK 体积偏大（>${SOFT_APK_SIZE_MB}MB）：${relative(repoRoot, artifact.path)}`);
      }
      if (artifact.kind === 'aab' && artifact.sizeMB > HARD_AAB_SIZE_MB) {
        errors.push(`AAB 体积过大（>${HARD_AAB_SIZE_MB}MB）：${relative(repoRoot, artifact.path)}`);
      } else if (artifact.kind === 'aab' && artifact.sizeMB > SOFT_AAB_SIZE_MB) {
        warnings.push(`AAB 体积偏大（>${SOFT_AAB_SIZE_MB}MB）：${relative(repoRoot, artifact.path)}`);
      }
    }
  }

  return {
    productName,
    errors,
    warnings,
    infos,
    artifacts,
  };
}
