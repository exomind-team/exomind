import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED_NDK_VERSION = '30.0.16248370';
const TAURI_CLI_VERSION = '2.10.1';
const TAURI_CLI_RELATIVE_PATH = ['node_modules', '@tauri-apps', 'cli', 'tauri.js'];
const BUILD_GRADLE_RELATIVE_PATH = [
  'src-tauri', 'gen', 'android', 'app', 'build.gradle.kts',
];
const BUILD_TASK_RELATIVE_PATH = [
  'src-tauri', 'gen', 'android', 'buildSrc', 'src', 'main', 'java',
  'com', 'exomind', 'app', 'v06', 'beta', 'kotlin', 'BuildTask.kt',
];

export interface InstalledNdkEvidence {
  version: string;
  sdkRoot: string;
  ndkHome: string;
  sourcePropertiesPath: string;
  installedVersions: string[];
}

export interface BuildTaskCallbackPatch {
  buildTaskKotlin: string;
  changed: boolean;
}

function fail(message: string): never {
  throw new Error(`[beta-android-ci] ${message}`);
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) fail(`Required environment variable ${key} is missing.`);
  return value;
}

function resolveRealDirectory(path: string, label: string): string {
  if (!isAbsolute(path)) fail(`${label} must be an absolute path.`);
  const requested = resolve(path);
  for (let ancestor = requested; ; ancestor = dirname(ancestor)) {
    if (lstatSync(ancestor).isSymbolicLink()) fail(`${label} cannot traverse symbolic links.`);
    if (dirname(ancestor) === ancestor) break;
  }
  let actual: string;
  try {
    actual = realpathSync(requested);
  } catch {
    return fail(`${label} does not exist.`);
  }
  if (!lstatSync(actual).isDirectory()) fail(`${label} must be a directory.`);
  return actual;
}

function sameRealPath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

export function verifyInstalledNdk(env: NodeJS.ProcessEnv = process.env): InstalledNdkEvidence {
  const declaredVersions = [
    requiredEnv(env, 'ANDROID_NDK_VERSION'),
    requiredEnv(env, 'EXOMIND_ANDROID_NDK_VERSION'),
  ];
  if (declaredVersions.some(version => version !== PINNED_NDK_VERSION)) {
    fail(`The workflow must pin NDK ${PINNED_NDK_VERSION}; found ${declaredVersions.join(', ')}.`);
  }

  const sdkRoot = resolveRealDirectory(requiredEnv(env, 'ANDROID_HOME'), 'ANDROID_HOME');
  const sdkRootAlias = resolveRealDirectory(requiredEnv(env, 'ANDROID_SDK_ROOT'), 'ANDROID_SDK_ROOT');
  if (!sameRealPath(sdkRoot, sdkRootAlias)) fail('ANDROID_HOME and ANDROID_SDK_ROOT must identify the same isolated SDK.');

  const ndkRoot = join(sdkRoot, 'ndk');
  const ndkHome = resolveRealDirectory(requiredEnv(env, 'NDK_HOME'), 'NDK_HOME');
  const androidNdkHome = resolveRealDirectory(requiredEnv(env, 'ANDROID_NDK_HOME'), 'ANDROID_NDK_HOME');
  const expectedNdkHome = resolveRealDirectory(join(ndkRoot, PINNED_NDK_VERSION), 'Pinned NDK directory');
  if (!sameRealPath(ndkHome, expectedNdkHome) || !sameRealPath(androidNdkHome, expectedNdkHome)) {
    fail(`NDK_HOME and ANDROID_NDK_HOME must both identify NDK ${PINNED_NDK_VERSION}.`);
  }

  let ndkEntries;
  try {
    ndkEntries = readdirSync(ndkRoot, { withFileTypes: true });
  } catch {
    return fail('The selected SDK does not contain an NDK directory.');
  }
  if (ndkEntries.some(entry => !entry.isDirectory() || entry.isSymbolicLink())) {
    fail('The isolated SDK NDK directory has an unexpected entry.');
  }
  const installedVersions = ndkEntries.map(entry => entry.name).sort();
  if (installedVersions.length !== 1 || installedVersions[0] !== PINNED_NDK_VERSION) {
    fail(`The isolated SDK must contain exactly NDK ${PINNED_NDK_VERSION}; found ${installedVersions.join(', ') || 'none'}.`);
  }

  const sourcePropertiesPath = join(expectedNdkHome, 'source.properties');
  let sourceProperties: string;
  try {
    sourceProperties = readFileSync(sourcePropertiesPath, 'utf8');
  } catch {
    return fail(`NDK ${PINNED_NDK_VERSION} is missing source.properties.`);
  }
  const revisions = [...sourceProperties.matchAll(/^[\t ]*Pkg\.Revision[\t ]*=[\t ]*([^\s]+)[\t ]*$/gm)];
  if (revisions.length !== 1 || revisions[0][1] !== PINNED_NDK_VERSION) {
    fail(`NDK source.properties must report exactly ${PINNED_NDK_VERSION}.`);
  }

  return {
    version: PINNED_NDK_VERSION,
    sdkRoot,
    ndkHome: expectedNdkHome,
    sourcePropertiesPath,
    installedVersions,
  };
}

