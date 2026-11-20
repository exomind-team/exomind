import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BETA_BUILD_REQUEST_PATH = '.github/beta-build-candidate.json';
const BETA_BUILD_REQUEST_KEYS = ['expected_sha', 'expected_version', 'source_ref'];
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const BETA_VERSION_PATTERN = /^0\.6\.0-beta[1-9][0-9]*$/;
const LOCKED_ANDROID_VERSION_CODES: Readonly<Partial<Record<string, number>>> = {
  '0.6.0-beta16': 6016,
  '0.6.0-beta17': 6017,
  '0.6.0-beta18': 6018,
  '0.6.0-beta19': 6019,
};

export type BetaBuildRequestErrorCode =
  | 'invalid_event'
  | 'invalid_push_ref'
  | 'request_file_unchanged'
  | 'invalid_request_json'
  | 'request_schema'
  | 'invalid_sha'
  | 'source_sha_mismatch'
  | 'invalid_version'
  | 'recipe_sha_invalid'
  | 'recipe_head_mismatch'
  | 'invalid_push_range'
  | 'candidate_head_mismatch'
  | 'beta_identity_mismatch'
  | 'version_code_mismatch';

export class BetaBuildRequestError extends Error {
  constructor(readonly code: BetaBuildRequestErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'BetaBuildRequestError';
  }
}

export type BetaBuildRequestFields = {
  source_ref: string;
  expected_sha: string;
  expected_version: string;
};

export type BetaBuildRequest = {
  sourceRef: string;
  expectedSha: string;
  expectedVersion: string;
  recipeSha: string;
};

export type BetaBuildRequestInput = {
  eventName: string;
  eventRef: string;
  recipeSha: string;
  recipeHead: string;
  changedPaths?: readonly string[];
  requestText?: string;
  dispatchInputs?: unknown;
};

function fail(code: BetaBuildRequestErrorCode, message: string): never {
  throw new BetaBuildRequestError(code, message);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseRequestFields(value: unknown): BetaBuildRequestFields {
  const record = asRecord(value);
  if (!record || Object.keys(record).sort().join('\0') !== [...BETA_BUILD_REQUEST_KEYS].sort().join('\0')) {
    fail('request_schema', 'Request must contain exactly source_ref, expected_sha, and expected_version.');
  }

  const { source_ref, expected_sha, expected_version } = record;
  if (typeof source_ref !== 'string' || typeof expected_sha !== 'string' || typeof expected_version !== 'string') {
    fail('request_schema', 'All request fields must be strings.');
  }

  if (!SHA_PATTERN.test(source_ref) || !SHA_PATTERN.test(expected_sha)) {
    fail('invalid_sha', 'source_ref and expected_sha must each be exactly 40 hexadecimal characters.');
  }

  const normalizedSourceRef = source_ref.toLowerCase();
  const normalizedExpectedSha = expected_sha.toLowerCase();
  if (normalizedSourceRef !== normalizedExpectedSha) {
    fail('source_sha_mismatch', 'source_ref must be the same immutable commit SHA as expected_sha.');
  }

  if (!BETA_VERSION_PATTERN.test(expected_version)) {
    fail('invalid_version', 'expected_version must use the canonical 0.6.0-betaN format.');
  }

  return {
    source_ref: normalizedSourceRef,
    expected_sha: normalizedExpectedSha,
    expected_version,
  };
}

function parseRequestText(text: string): BetaBuildRequestFields {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    fail('invalid_request_json', 'Candidate request file is not valid JSON.');
  }
  return parseRequestFields(value);
}

export function resolveBetaBuildRequest(input: BetaBuildRequestInput): BetaBuildRequest {
  if (!SHA_PATTERN.test(input.recipeSha)) {
    fail('recipe_sha_invalid', 'Workflow recipe SHA must be a 40-character hexadecimal commit SHA.');
  }
  const recipeSha = input.recipeSha.toLowerCase();
  if (input.recipeHead.toLowerCase() !== recipeSha) {
    fail('recipe_head_mismatch', 'Checked-out workflow recipe does not match the triggering commit.');
  }

  let fields: BetaBuildRequestFields;
  if (input.eventName === 'push') {
    if (input.eventRef !== 'refs/heads/dev-0.6') {
      fail('invalid_push_ref', 'Candidate request pushes are accepted only from dev-0.6.');
    }
    if (!input.changedPaths?.includes(BETA_BUILD_REQUEST_PATH)) {
      fail('request_file_unchanged', 'Push did not add or modify the explicit candidate request file.');
    }
    if (typeof input.requestText !== 'string') {
      fail('invalid_request_json', 'Candidate request file could not be read.');
    }
    fields = parseRequestText(input.requestText);
  } else if (input.eventName === 'workflow_dispatch') {
    fields = parseRequestFields(input.dispatchInputs);
  } else {
    fail('invalid_event', `Unsupported build validation event: ${input.eventName || '<empty>'}.`);
  }

  return {
    sourceRef: fields.source_ref,
    expectedSha: fields.expected_sha,
    expectedVersion: fields.expected_version,
    recipeSha,
  };
}

