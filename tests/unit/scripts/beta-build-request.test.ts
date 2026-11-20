// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BetaBuildRequestError,
  resolveBetaBuildRequest,
  validateBetaCandidateIdentity,
  type BetaBuildRequestInput,
} from '../../../scripts/dev/beta-build-request';

const CANDIDATE_SHA = '85f7df92d0eccf1de624ab9220d4d8944797f28b';
const RECIPE_SHA = 'a'.repeat(40);
const REQUEST_PATH = '.github/beta-build-candidate.json';

const candidateRequest = {
  source_ref: CANDIDATE_SHA,
  expected_sha: CANDIDATE_SHA,
  expected_version: '0.6.0-beta16',
};

function pushInput(overrides: Partial<BetaBuildRequestInput> = {}): BetaBuildRequestInput {
  return {
    eventName: 'push',
    eventRef: 'refs/heads/dev-0.6',
    recipeSha: RECIPE_SHA,
    recipeHead: RECIPE_SHA,
    changedPaths: [REQUEST_PATH],
    requestText: JSON.stringify(candidateRequest),
    ...overrides,
  };
}

function dispatchInput(overrides: Partial<BetaBuildRequestInput> = {}): BetaBuildRequestInput {
  return {
    eventName: 'workflow_dispatch',
    eventRef: 'refs/heads/dev-0.6',
    recipeSha: RECIPE_SHA,
    recipeHead: RECIPE_SHA,
    dispatchInputs: candidateRequest,
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: BetaBuildRequestError['code']): void {
  try {
    action();
    throw new Error(`Expected BetaBuildRequestError(${code})`);
  } catch (error) {
    expect(error).toBeInstanceOf(BetaBuildRequestError);
    expect((error as BetaBuildRequestError).code).toBe(code);
  }
}

function beta16Config() {
  return {
    identifier: 'com.exomind.app.v06.beta',
    productName: 'ExoMind Beta',
    version: '0.6.0-beta16',
    build: { beforeBuildCommand: 'bun run build:web' },
    app: {
      windows: [{ label: 'main', url: 'beta.html' }],
      security: { capabilities: ['beta', 'beta-overlay'] },
    },
    bundle: { android: { versionCode: 6016 } },
  };
}

describe('Beta build request validation', () => {
  it('resolves a real multi-commit push when Actions omits commit file arrays',()=>{
    const root=mkdtempSync(join(tmpdir(),'exomind-build-request-'));
    const git=(args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
    try {
      git(['init','-q']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);
      git(['config','commit.gpgsign','false']);git(['config','core.autocrlf','false']);git(['config','core.hooksPath',join(root,'no-hooks')]);
      writeFileSync(join(root,'baseline.txt'),'baseline');git(['add','.']);git(['commit','-qm','baseline']);const before=git(['rev-parse','HEAD']);
      mkdirSync(join(root,'.github'));writeFileSync(join(root,REQUEST_PATH),JSON.stringify(candidateRequest));git(['add','.']);git(['commit','-qm','request candidate']);
      writeFileSync(join(root,'notes.txt'),'later independent commit');git(['add','.']);git(['commit','-qm','notes']);const after=git(['rev-parse','HEAD']);
      const event=join(root,'event.json'),output=join(root,'output.txt');writeFileSync(event,JSON.stringify({before,after,deleted:false,commits:[{id:after,message:'notes'}]}));
      const result=spawnSync('bun',[resolve('scripts/dev/beta-build-request.ts'),'resolve-request'],{cwd:root,windowsHide:true,encoding:'utf8',timeout:15000,
        env:{...process.env,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/dev-0.6',GITHUB_SHA:after,GITHUB_EVENT_PATH:event,GITHUB_OUTPUT:output}});
      expect(result.stderr).toBe('');expect(result.status).toBe(0);
      expect(readFileSync(output,'utf8')).toContain(`recipe_sha=${after}`);
      expect(readFileSync(output,'utf8')).toContain(`sha=${CANDIDATE_SHA}`);
    } finally { rmSync(root,{recursive:true,force:true}); }
  });
  it('accepts only an explicit request-file push on dev-0.6 and preserves both SHAs', () => {
    expect(resolveBetaBuildRequest(pushInput())).toEqual({
      sourceRef: CANDIDATE_SHA,
      expectedSha: CANDIDATE_SHA,
      expectedVersion: '0.6.0-beta16',
      recipeSha: RECIPE_SHA,
    });
  });

  it('rejects unknown request keys with a schema-specific error', () => {
    expectCode(() => resolveBetaBuildRequest(pushInput({
      requestText: JSON.stringify({ ...candidateRequest, branch: 'dev-0.6' }),
    })), 'request_schema');
  });

  it('rejects malformed source and expected SHAs separately from a ref mismatch', () => {
    expectCode(() => resolveBetaBuildRequest(pushInput({
      requestText: JSON.stringify({ ...candidateRequest, expected_sha: 'not-a-sha' }),
    })), 'invalid_sha');
    expectCode(() => resolveBetaBuildRequest(pushInput({
      requestText: JSON.stringify({ ...candidateRequest, source_ref: 'dev-0.6' }),
    })), 'invalid_sha');
    expectCode(() => resolveBetaBuildRequest(pushInput({
      requestText: JSON.stringify({ ...candidateRequest, source_ref: 'b'.repeat(40) }),
    })), 'source_sha_mismatch');
  });

  it('rejects a noncanonical Beta version', () => {
    expectCode(() => resolveBetaBuildRequest(pushInput({
      requestText: JSON.stringify({ ...candidateRequest, expected_version: '0.6.0-beta016' }),
    })), 'invalid_version');
  });

  it('fails closed when the push branch or changed path does not identify the request', () => {
    expectCode(() => resolveBetaBuildRequest(pushInput({ eventRef: 'refs/heads/main' })), 'invalid_push_ref');
    expectCode(() => resolveBetaBuildRequest(pushInput({ changedPaths: ['README.md'] })), 'request_file_unchanged');
  });

  it('requires the checked-out workflow recipe to match the event recipe SHA', () => {
    expectCode(() => resolveBetaBuildRequest(pushInput({ recipeHead: 'c'.repeat(40) })), 'recipe_head_mismatch');
  });

  it('accepts workflow_dispatch only with the same explicit immutable request fields', () => {
    expect(resolveBetaBuildRequest(dispatchInput()).expectedSha).toBe(CANDIDATE_SHA);
    expectCode(() => resolveBetaBuildRequest(dispatchInput({
      dispatchInputs: { ...candidateRequest, source_ref: 'dev-0.6' },
    })), 'invalid_sha');
    expectCode(() => resolveBetaBuildRequest(dispatchInput({
      dispatchInputs: { ...candidateRequest, expected_sha: 'bad' },
    })), 'invalid_sha');
  });

  it('checks the payload checkout SHA and Beta16 identity, including Android versionCode 6016', () => {
    const request = resolveBetaBuildRequest(pushInput());
    expect(validateBetaCandidateIdentity(request, CANDIDATE_SHA, beta16Config())).toBeUndefined();
    expectCode(() => validateBetaCandidateIdentity(request, RECIPE_SHA, beta16Config()), 'candidate_head_mismatch');
    expectCode(() => validateBetaCandidateIdentity(request, CANDIDATE_SHA, {
      ...beta16Config(), bundle: { android: { versionCode: 6017 } },
    }), 'version_code_mismatch');
    expectCode(() => validateBetaCandidateIdentity(request, CANDIDATE_SHA, {
      ...beta16Config(), identifier: 'com.exomind.app',
    }), 'beta_identity_mismatch');
  });
  it('accepts Beta17 only with Android versionCode 6017 and rejects reuse of 6016', () => {
    const request = resolveBetaBuildRequest(dispatchInput({
      dispatchInputs: { ...candidateRequest, expected_version: '0.6.0-beta17' },
    }));
    const config = { ...beta16Config(), version: '0.6.0-beta17', bundle: { android: { versionCode: 6017 } } };
    expect(validateBetaCandidateIdentity(request, CANDIDATE_SHA, config)).toBeUndefined();
    expectCode(() => validateBetaCandidateIdentity(request, CANDIDATE_SHA, {
      ...config, bundle: { android: { versionCode: 6016 } },
    }), 'version_code_mismatch');
  });

  it('accepts Beta18 only with Android versionCode 6018 and rejects other codes', () => {
    const request = resolveBetaBuildRequest(dispatchInput({
      dispatchInputs: { ...candidateRequest, expected_version: '0.6.0-beta18' },
    }));
    const config = { ...beta16Config(), version: '0.6.0-beta18', bundle: { android: { versionCode: 6018 } } };
    expect(validateBetaCandidateIdentity(request, CANDIDATE_SHA, config)).toBeUndefined();
    for (const versionCode of [6016, 6017, 6019]) {
      expectCode(() => validateBetaCandidateIdentity(request, CANDIDATE_SHA, {
        ...config, bundle: { android: { versionCode } },
      }), 'version_code_mismatch');
    }
    expectCode(() => validateBetaCandidateIdentity(request, CANDIDATE_SHA, {
      ...config, version: '0.6.0-beta17',
    }), 'beta_identity_mismatch');
  });

  it('accepts Beta19 only with Android versionCode 6019 and rejects other codes', () => {
    const request = resolveBetaBuildRequest(dispatchInput({
      dispatchInputs: { ...candidateRequest, expected_version: '0.6.0-beta19' },
    }));
    const config = { ...beta16Config(), version: '0.6.0-beta19', bundle: { android: { versionCode: 6019 } } };
    expect(validateBetaCandidateIdentity(request, CANDIDATE_SHA, config)).toBeUndefined();
    for (const versionCode of [6017, 6018, 6020]) {
      expectCode(() => validateBetaCandidateIdentity(request, CANDIDATE_SHA, {
        ...config, bundle: { android: { versionCode } },
      }), 'version_code_mismatch');
    }
  });

  it('accepts Beta20 only with Android versionCode 6020 and rejects adjacent codes', () => {
    const request = resolveBetaBuildRequest(dispatchInput({
      dispatchInputs: { ...candidateRequest, expected_version: '0.6.0-beta20' },
    }));
    const config = { ...beta16Config(), version: '0.6.0-beta20', bundle: { android: { versionCode: 6020 } } };
    expect(validateBetaCandidateIdentity(request, CANDIDATE_SHA, config)).toBeUndefined();
    for (const versionCode of [6018, 6019, 6021]) {
      expectCode(() => validateBetaCandidateIdentity(request, CANDIDATE_SHA, {
        ...config, bundle: { android: { versionCode } },
      }), 'version_code_mismatch');
    }
  });

  it('accepts Beta21 only with Android versionCode 6021 and rejects adjacent codes', () => {
    const request = resolveBetaBuildRequest(dispatchInput({
      dispatchInputs: { ...candidateRequest, expected_version: '0.6.0-beta21' },
    }));
    const config = { ...beta16Config(), version: '0.6.0-beta21', bundle: { android: { versionCode: 6021 } } };
    expect(validateBetaCandidateIdentity(request, CANDIDATE_SHA, config)).toBeUndefined();
    for (const versionCode of [6019, 6020, 6022]) {
      expectCode(() => validateBetaCandidateIdentity(request, CANDIDATE_SHA, {
        ...config, bundle: { android: { versionCode } },
      }), 'version_code_mismatch');
    }
  });

  it('validates the exact Beta21 config file through the immutable request identity', () => {
    const request = resolveBetaBuildRequest(dispatchInput({
      dispatchInputs: { ...candidateRequest, expected_version: '0.6.0-beta21' },
    }));
    const config = JSON.parse(readFileSync(resolve('src-tauri/tauri.beta.conf.json'), 'utf8')) as unknown;
    expect(validateBetaCandidateIdentity(request, CANDIDATE_SHA, config)).toBeUndefined();
  });
});
