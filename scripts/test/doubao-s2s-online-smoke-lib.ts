import path from 'node:path';

export const DEFAULT_DOUBAO_REALTIME_SMOKE_AUDIO_FIXTURE =
  'public/dev-assets/voice-runtime/codex-smoke-short.pcm';

export interface DoubaoRealtimeSmokeConfig {
  appId: string;
  accessToken: string;
  secretKey: string;
  modelVersion: string;
  speaker: string;
  websocketUrl: string;
  connectId: string;
  language: string;
  sampleRate: number;
  ttsSampleRate: number;
  fixturePath: string;
}

function pickEnv(
  env: Record<string, string | undefined>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function resolveNumber(
  env: Record<string, string | undefined>,
  keys: string[],
  fallback: number,
): number {
  const rawValue = pickEnv(env, keys);
  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

export function resolveDoubaoRealtimeSmokeConfig(
  env: Record<string, string | undefined>,
  projectRoot: string,
): DoubaoRealtimeSmokeConfig {
  const appId = pickEnv(env, [
    'EXOMIND_VOICE_RUNTIME_APP_ID',
    'DOUBAO_REALTIME_APP_ID',
  ]);
  const accessToken = pickEnv(env, [
    'EXOMIND_VOICE_RUNTIME_ACCESS_TOKEN',
    'DOUBAO_REALTIME_ACCESS_TOKEN',
  ]);
  const secretKey = pickEnv(env, [
    'EXOMIND_VOICE_RUNTIME_SECRET_KEY',
    'DOUBAO_REALTIME_SECRET_KEY',
  ]);

  if (!appId || !accessToken || !secretKey) {
    throw new Error(
      [
        '缺少豆包 S2S 在线 smoke 凭据。',
        '请设置以下环境变量之一：',
        '- APP ID: EXOMIND_VOICE_RUNTIME_APP_ID 或 DOUBAO_REALTIME_APP_ID',
        '- Access Token: EXOMIND_VOICE_RUNTIME_ACCESS_TOKEN 或 DOUBAO_REALTIME_ACCESS_TOKEN',
        '- Secret Key: EXOMIND_VOICE_RUNTIME_SECRET_KEY 或 DOUBAO_REALTIME_SECRET_KEY',
      ].join('\n'),
    );
  }

  const fixtureRelativePath = pickEnv(env, [
    'EXOMIND_VOICE_RUNTIME_SMOKE_FIXTURE',
    'DOUBAO_REALTIME_SMOKE_FIXTURE',
  ]) || DEFAULT_DOUBAO_REALTIME_SMOKE_AUDIO_FIXTURE;

  return {
    appId,
    accessToken,
    secretKey,
    modelVersion: pickEnv(env, [
      'EXOMIND_VOICE_RUNTIME_MODEL_VERSION',
      'DOUBAO_REALTIME_MODEL_VERSION',
    ]) || '1.2.1.1',
    speaker: pickEnv(env, [
      'EXOMIND_VOICE_RUNTIME_SPEAKER',
      'DOUBAO_REALTIME_SPEAKER',
    ]) || 'zh_female_vv_jupiter_bigtts',
    websocketUrl: pickEnv(env, [
      'EXOMIND_VOICE_RUNTIME_WEBSOCKET_URL',
      'DOUBAO_REALTIME_WEBSOCKET_URL',
    ]) || 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
    connectId: pickEnv(env, [
      'EXOMIND_VOICE_RUNTIME_CONNECT_ID',
      'DOUBAO_REALTIME_CONNECT_ID',
    ]) || 'exomind-doubao-s2s-smoke',
    language: pickEnv(env, [
      'EXOMIND_VOICE_RUNTIME_LANGUAGE',
      'DOUBAO_REALTIME_LANGUAGE',
    ]) || 'en-US',
    sampleRate: resolveNumber(env, [
      'EXOMIND_VOICE_RUNTIME_SAMPLE_RATE',
      'DOUBAO_REALTIME_SAMPLE_RATE',
    ], 16000),
    ttsSampleRate: resolveNumber(env, [
      'EXOMIND_VOICE_RUNTIME_TTS_SAMPLE_RATE',
      'DOUBAO_REALTIME_TTS_SAMPLE_RATE',
    ], 24000),
    fixturePath: path.join(projectRoot, fixtureRelativePath),
  };
}