function escapeKotlinRawString(value: string, label: string): string {
  if (!isAbsolute(value)) fail(`${label} must be absolute.`);
  if (/[\r\n]/.test(value) || value.includes('"""')) {
    fail(`${label} cannot be represented safely in a Kotlin raw string.`);
  }
  return value.replace(/\$/g, "${'$'}");
}

function replaceOne(source: string, pattern: RegExp, replacement: (match: RegExpMatchArray) => string, label: string): string {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1 || matches[0].index === undefined) {
    fail(`Unsupported generated BuildTask callback shape: expected exactly one ${label}.`);
  }
  const match = matches[0];
  return `${source.slice(0, match.index)}${replacement(match)}${source.slice(match.index + match[0].length)}`;
}

export function patchBuildTaskCallback(
  source: string,
  nodeExecutable: string,
  tauriCliPath: string,
): BuildTaskCallbackPatch {
  const executablePath = escapeKotlinRawString(nodeExecutable, 'Node executable');
  const cliPath = escapeKotlinRawString(tauriCliPath, 'Tauri CLI path');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const executableLine = /^([\t ]*)val executable = """([^"\r\n]*)""";[\t ]*(\r?)$/gm;
  const argsLine = /^([\t ]*)val args = listOf\(([^\r\n]*)\);[\t ]*(\r?)$/gm;
  const executableMatches = [...source.matchAll(executableLine)];
  const argsMatches = [...source.matchAll(argsLine)];
  if (executableMatches.length !== 1 || argsMatches.length !== 1) {
    fail('Unsupported generated BuildTask callback shape: expected one executable and one argv declaration.');
  }

  const executableMatch = executableMatches[0];
  const argsMatch = argsMatches[0];
  const generatedArgs = '"tauri", "android", "android-studio-script"';
  const patchedArgs = `"""${cliPath}""", "android", "android-studio-script"`;
  if (argsMatch[2] !== generatedArgs && argsMatch[2] !== patchedArgs) {
    fail('Unsupported generated BuildTask callback arguments; refusing to rewrite an unfamiliar Tauri template.');
  }

  const requiredScaffold = [
    /^\s*val rootDirRel = rootDirRel \?: throw GradleException\("rootDirRel cannot be null"\)\s*$/m,
    /^\s*workingDir\(File\(project\.projectDir, rootDirRel\)\)\s*$/m,
    /^\s*executable\(executable\)\s*$/m,
    /^\s*args\(args\)\s*$/m,
  ];
  if (requiredScaffold.some(pattern => !pattern.test(source))) {
    fail('Unsupported generated BuildTask callback scaffold; expected the locked Tauri Gradle task.');
  }

  const nextExecutableLine = `${executableMatch[1]}val executable = """${executablePath}""";${executableMatch[3]}`;
  const nextArgsLine = `${argsMatch[1]}val args = listOf(${patchedArgs});${argsMatch[3]}`;
  const currentExecutableLine = executableMatch[0].trimEnd();
  const currentArgsLine = argsMatch[0].trimEnd();
  const wantedExecutableLine = nextExecutableLine.trimEnd();
  const wantedArgsLine = nextArgsLine.trimEnd();
  if (currentExecutableLine === wantedExecutableLine && currentArgsLine === wantedArgsLine) {
    return { buildTaskKotlin: source, changed: false };
  }

  let updated = source;
  updated = replaceOne(updated, executableLine, () => nextExecutableLine, 'executable declaration');
  updated = replaceOne(updated, argsLine, () => nextArgsLine, 'argv declaration');
  if (updated.split(newline).length !== source.split(newline).length) {
    fail('BuildTask patch changed the generated line count unexpectedly.');
  }
  return { buildTaskKotlin: updated, changed: true };
}

