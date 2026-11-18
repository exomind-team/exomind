import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statfsSync, writeFileSync } from 'node:fs';
import { freemem, totalmem, tmpdir, setPriority, constants as osConstants } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startSupervisedCommand, readSupervisedCommand } from './supervised-command';
import { nativeBindings, verifyIntentPlan, verifyNativeProof, verifyUiProof, UI_REGRESSIONS } from './beta-contract-evidence';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SPEC = 'specs/beta-runtime-invariants.spec.md';
const LIMITS = { totalMs: 900000, phaseMs: 600000, idleMs: 180000, pollMs: 250, maxOutputBytes: 32*1024*1024 };

function outputDirectory(raw: string | undefined): string {
  if (!raw || !isAbsolute(raw)) throw new Error('Use --out <new absolute directory outside the repository>');
  const out = join(realpathSync(dirname(raw)), basename(raw));
  const path = relative(realpathSync(ROOT), out);
  if (!path || (!path.startsWith(`..${sep}`) && !isAbsolute(path))) throw new Error('Evidence must stay outside the repository');
  return out;
}
function nativeEnvironment(out: string): NodeJS.ProcessEnv {
  const cache = resolve(process.env.CARGO_TARGET_DIR ?? join(dirname(out),'cargo-target'));
  mkdirSync(cache,{recursive:true});
  const cachePath = relative(realpathSync(ROOT),realpathSync(cache));
  if (!cachePath || (!cachePath.startsWith(`..${sep}`) && !isAbsolute(cachePath))) throw new Error('Cargo cache must stay outside the repository');
  const env: NodeJS.ProcessEnv = {...process.env, CARGO_BUILD_JOBS:'1', CARGO_PROFILE_DEV_DEBUG:'0', CARGO_PROFILE_DEV_INCREMENTAL:'false',
    CARGO_PROFILE_DEV_CODEGEN_UNITS:'16', RUST_TEST_THREADS:'1', CARGO_TERM_COLOR:'never',
    CARGO_TARGET_DIR:cache};
  // This gate runs host tests. Android/cross-target shell settings are not proof
  // for this profile and must not bypass the Windows low-memory link policy.
  delete env.CARGO_BUILD_TARGET;
  if (process.platform === 'win32') {
    const rust = spawnSync('rustc',['--print','sysroot'],{encoding:'utf8',windowsHide:true,timeout:10000});
    if (rust.status !== 0) throw new Error('Native gate requires rustc');
    const host = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    const linker = join(rust.stdout.trim(),'lib/rustlib',host,'bin/rust-lld.exe');
    if (!existsSync(linker)) throw new Error('Native gate requires the installed rust-lld linker');
    env[`CARGO_TARGET_${host.toUpperCase().replaceAll('-','_')}_LINKER`] = linker;
    env.RUSTFLAGS = '-C linker-flavor=lld-link -C link-arg=/threads:1 -C link-arg=/DEBUG:NONE';
    delete env.CARGO_ENCODED_RUSTFLAGS;
  }
  return env;
}
function checkDisk(paths: string[]) {
  for (const path of paths) {
    const stats = statfsSync(path,{bigint:true});
    if (stats.bavail*stats.bsize < 2n*1024n**3n) throw new Error(`Disk admission: less than 2 GiB free at ${path}; GC unused project artifacts before retrying`);
  }
}
function checkMemory() {
  if (process.platform === 'win32' && (freemem() < 12*1024**3 || freemem()/totalmem() < .35)) throw new Error('Windows memory gate: need 12 GiB and 35% free');
}
function runChecks(out: string, base?: string) {
  const checks = join(out,'checks'); mkdirSync(checks);
  let env: NodeJS.ProcessEnv = process.env;
  const summary: Record<string,unknown> = {passed:false,scope:'source-regressions-only',notAssessed:['packaged-runtime','physical-devices','visual-approval','energy','full-beta'],startedAt:new Date().toISOString()};
  let phase = 'start';
  const command = (name: string, executable: string, args: string[], heavy = false) => {
    phase = name; if (heavy) { checkMemory(); checkDisk([out,env.CARGO_TARGET_DIR!,tmpdir()]); }
    process.stdout.write(JSON.stringify({phase})+'\n');
    const result = spawnSync(executable,args,{cwd:ROOT,env,encoding:'utf8',windowsHide:true,timeout:LIMITS.phaseMs,maxBuffer:LIMITS.maxOutputBytes});
    writeFileSync(join(checks,`${name}.stdout`),result.stdout ?? '',{flag:'wx'});
    writeFileSync(join(checks,`${name}.stderr`),result.stderr ?? '',{flag:'wx'});
    if (result.error || result.status !== 0) throw new Error(`${name} did not complete successfully; inspect its evidence`);
    return result.stdout;
  };
  try {
    phase = 'resource-admission';
    checkDisk([out,tmpdir()]);
    env = nativeEnvironment(out);
    checkDisk([env.CARGO_TARGET_DIR!]);
    const version = command('tool-version','agent-spec',['--version']).trim();
    if (version !== 'agent-spec 1.4.0') throw new Error('This pilot requires agent-spec 1.4.0; no silent tool substitution');
    summary.agentSpec = version;
    summary.repositoryBase = command('repository-base','git',['rev-parse','HEAD']).trim();
    summary.specSha256 = createHash('sha256').update(readFileSync(join(ROOT,SPEC))).digest('hex');
    command('knowledge','agent-spec',['lint-knowledge','--knowledge','knowledge','--gate']);
    const contract = nativeBindings(JSON.parse(command('contract','agent-spec',['contract',SPEC,'--format','json'])));
    verifyIntentPlan(JSON.parse(command('intent-plan','agent-spec',['requirements','plan','--knowledge','knowledge','--specs','specs','--format','json','--gate'])),contract.specName);
    command('lint','agent-spec',['lint',SPEC,'--min-score','0.7']);
    command('structural','agent-spec',['check-structure','--code',ROOT,'--forbid','beta_overlay_main','--in','src-tauri/src/beta_native.rs']);
    const changes: string[] = [];
    let files: string[];
    if (base) {
      if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('--base requires an exact commit SHA');
      files = command('changed-paths','git',['diff','--no-renames','--name-only','-z',base,'HEAD','--']).split('\0').filter(Boolean);
      summary.boundaryScope = 'commit-diff';
    } else {
      // CLI 1.4.0 auto-detection supplies non-verbatim absolute Windows paths,
      // while its boundary root is canonical (\\?\). Literal relative argv
      // avoids that mismatch without changing the CLI's boundary semantics.
      files = [...new Set([
        ...command('changed-paths','git',['diff','--no-renames','--name-only','-z','HEAD','--']).split('\0'),
        ...command('untracked-paths','git',['ls-files','--others','--exclude-standard','-z']).split('\0'),
      ].filter(Boolean))];
      summary.boundaryScope = 'worktree';
    }
    for (const file of files) changes.push('--change',file);
    summary.changedPaths = files;
    const uiFile = join(checks,'ui.json');
    command('ui','node',['node_modules/vitest/vitest.mjs','run',...UI_REGRESSIONS,'--maxWorkers=1','--reporter=json',`--outputFile=${uiFile}`],true);
    summary.ui = verifyUiProof(ROOT,JSON.parse(readFileSync(uiFile,'utf8')));
    const lifecycle = JSON.parse(command('lifecycle','agent-spec',['lifecycle',SPEC,'--code',ROOT,...changes,'--ai-mode','off','--review-mode','strict','--min-score','0.7','--format','json','--run-log-dir',join(out,'lifecycle')],true));
    summary.native = verifyNativeProof(contract,lifecycle);
    summary.passed = true;
  } catch (error) {
    summary.failure = {phase,message:error instanceof Error ? error.message : 'Unknown gate failure'};
    process.exitCode = 1;
  } finally {
    summary.finishedAt = new Date().toISOString();
    writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2),{flag:'wx'});
    process.stdout.write(JSON.stringify(summary)+'\n');
  }
}

