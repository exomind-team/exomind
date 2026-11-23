import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchBuildTaskCallback, prepareBetaAndroidCi, verifyInstalledNdk, verifyGradleNdkVersion, verifyPreparedBetaAndroidCi } from '../../../scripts/dev/beta-android-ci';

const PINNED_NDK = '30.0.16248370';
const TEMP_ROOTS: string[] = [];

const generatedBuildTask = `import java.io.File
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException

open class BuildTask : DefaultTask() {
    @TaskAction
    fun assemble() {
        val executable = """node""";
        runTauriCli(executable)
    }

    fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = listOf("tauri", "android", "android-studio-script");
        project.exec {
            workingDir(File(project.projectDir, rootDirRel))
            executable(executable)
            args(args)
        }.assertNormalExitValue()
    }
}
`;

afterEach(() => {
  for (const root of TEMP_ROOTS.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeSdk(versions: string[] = [PINNED_NDK]) {
  const root = mkdtempSync(join(tmpdir(), 'beta-android-ci-'));
  TEMP_ROOTS.push(root);
  const sdkRoot = join(root, 'sdk');
  const ndkRoot = join(sdkRoot, 'ndk');
  mkdirSync(ndkRoot, { recursive: true });
  for (const version of versions) {
    const versionRoot = join(ndkRoot, version);
    mkdirSync(versionRoot, { recursive: true });
    writeFileSync(join(versionRoot, 'source.properties'), `Pkg.Desc = Android NDK\nPkg.Revision = ${version}\n`);
  }
  const ndkHome = join(ndkRoot, PINNED_NDK);
  return {
    sdkRoot,
    ndkHome,
    env: {
      ANDROID_HOME: sdkRoot,
      ANDROID_SDK_ROOT: sdkRoot,
      NDK_HOME: ndkHome,
      ANDROID_NDK_HOME: ndkHome,
      ANDROID_NDK_VERSION: PINNED_NDK,
      EXOMIND_ANDROID_NDK_VERSION: PINNED_NDK,
    },
  };
}

describe('Beta Android CI preparation', () => {
  it('repairs the generated Node callback to invoke the absolute Tauri CLI script and is idempotent', () => {
    const nodeExecutable = join(tmpdir(), 'node', 'bin', 'node');
    const tauriCliPath = join(tmpdir(), 'candidate', 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

    const first = patchBuildTaskCallback(generatedBuildTask, nodeExecutable, tauriCliPath);
    expect(first.changed).toBe(true);
    expect(first.buildTaskKotlin).toContain(`val executable = """${nodeExecutable}""";`);
    expect(first.buildTaskKotlin).toContain(
      `val args = listOf("""${tauriCliPath}""", "android", "android-studio-script");`,
    );

    const second = patchBuildTaskCallback(first.buildTaskKotlin, nodeExecutable, tauriCliPath);
    expect(second.changed).toBe(false);
    expect(second.buildTaskKotlin).toBe(first.buildTaskKotlin);
  });

  it('fails closed when Tauri changes the generated callback shape or arguments', () => {
    const nodeExecutable = join(tmpdir(), 'node', 'bin', 'node');
    const tauriCliPath = join(tmpdir(), 'candidate', 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
    const unexpectedArgs = generatedBuildTask.replace(
      'listOf("tauri", "android", "android-studio-script")',
      'listOf("tauri", "android", "build")',
    );
    const duplicateArgs = generatedBuildTask.replace(
      '        project.exec {',
      '        val args = listOf("tauri", "android", "android-studio-script");\n        project.exec {',
    );

    expect(() => patchBuildTaskCallback(unexpectedArgs, nodeExecutable, tauriCliPath)).toThrow(/shape|callback|arguments/i);
    expect(() => patchBuildTaskCallback(duplicateArgs, nodeExecutable, tauriCliPath)).toThrow(/exactly one|shape/i);
    expect(() => patchBuildTaskCallback(generatedBuildTask, 'node', tauriCliPath)).toThrow(/absolute/i);
    expect(() => patchBuildTaskCallback(generatedBuildTask, nodeExecutable, 'node_modules/@tauri-apps/cli/tauri.js')).toThrow(/absolute/i);
  });

  it('accepts only the pinned NDK as the sole installed NDK under the selected SDK', () => {
    const sdk = makeSdk();
    const evidence = verifyInstalledNdk(sdk.env);
    expect(evidence.version).toBe(PINNED_NDK);
    expect(evidence.sdkRoot).toBe(sdk.sdkRoot);
    expect(evidence.ndkHome).toBe(sdk.ndkHome);
  });

  it('detects the runner NDK drift fixture where the selected SDK contains both 28 and 30', () => {
    const sdk = makeSdk(['28.0.13004108', PINNED_NDK]);
    const oldEnv = {
      ...sdk.env,
      NDK_HOME: join(sdk.sdkRoot, 'ndk', '28.0.13004108'),
      ANDROID_NDK_HOME: join(sdk.sdkRoot, 'ndk', '28.0.13004108'),
      ANDROID_NDK_VERSION: '28.0.13004108',
      EXOMIND_ANDROID_NDK_VERSION: '28.0.13004108',
    };

    expect(() => verifyInstalledNdk(oldEnv)).toThrow(/exactly one|30\.0\.16248370|28\.0\.13004108/i);
  });

  it('requires AGP to use the same actual NDK revision selected for Rust', () => {
    expect(() => verifyGradleNdkVersion('android {\n    ndkVersion = "28.0.13004108"\n}\n')).toThrow(/30\.0\.16248370/);
    expect(verifyGradleNdkVersion(`android {\n    ndkVersion = "${PINNED_NDK}"\n}\n`)).toBe(PINNED_NDK);
  });

  it('repairs and re-verifies a fresh candidate through the actual recipe entry points', () => {
    const sdk = makeSdk();
    const project = join(sdk.sdkRoot, '..', 'candidate with spaces');
    const cli = join(project, 'node_modules', '@tauri-apps', 'cli');
    const app = join(project, 'src-tauri', 'gen', 'android', 'app');
    const kotlin = join(project, 'src-tauri', 'gen', 'android', 'buildSrc', 'src', 'main', 'java', 'com', 'exomind', 'app', 'v06', 'beta', 'kotlin');
    for (const directory of [cli, app, kotlin]) mkdirSync(directory, { recursive: true });
    writeFileSync(join(cli, 'package.json'), JSON.stringify({ version: '2.10.1' }));
    writeFileSync(join(cli, 'tauri.js'), '// Synthetic candidate CLI, never executed.');
    writeFileSync(join(app, 'build.gradle.kts'), `android {\n    ndkVersion = "${PINNED_NDK}"\n}\n`);
    const task = join(kotlin, 'BuildTask.kt');
    writeFileSync(task, generatedBuildTask);
    const env = { ...sdk.env, BETA_ANDROID_NODE_EXECUTABLE: process.execPath };

    expect(() => verifyPreparedBetaAndroidCi(project, env)).toThrow(/absolute CLI/);
    const result = prepareBetaAndroidCi(project, env);
    expect(result.changed).toBe(true);
    expect(result.ndkVersion).toBe(PINNED_NDK);
    expect(result.gradleNdkVersion).toBe(result.ndkVersion);
    expect(result.callbackArgv.slice(1)).toEqual(['android', 'android-studio-script']);
    const repaired = readFileSync(task, 'utf8');
    expect(prepareBetaAndroidCi(project, env).changed).toBe(false);
    expect(readFileSync(task, 'utf8')).toBe(repaired);
    expect(verifyPreparedBetaAndroidCi(project, env).callbackArgv).toEqual(result.callbackArgv);
  });
});

describe('Beta Android workflow contract', () => {
  it('loads the CI helper from the resolved recipe SHA and retains both frozen ABI targets', async () => {
    const { readFileSync } = await import('node:fs');
    const workflow = readFileSync('.github/workflows/beta-build-validation.yml', 'utf8');
    expect(workflow).toContain('ref: ${{ needs.resolve-source.outputs.recipe_sha }}\n          path: recipe');
    expect(workflow).toContain('bun recipe/scripts/dev/beta-android-ci.ts');
    expect(workflow).toContain('--apk --split-per-abi -t aarch64 x86_64');
    expect(workflow).toContain("ANDROID_NDK_VERSION: '30.0.16248370'");
    expect(workflow).not.toContain('28.0.13004108');
    expect(workflow).toContain("default: 85f7df92d0eccf1de624ab9220d4d8944797f28b");
    expect(workflow).toContain("default: 0.6.0-beta16");
    expect(workflow).toContain('ndk:ndkVersion');
    const freshInit = workflow.indexOf('tauri.js android init');
    const manifestPreparation = workflow.indexOf('bun scripts/dev/android-manifest-permission.ts');
    const betaPreparation = workflow.indexOf('bun scripts/dev/beta-android-prepare.ts');
    expect(freshInit).toBeGreaterThanOrEqual(0);
    expect(manifestPreparation).toBeGreaterThan(freshInit);
    expect(betaPreparation).toBeGreaterThan(manifestPreparation);
  });

  it('builds Beta-only Rust features and supports debug/release size comparisons', async () => {
    const { readFileSync } = await import('node:fs');
    const workflow = readFileSync('.github/workflows/beta-build-validation.yml', 'utf8');
    expect(workflow).toContain('android_build_profile:');
    expect(workflow).toContain('          - debug\n          - release');
    expect(workflow).toContain('--locked --no-default-features --features custom-protocol,beta-native-only');
    expect(workflow).toContain('Sign release-profile APKs with an ephemeral comparison key');
    expect(workflow).toContain("assert.equal(/^application-debuggable\\b/m.test(badging),profile==='debug')");
    expect(workflow).toContain("cargo_features:['custom-protocol','beta-native-only'],cargo_default_features:false");
  });
});
