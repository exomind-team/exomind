/**
 * Bun HTTP server for Volcano ASR（火山 ASR Bun 后端）
 *
 * Responsibilities（职责）:
 * - receive browser test-page requests（接收浏览器测试页请求）
 * - forward PCM to Volcano websocket API（转发 PCM 到火山 WebSocket）
 * - keep env defaults but allow per-request overrides（环境变量兜底，同时允许请求级配置）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveBffCorsPolicy, type BffCorsPolicy } from '../config/port-env';
import { createUuidV4 } from '../lib/utils/uuid';
import {
  buildVolcanoAudioFrame,
  buildVolcanoRequestFrame,
  isVolcanoFinalResponse,
  parseVolcanoServerFrame,
} from '../lib/asr/volcano-protocol';
import type { VolcanoEndpoint, VolcanoRuntimeConfig } from '../lib/asr/volcano-config';

const envFile = Bun.file('.env');
if (await envFile.exists()) {
  const envContent = await envFile.text();
  const envVars = envContent.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
  for (const line of envVars) {
    const [key, value] = line.split('=');
    if (key && value) {
      process.env[key.trim()] = value.trim();
    }
  }
}

interface VolcanoAsrHttpRequest {
  audioBase64: string;
  config?: Partial<VolcanoRuntimeConfig>;
}

interface AsrResponse {
  text: string;
  confidence: number;
  lang: string;
  duration?: number;
}

interface VolcanoRecognitionState {
  text: string;
  duration: number;
  logId?: string;
}

function parsePort(value: string | undefined, fallback: number): number {
  const port = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fallback;
  }
  return port;
}

const ENV_DEFAULTS = {
  PORT: parsePort(
    process.env.EXOMIND_ASR_PORT || process.env.VOLCANO_PORT || process.env.VITE_VOLCANO_PORT,
    1949
  ),
  APP_KEY: process.env.VOLCANO_APP_KEY || process.env.VITE_VOLCANO_APP_KEY || '',
  ACCESS_KEY: process.env.VOLCANO_ACCESS_KEY || process.env.VITE_VOLCANO_ACCESS_KEY || '',
  RESOURCE_ID: process.env.VOLCANO_RESOURCE_ID || process.env.VITE_VOLCANO_RESOURCE_ID || 'volc.bigasr.sauc.duration',
  ASR_AUTH_TOKEN: process.env.EXOMIND_ASR_AUTH_TOKEN || '',
} as const;

const CORS_POLICY: BffCorsPolicy = resolveBffCorsPolicy(
  process.env as Record<string, string | undefined>
);

function resolveAllowOrigin(requestOrigin: string | null): string | null {
  if (CORS_POLICY.allowAllOrigins) {
    return '*';
  }
  if (!requestOrigin) {
    return null;
  }
  return CORS_POLICY.allowOrigins.includes(requestOrigin) ? requestOrigin : null;
}

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const allowOrigin = resolveAllowOrigin(requestOrigin);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };

  if (allowOrigin) {
    headers['Access-Control-Allow-Origin'] = allowOrigin;
  }
  if (CORS_POLICY.allowCredentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

function resolveEndpointUrl(endpoint: VolcanoEndpoint): string {
  return `wss://openspeech.bytedance.com/api/v3/sauc/${endpoint}`;
}

function decodeBase64Audio(audioBase64: string): Uint8Array {
  return new Uint8Array(Buffer.from(audioBase64, 'base64'));
}

function normalizeLanguage(language: string | undefined, endpoint: VolcanoEndpoint): string | undefined {
  const trimmed = language?.trim();
  if (!trimmed) return undefined;
  return endpoint === 'bigmodel_nostream' ? trimmed : undefined;
}

function resolveRequestConfig(requestConfig?: Partial<VolcanoRuntimeConfig>): VolcanoRuntimeConfig {
  const endpoint = requestConfig?.endpoint ?? 'bigmodel_async';
  const config: VolcanoRuntimeConfig = {
    appKey: ENV_DEFAULTS.APP_KEY,
    accessKey: ENV_DEFAULTS.ACCESS_KEY,
    resourceId: requestConfig?.resourceId?.trim() || ENV_DEFAULTS.RESOURCE_ID,
    language: normalizeLanguage(requestConfig?.language, endpoint),
    endpoint,
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      show_utterances: requestConfig?.request?.show_utterances ?? true,
      ...(endpoint === 'bigmodel_async' && requestConfig?.request?.enable_nonstream
        ? { enable_nonstream: true }
        : {}),
      ...(endpoint === 'bigmodel_async' && requestConfig?.request?.end_window_size
        ? { end_window_size: requestConfig.request.end_window_size }
        : {}),
      ...(endpoint === 'bigmodel_async' && requestConfig?.request?.force_to_speech_time
        ? { force_to_speech_time: requestConfig.request.force_to_speech_time }
        : {}),
    },
  };

  if (!config.appKey || !config.accessKey || !config.resourceId) {
    throw new Error('缺少火山鉴权配置，请在页面填写或在 .env 中设置默认值');
  }

  return config;
}

function chunkAudio(audioData: Uint8Array, chunkSize = 6400): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < audioData.length; offset += chunkSize) {
    chunks.push(audioData.slice(offset, Math.min(offset + chunkSize, audioData.length)));
  }
  return chunks;
}

function encodeWav(samples: Uint8Array): Uint8Array {
  const numChannels = 1;
  const sampleRate = 16000;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer).set(samples, 44);

  return new Uint8Array(buffer);
}

async function saveAudioFile(audioData: Uint8Array): Promise<string> {
  const asrDir = path.join(os.homedir(), '.exomind', 'asr');
  fs.mkdirSync(asrDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filePath = path.join(asrDir, `asr-${timestamp}.wav`);
  fs.writeFileSync(filePath, encodeWav(audioData));
  console.log(`[文件] 音频已保存: ${filePath}`);
  return filePath;
}

async function recognizeWithVolcano(
  audioData: Uint8Array,
  config: VolcanoRuntimeConfig
): Promise<VolcanoRecognitionState> {
  const connectId = createUuidV4();
  const wsUrl = resolveEndpointUrl(config.endpoint);
  const ws = new WebSocket(wsUrl, {
    headers: {
      'X-Api-App-Key': config.appKey,
      'X-Api-Access-Key': config.accessKey,
      'X-Api-Resource-Id': config.resourceId,
      'X-Api-Connect-Id': connectId,
    },
  });

  const latest: VolcanoRecognitionState = {
    text: '',
    duration: 0,
  };

  console.log('[火山引擎] 正在连接...');
  console.log('[火山引擎] Endpoint:', config.endpoint);
  console.log('[火山引擎] ResourceId:', config.resourceId);

  return await new Promise<VolcanoRecognitionState>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error('等待火山识别结果超时'));
      }
    }, 30000);

    const finish = (value: VolcanoRecognitionState) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.close();
      resolve(value);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.close();
      reject(error);
    };

    ws.onopen = async () => {
      try {
        const requestPayload = {
          user: { uid: connectId },
          audio: {
            format: 'pcm',
            codec: 'raw',
            rate: 16000,
            bits: 16,
            channel: 1,
            ...(config.endpoint === 'bigmodel_nostream' && config.language
              ? { language: config.language }
              : {}),
          },
          request: config.request,
        };

        ws.send(buildVolcanoRequestFrame(requestPayload, { useGzip: true }));

        const chunks = chunkAudio(audioData, 6400);
        for (const [index, chunk] of chunks.entries()) {
          ws.send(buildVolcanoAudioFrame(chunk, {
            isLast: index === chunks.length - 1,
            useGzip: true,
          }));
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    };

    ws.onmessage = (event) => {
      try {
        const raw = event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : new Uint8Array(Buffer.from(event.data as any));
        const frame = parseVolcanoServerFrame(raw);
        const payload = frame.payloadJson;

        if (frame.messageType === 15) {
          fail(new Error(payload?.message || '火山返回错误帧'));
          return;
        }

        if (payload?.code && payload.code !== 20000000) {
          fail(new Error(`API 错误 ${payload.code}: ${payload.message || 'unknown error'}`));
          return;
        }

        if (payload?.result?.text) {
          latest.text = payload.result.text;
        }
        if (typeof payload?.audio_info?.duration === 'number') {
          latest.duration = payload.audio_info.duration;
        }
        if (payload?.result?.additions?.log_id) {
          latest.logId = payload.result.additions.log_id;
        }

        console.log(
          `[火山引擎] frame type=${frame.messageType} flags=${frame.flags} seq=${frame.sequence ?? 'n/a'} text="${latest.text}"`
        );

        if (isVolcanoFinalResponse(frame, config.endpoint)) {
          finish(latest);
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    };

    ws.onerror = (error) => {
      fail(new Error(`WebSocket 连接失败: ${String(error)}`));
    };

    ws.onclose = (event) => {
      console.log(`[火山引擎] 连接已关闭: ${event.code}`);
      if (!settled && latest.text) {
        finish(latest);
      }
    };
  });
}

function tryParseJsonRequest(request: Request): Promise<VolcanoAsrHttpRequest | null> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return Promise.resolve(null);
  }
  return request.json() as Promise<VolcanoAsrHttpRequest>;
}

console.log('='.repeat(50));
console.log('  火山引擎 ASR 后端服务');
console.log('='.repeat(50));
console.log(`  端口: ${ENV_DEFAULTS.PORT}`);
console.log(`  默认 Resource: ${ENV_DEFAULTS.RESOURCE_ID}`);
console.log(`  默认鉴权: ${ENV_DEFAULTS.APP_KEY && ENV_DEFAULTS.ACCESS_KEY ? '已配置' : '未配置，等待请求级配置'}`);
console.log(`  CORS: ${CORS_POLICY.allowAllOrigins ? '*' : CORS_POLICY.allowOrigins.join(', ') || '(deny by default)'}`);
console.log('='.repeat(50));

const server = Bun.serve({
  port: ENV_DEFAULTS.PORT,

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const requestOrigin = req.headers.get('origin');
    const corsHeaders = buildCorsHeaders(requestOrigin);

    if (req.method === 'OPTIONS') {
      if (!corsHeaders['Access-Control-Allow-Origin'] && requestOrigin) {
        return new Response('CORS origin denied', { status: 403, headers: corsHeaders });
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'volcano-asr-backend',
          timestamp: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (url.pathname === '/api/asr' && req.method === 'POST') {
      if (ENV_DEFAULTS.ASR_AUTH_TOKEN) {
        const authHeader = req.headers.get('authorization');
        if (!authHeader || authHeader !== `Bearer ${ENV_DEFAULTS.ASR_AUTH_TOKEN}`) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      console.log('\n[请求] 收到 ASR 识别请求');

      try {
        const parsedJson = await tryParseJsonRequest(req.clone());
        const audioData = parsedJson
          ? decodeBase64Audio(parsedJson.audioBase64)
          : new Uint8Array(await req.arrayBuffer());
        const config = resolveRequestConfig(parsedJson?.config);

        console.log(`[音频] 大小: ${audioData.length} bytes`);
        console.log(`[配置] endpoint=${config.endpoint} resource=${config.resourceId}`);

        await saveAudioFile(audioData);
        const recognized = await recognizeWithVolcano(audioData, config);

        const result: AsrResponse = {
          text: recognized.text,
          confidence: 1.0,
          lang: config.language || 'zh-CN',
          duration: recognized.duration,
        };

        console.log(`[结果] "${result.text}"`);
        if (recognized.logId) {
          console.log(`[LogId] ${recognized.logId}`);
        }
        console.log('[完成] 识别成功\n');

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('[错误]', error);
        return new Response(
          JSON.stringify({ error: error instanceof Error ? error.message : '识别失败' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
});

console.log(`\n✅ 服务已启动: http://localhost:${ENV_DEFAULTS.PORT}`);
console.log(`   健康检查: http://localhost:${ENV_DEFAULTS.PORT}/health`);
console.log(`   ASR 接口: POST http://localhost:${ENV_DEFAULTS.PORT}/api/asr`);
console.log('\n按 Ctrl+C 停止服务\n');
void server;
