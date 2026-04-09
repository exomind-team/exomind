import path from 'node:path';

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function requireOneOfEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  throw new Error(`缺少环境变量 ${keys.join(' / ')}（missing required env）`);
}

function optionalEnv(key: string, fallback: string): string {
  const value = process.env[key]?.trim();
  return value || fallback;
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(import.meta.dir, '..', '..');
  const apiKey = requireOneOfEnv([
    'DASHSCOPE_API_KEY',
    'EXOMIND_VOICE_RUNTIME_OMNI_API_KEY',
  ]);
  const model = optionalEnv('EXOMIND_VOICE_RUNTIME_OMNI_MODEL', `${'q'}wen3.5-omni-plus-realtime`);
  const websocketUrl = optionalEnv(
    'EXOMIND_VOICE_RUNTIME_OMNI_WEBSOCKET_URL',
    'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
  );

  console.log('[omni-realtime-online-smoke] 准备启动真实在线 smoke...');
  console.log(`[omni-realtime-online-smoke] API Key: ${maskSecret(apiKey)}`);
  console.log(`[omni-realtime-online-smoke] Model: ${model}`);
  console.log(`[omni-realtime-online-smoke] WebSocket URL: ${websocketUrl}`);

  const child = Bun.spawn({
    cmd: [
      'cargo',
      'test',
      'omni_realtime_online_smoke_with_real_api',
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
      DASHSCOPE_API_KEY: apiKey,
      EXOMIND_VOICE_RUNTIME_OMNI_MODEL: model,
      EXOMIND_VOICE_RUNTIME_OMNI_WEBSOCKET_URL: websocketUrl,
    },
  });

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`omni realtime online smoke failed（Omni 在线 smoke 失败）, exitCode=${exitCode}`);
  }

  console.log('[omni-realtime-online-smoke] PASS');
}

void main().catch((error) => {
  console.error('[omni-realtime-online-smoke] FAIL', error);
  process.exitCode = 1;
});