export function verifyGradleNdkVersion(gradle: string, expectedVersion = PINNED_NDK_VERSION): string {
  const declarations = [...gradle.matchAll(/^[\t ]*ndkVersion[\t ]*=[\t ]*"([^"]+)"[\t ]*\r?$/gm)];
  if (declarations.length !== 1 || declarations[0][1] !== expectedVersion) {
    const actual = declarations.map(match => match[1]).join(', ') || 'missing';
    fail(`Gradle must declare exactly NDK ${expectedVersion}; found ${actual}.`);
  }
  return expectedVersion;
}

function assertProjectRoot(projectRoot: string): string {
  if (!isAbsolute(projectRoot)) fail('An explicit absolute candidate project root is required.');
  const requestedRoot = resolve(projectRoot);
  for (let ancestor = requestedRoot; ; ancestor = dirname(ancestor)) {
    if (lstatSync(ancestor).isSymbolicLink()) fail('Candidate project root cannot traverse symbolic links.');
    if (dirname(ancestor) === ancestor) break;
  }
  return resolveRealDirectory(requestedRoot, 'Candidate project root');
}

function generatedFile(projectRoot: string, parts: string[]): string {
  let current = projectRoot;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let metadata;
    try {
      metadata = lstatSync(current);
    } catch {
      return fail(`Generated Android file is missing: ${relative(projectRoot, current)}.`);
    }
    if (metadata.isSymbolicLink() || (index === parts.length - 1 ? !metadata.isFile() : !metadata.isDirectory())) {
      fail(`Generated Android path is not an ordinary project file: ${relative(projectRoot, current)}.`);
    }
  }
  const local = relative(projectRoot, current);
  if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    fail('Generated Android file escaped the candidate project root.');
  }
  return current;
}

function resolveCallbackTools(projectRoot: string, env: NodeJS.ProcessEnv): { nodeExecutable: string; tauriCliPath: string } {
  const requestedNode = requiredEnv(env, 'BETA_ANDROID_NODE_EXECUTABLE');
  let nodeExecutable: string;
  try {
    nodeExecutable = realpathSync(requestedNode);
  } catch {
    return fail('The configured Node executable does not exist.');
  }
  if (!isAbsolute(nodeExecutable) || !lstatSync(nodeExecutable).isFile()) fail('The configured Node executable must resolve to an absolute file.');

  let tauriCliPath: string;
  try {
    tauriCliPath = realpathSync(join(projectRoot, ...TAURI_CLI_RELATIVE_PATH));
  } catch {
    return fail('The locked @tauri-apps/cli tauri.js entry is missing from the candidate checkout.');
  }
  if (!isAbsolute(tauriCliPath) || !lstatSync(tauriCliPath).isFile()) fail('The Tauri CLI entry must resolve to an absolute file.');
  const localCliPath = relative(projectRoot, tauriCliPath);
  if (!localCliPath || localCliPath === '..' || localCliPath.startsWith(`..${sep}`) || isAbsolute(localCliPath)) {
    fail('The Tauri CLI entry must resolve inside the candidate checkout.');
  }

  const packagePath = join(dirname(tauriCliPath), 'package.json');
  let cliPackage: unknown;
  try {
    cliPackage = JSON.parse(readFileSync(packagePath, 'utf8')) as unknown;
  } catch {
    return fail('The locked Tauri CLI package metadata cannot be read.');
  }
  if (!cliPackage || typeof cliPackage !== 'object' || !('version' in cliPackage)
    || cliPackage.version !== TAURI_CLI_VERSION) {
    fail(`The candidate Tauri CLI must be version ${TAURI_CLI_VERSION}.`);
  }
  return { nodeExecutable, tauriCliPath };
}

