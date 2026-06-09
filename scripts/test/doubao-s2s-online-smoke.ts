import path from 'node:path';
import { access } from 'node:fs/promises';

import {
  resolveDoubaoRealtimeSmokeConfig,
} from './doubao-s2s-online-smoke-lib';

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(import.meta.dir, '..', '..');
  const config = resolveDoubaoRealtimeSmokeConfig(process.env, projectRoot);

  await access(config.fixturePath);

  const fixtureRelativePath = path.relative(projectRoot, config.fixturePath).replace(/\\/g, '/');
  console.log('[doubao-s2s-online-smoke] 准备启动真实在线 smoke...');
  console.log(`[doubao-s2s-online-smoke] APP ID: ${config.appId}`);
  console.log(`[doubao-s2s-online-smoke] Access Token: ${maskSecret(config.accessToken)}`);
  console.log(`[doubao-s2s-online-smoke] Secret Key: ${maskSecret(config.secretKey)}`);
  console.log(`[doubao-s2s-online-smoke] Model: ${config.modelVersion}`);
  console.log(`[doubao-s2s-online-smoke] Speaker: ${config.speaker}`);
  console.log(`[doubao-s2s-online-smoke] Fixture: ${fixtureRelativePath}`);

  const child = Bun.spawn({
    cmd: [
      'cargo',
      'test',
      'doubao_realtime_online_smoke_with_real_api',
      '--manifest-path',
      path.join(projectRoot, 'src-tauri', 'Cargo.toml'),
      '--',
      '--ignored',
      '--nocapture',
    ],
    cwd: projectRoot,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      EXOMIND_VOICE_RUNTIME_APP_ID: config.appId,
      EXOMIND_VOICE_RUNTIME_ACCESS_TOKEN: config.accessToken,
      EXOMIND_VOICE_RUNTIME_SECRET_KEY: config.secretKey,
      EXOMIND_VOICE_RUNTIME_MODEL_VERSION: config.modelVersion,
      EXOMIND_VOICE_RUNTIME_SPEAKER: config.speaker,
      EXOMIND_VOICE_RUNTIME_WEBSOCKET_URL: config.websocketUrl,
      EXOMIND_VOICE_RUNTIME_CONNECT_ID: config.connectId,
      EXOMIND_VOICE_RUNTIME_LANGUAGE: config.language,
      EXOMIND_VOICE_RUNTIME_SAMPLE_RATE: String(config.sampleRate),
      EXOMIND_VOICE_RUNTIME_TTS_SAMPLE_RATE: String(config.ttsSampleRate),
      EXOMIND_VOICE_RUNTIME_SMOKE_FIXTURE: fixtureRelativePath,
    },
  });

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`doubao realtime online smoke failed（豆包实时在线 smoke 失败）, exitCode=${exitCode}`);
  }

  console.log('[doubao-s2s-online-smoke] PASS');
}

void main().catch((error) => {
  console.error('[doubao-s2s-online-smoke] FAIL', error);
  process.exitCode = 1;
});