export function validateBetaCandidateIdentity(
  request: BetaBuildRequest,
  actualHead: string,
  rawConfig: unknown,
): void {
  if (!SHA_PATTERN.test(actualHead) || actualHead.toLowerCase() !== request.expectedSha) {
    fail('candidate_head_mismatch', 'Checked-out payload HEAD does not match the requested source SHA.');
  }

  const config = asRecord(rawConfig);
  const build = asRecord(config?.build);
  const app = asRecord(config?.app);
  const security = asRecord(app?.security);
  const bundle = asRecord(config?.bundle);
  const android = asRecord(bundle?.android);
  const windows = app?.windows;
  const capabilities = security?.capabilities;
  const mainWindow = Array.isArray(windows)
    ? windows.find((window) => asRecord(window)?.label === 'main')
    : undefined;

  if (
    config?.identifier !== 'com.exomind.app.v06.beta'
    || config.productName !== 'ExoMind Beta'
    || config.version !== request.expectedVersion
    || build?.beforeBuildCommand !== 'bun run build:web'
    || asRecord(mainWindow)?.url !== 'beta.html'
    || !Array.isArray(capabilities)
    || capabilities.length !== 2
    || capabilities[0] !== 'beta'
    || capabilities[1] !== 'beta-overlay'
  ) {
    fail('beta_identity_mismatch', 'Candidate does not match the expected ExoMind Beta identity and entry contract.');
  }

  const versionCode = android?.versionCode;
  if (!Number.isSafeInteger(versionCode) || Number(versionCode) <= 0) {
    fail('beta_identity_mismatch', 'Candidate must declare a positive Android versionCode.');
  }
  const lockedVersionCode = LOCKED_ANDROID_VERSION_CODES[request.expectedVersion];
  if (lockedVersionCode !== undefined && versionCode !== lockedVersionCode) {
    fail('version_code_mismatch', `${request.expectedVersion} must retain Android versionCode ${lockedVersionCode}.`);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is missing.`);
  }
  return value;
}

function writeOutputs(values: Record<string, string>): void {
  const outputPath = requiredEnv('GITHUB_OUTPUT');
  appendFileSync(outputPath, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, 'utf8');
}

function readChangedPaths(eventPath: string, recipeSha: string): string[] {
  const event = asRecord(JSON.parse(readFileSync(eventPath, 'utf8')) as unknown);
  const before=event?.before,after=event?.after;
  if(typeof before!=='string'||!SHA_PATTERN.test(before)||typeof after!=='string'||!SHA_PATTERN.test(after)
    ||after.toLowerCase()!==recipeSha.toLowerCase()||event?.deleted===true) {
    fail('invalid_push_range','Push must identify the exact before/after commits of this workflow recipe.');
  }
  // Actions deliberately omits added/modified/removed commit file arrays.
  // Use the complete push range, including request changes before the tip commit.
  const args=/^0+$/.test(before)
    ? ['ls-tree','--name-only','-z',after,'--',BETA_BUILD_REQUEST_PATH]
    : ['diff','--no-renames','--name-only','-z',before,after,'--',BETA_BUILD_REQUEST_PATH];
  return execFileSync('git',args,{encoding:'utf8',timeout:10000,maxBuffer:1024*1024,stdio:'pipe'}).split('\0').filter(Boolean);
}

function resolveFromEnvironment(): void {
  const eventName = requiredEnv('GITHUB_EVENT_NAME');
  const recipeSha = requiredEnv('GITHUB_SHA');
  const recipeHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const input: BetaBuildRequestInput = {
    eventName,
    eventRef: process.env.GITHUB_REF ?? '',
    recipeSha,
    recipeHead,
  };

  if (eventName === 'push') {
    const eventPath = requiredEnv('GITHUB_EVENT_PATH');
    input.changedPaths = readChangedPaths(eventPath,recipeSha);
    input.requestText = existsSync(BETA_BUILD_REQUEST_PATH)
      ? readFileSync(BETA_BUILD_REQUEST_PATH, 'utf8')
      : undefined;
  } else if (eventName === 'workflow_dispatch') {
    input.dispatchInputs = {
      source_ref: process.env.SOURCE_REF ?? '',
      expected_sha: process.env.EXPECTED_SHA ?? '',
      expected_version: process.env.EXPECTED_VERSION ?? '',
    };
  }

  const request = resolveBetaBuildRequest(input);
  writeOutputs({
    source_ref: request.sourceRef,
    sha: request.expectedSha,
    version: request.expectedVersion,
    recipe_sha: request.recipeSha,
  });
  console.log(JSON.stringify({
    validation_only: true,
    workflow_recipe_sha: request.recipeSha,
    source_sha: request.expectedSha,
    version: request.expectedVersion,
    source_ref: request.sourceRef,
    release: false,
    pages: false,
  }));
}

function verifyCandidateFromEnvironment(): void {
  const sourceSha = requiredEnv('SOURCE_SHA').toLowerCase();
  const expectedVersion = requiredEnv('EXPECTED_VERSION');
  const recipeSha = requiredEnv('WORKFLOW_RECIPE_SHA').toLowerCase();
  const candidateDir = resolve(requiredEnv('CANDIDATE_DIR'));
  const actualHead = execFileSync('git', ['-C', candidateDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const configPath = resolve(candidateDir, 'src-tauri/tauri.beta.conf.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
  const request: BetaBuildRequest = {
    sourceRef: sourceSha,
    expectedSha: sourceSha,
    expectedVersion,
    recipeSha,
  };
  validateBetaCandidateIdentity(request, actualHead, config);

  const hashFile = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
  const record = asRecord(config);
  const android = asRecord(asRecord(record?.bundle)?.android);
  const outputs = {
    identifier: String(record?.identifier),
    version_code: String(android?.versionCode),
    config_hash: hashFile(configPath),
    cargo_lock_hash: hashFile(resolve(candidateDir, 'Cargo.lock')),
  };
  writeOutputs(outputs);
  console.log(JSON.stringify({
    workflow_recipe_sha: recipeSha,
    source_sha: sourceSha,
    ...outputs,
    validation_only: true,
  }));
}

function main(): void {
  try {
    const mode = process.argv[2];
    if (mode === 'resolve-request') {
      resolveFromEnvironment();
    } else if (mode === 'verify-candidate') {
      verifyCandidateFromEnvironment();
    } else {
      throw new Error('Expected mode: resolve-request or verify-candidate.');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