function writeGeneratedFile(path: string, before: string, after: string): void {
  const temporary = `${path}.beta-android-ci-${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  let ownsTemporary = false;
  try {
    descriptor = openSync(temporary, 'wx');
    ownsTemporary = true;
    writeFileSync(descriptor, after, 'utf8');
    closeSync(descriptor);
    descriptor = undefined;
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) fail('Generated BuildTask was replaced by a non-file; preserving it.');
    if (readFileSync(path, 'utf8') !== before) fail('Generated BuildTask changed during patching; preserving the newer file.');
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (ownsTemporary) {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          process.stderr.write('[beta-android-ci] owned temporary file could not be removed\n');
        }
      }
    }
  }
}

function inspectPreparedProject(projectRoot: string, env: NodeJS.ProcessEnv) {
  const ndk = verifyInstalledNdk(env);
  const { nodeExecutable, tauriCliPath } = resolveCallbackTools(projectRoot, env);
  const gradlePath = generatedFile(projectRoot, BUILD_GRADLE_RELATIVE_PATH);
  const buildTaskPath = generatedFile(projectRoot, BUILD_TASK_RELATIVE_PATH);
  const gradleNdkVersion = verifyGradleNdkVersion(readFileSync(gradlePath, 'utf8'), ndk.version);
  const buildTaskSource = readFileSync(buildTaskPath, 'utf8');
  const callback = patchBuildTaskCallback(buildTaskSource, nodeExecutable, tauriCliPath);
  return { ndk, nodeExecutable, tauriCliPath, gradlePath, buildTaskPath, buildTaskSource, gradleNdkVersion, callback };
}

export function prepareBetaAndroidCi(projectRoot: string, env: NodeJS.ProcessEnv = process.env) {
  const root = assertProjectRoot(projectRoot);
  const inspected = inspectPreparedProject(root, env);
  if (inspected.callback.changed) {
    writeGeneratedFile(
      inspected.buildTaskPath,
      inspected.buildTaskSource,
      inspected.callback.buildTaskKotlin,
    );
  }
  const postcondition = verifyPreparedBetaAndroidCi(root, env);
  return {
    changed: inspected.callback.changed,
    ...postcondition,
  };
}

export function verifyPreparedBetaAndroidCi(projectRoot: string, env: NodeJS.ProcessEnv = process.env) {
  const root = assertProjectRoot(projectRoot);
  const inspected = inspectPreparedProject(root, env);
  if (inspected.callback.changed) fail('Generated BuildTask callback is missing the absolute CLI invocation.');
  return {
    ndkVersion: inspected.ndk.version,
    ndkHome: inspected.ndk.ndkHome,
    gradleNdkVersion: inspected.gradleNdkVersion,
    callbackExecutable: inspected.nodeExecutable,
    callbackArgv: [inspected.tauriCliPath, 'android', 'android-studio-script'],
    buildTaskPath: inspected.buildTaskPath,
  };
}

function parseProjectRoot(args: string[]): string {
  const projectRoot = args[1];
  if (args.length !== 2 || args[0] !== '--project-root' || !projectRoot) {
    fail('Expected exactly --project-root <absolute-path>.');
  }
  if (!isAbsolute(projectRoot)) fail('The candidate project root must be absolute.');
  return projectRoot;
}

function main(args: string[]): void {
  const [mode, ...rest] = args;
  if (mode === 'verify-ndk' && rest.length === 0) {
    process.stdout.write(`${JSON.stringify(verifyInstalledNdk())}\n`);
    return;
  }
  if (mode === 'patch-callback') {
    process.stdout.write(`${JSON.stringify(prepareBetaAndroidCi(parseProjectRoot(rest)))}\n`);
    return;
  }
  if (mode === 'verify-prepared') {
    const result = verifyPreparedBetaAndroidCi(parseProjectRoot(rest));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  fail('Expected verify-ndk, patch-callback --project-root <absolute-path>, or verify-prepared --project-root <absolute-path>.');
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