async function main() {
  const {values} = parseArgs({options:{out:{type:'string'},base:{type:'string'},worker:{type:'boolean',default:false}},allowPositionals:false});
  const out = outputDirectory(values.out);
  if (values.worker) { runChecks(out,values.base); return; }
  if (existsSync(out)) throw new Error('Use a new evidence directory; earlier results are preserved');
  mkdirSync(out); setPriority(0,osConstants.priority.PRIORITY_BELOW_NORMAL);
  if (process.platform !== 'win32') { runChecks(out,values.base); return; }
  checkMemory();
  const receipt = await startSupervisedCommand({version:1,artifactDir:join(out,'supervision'),executable:process.execPath,
    args:[fileURLToPath(import.meta.url),'--worker','--out',out,...(values.base?['--base',values.base]:[])],cwd:ROOT,
    timeoutMs:LIMITS.totalMs,noProgressTimeoutMs:LIMITS.idleMs});
  const deadline = Date.now()+LIMITS.totalMs+30000;
  while (Date.now() < deadline) {
    const {result} = readSupervisedCommand(receipt.dir);
    if (result) {
      const passed = result.reason === 'completed' && result.exitCode === 0 && result.cleanup.confirmed;
      process.stdout.write(JSON.stringify({passed,scope:'source-regressions-only',evidence:out,result})+'\n');
      if (!passed) process.exitCode = 1;
      return;
    }
    await new Promise(resolve=>setTimeout(resolve,LIMITS.pollMs));
  }
  throw new Error('Supervision terminal state was not observed; do not launch another gate');
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main().catch(error=>{process.stderr.write(`${error instanceof Error ? error.message : 'Beta gate failed'}\n`);process.exitCode=1;});
