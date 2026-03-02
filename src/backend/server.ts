/**
 * Bun HTTP Server - 火山引擎 ASR 后端服务
 *
 * ┌─────────────────────────────────────────┐
 * │  L1 Adapter - 后端实现                   │
 * │  ─────────────────────────────────     │
 * │  运行命令: bun run src/backend/server.ts │
 * │  端口: 1949                             │
 * └─────────────────────────────────────────┘
 *
 * 作用：解决浏览器无法设置 WebSocket 认证头部的问题
 *      接收前端音频 → 转发到火山引擎 → 返回识别结果
 *
 * 注意：此文件独立运行，不参与前端构建
 */

import { resolveBffCorsPolicy, type BffCorsPolicy } from '../config/port-env';
import { createUuidV4 } from '../lib/utils/uuid';

// 加载 .env 文件
const envFile = Bun.file('.env');
if (await envFile.exists()) {
  const envContent = await envFile.text();
  const envVars = envContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  for (const line of envVars) {
    const [key, value] = line.split('=');
    if (key && value) {
      process.env[key.trim()] = value.trim();
    }
  }
}

// 使用 Bun 原生 HTTP 服务器
// 这个文件需要单独运行：bun run src/backend/server.ts

// 类型定义（仅用于此文件）
interface ASRResponse {
  code?: number;
  message?: string;
  result?: {
    text: string;
  };
  audio_info?: { duration: number };
}

function parsePort(value: string | undefined, fallback: number): number {
  const port = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fallback;
  }
  return port;
}

// 配置 - 从环境变量读取（支持 VITE_ 和 VOLCANO_ 前缀）
const CONFIG = {
  PORT: parsePort(
    process.env.EXOMIND_ASR_PORT || process.env.VOLCANO_PORT || process.env.VITE_VOLCANO_PORT,
    1949
  ),
  APP_KEY: process.env.VOLCANO_APP_KEY || process.env.VITE_VOLCANO_APP_KEY || '',
  ACCESS_KEY: process.env.VOLCANO_ACCESS_KEY || process.env.VITE_VOLCANO_ACCESS_KEY || '',
  RESOURCE_ID: process.env.VOLCANO_RESOURCE_ID || process.env.VITE_VOLCANO_RESOURCE_ID || 'volc.bigasr.sauc.duration',
};

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
    'Vary': 'Origin',
  };

  if (allowOrigin) {
    headers['Access-Control-Allow-Origin'] = allowOrigin;
  }

  if (CORS_POLICY.allowCredentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

// 打印启动信息
console.log('='.repeat(50));
console.log('  火山引擎 ASR 后端服务');
console.log('='.repeat(50));
console.log(`  端口: ${CONFIG.PORT}`);
console.log(`  APP Key: ${CONFIG.APP_KEY.slice(0, 8)}***`);
console.log(`  Resource: ${CONFIG.RESOURCE_ID}`);
console.log(`  CORS: ${CORS_POLICY.allowAllOrigins ? '*' : CORS_POLICY.allowOrigins.join(', ') || '(deny by default)'}`);
console.log('='.repeat(50));

if (!CONFIG.APP_KEY || !CONFIG.ACCESS_KEY) {
  console.error('错误: 请设置 VOLCANO_APP_KEY 和 VOLCANO_ACCESS_KEY 环境变量');
  process.exit(1);
}

// ========== 工具函数 ==========

/**
 * 生成 HMAC-SHA256 签名
 */
async function generateSignature(
  accessKey: string,
  timestamp: string,
  appKey: string,
  resourceId: string
): Promise<string> {
  const signContent = timestamp + appKey + resourceId;
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(accessKey);
  const contentBytes = encoder.encode(signContent);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, contentBytes);

  // Base64 编码
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = new Uint8Array(signature);
  let result = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triplet = (b1 << 16) | (b2 << 8) | b3;
    result += chars[(triplet >> 18) & 0x3F];
    result += chars[(triplet >> 12) & 0x3F];
    result += i + 1 < bytes.length ? chars[(triplet >> 6) & 0x3F] : '=';
    result += i + 2 < bytes.length ? chars[triplet & 0x3F] : '=';
  }

  return result;
}

/**
 * 构建 WebSocket 消息头
 */
function buildHeader(messageType: number, flags: number, serialization: number, compression: number): Uint8Array {
  return new Uint8Array([
    0x11, // version=1, headerSize=1
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0x00, // reserved
  ]);
}

function buildRequest(data: object): Uint8Array {
  const jsonStr = JSON.stringify(data);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const payloadSize = new Uint8Array(4);
  new DataView(payloadSize.buffer).setUint32(0, jsonBytes.length, false);
  const header = buildHeader(1, 0, 1, 0); // full client request
  return new Uint8Array([...header, ...payloadSize, ...jsonBytes]);
}

function buildAudioMessage(audioData: Uint8Array, isLast: boolean = false): Uint8Array {
  const header = buildHeader(2, isLast ? 0x12 : 0x20, 0, 0); // audio only
  const sizeBytes = new Uint8Array(4);
  new DataView(sizeBytes.buffer).setUint32(0, audioData.length, false);
  return new Uint8Array([...header, ...sizeBytes, ...audioData]);
}

function parseResponse(data: Uint8Array): ASRResponse {
  // 尝试直接解析整个数据为 JSON（可能响应不是二进制格式）
  try {
    const jsonStr = new TextDecoder().decode(data);
    console.log('[火山引擎] 尝试 JSON 解析:', jsonStr.slice(0, 200));
    return JSON.parse(jsonStr);
  } catch {
    // 如果直接解析失败，尝试二进制格式
    console.log('[火山引擎] JSON 解析失败，尝试二进制格式');
  }

  // 二进制格式解析
  const view = new DataView(data.buffer);
  const version = (view.getUint8(0) >> 4) & 0x0F;
  const headerSizeValue = view.getUint8(0) & 0x0F;
  const headerBytes = (headerSizeValue + 1) * 4;

  console.log(`[火山引擎] Version: ${version}, Header size value: ${headerSizeValue}, Header bytes: ${headerBytes}`);

  // 尝试不同的解析方式
  // 方式 1: 跳过 8 字节
  try {
    const jsonBytes = data.subarray(8);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    console.log('[火山引擎] 方式1 (skip 8 bytes):', jsonStr.slice(0, 200));
    return JSON.parse(jsonStr);
  } catch (e1) {
    console.log('[火山引擎] 方式1 失败');
  }

  // 方式 2: 跳过 headerBytes + 8
  try {
    const jsonBytes = data.subarray(headerBytes + 8);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    console.log('[火山引擎] 方式2:', jsonStr.slice(0, 200));
    return JSON.parse(jsonStr);
  } catch (e2) {
    console.log('[火山引擎] 方式2 失败');
  }

  // 方式 3: 跳过 12 字节
  try {
    const jsonBytes = data.subarray(12);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    console.log('[火山引擎] 方式3 (skip 12 bytes):', jsonStr.slice(0, 200));
    return JSON.parse(jsonStr);
  } catch (e3) {
    console.log('[火山引擎] 方式3 失败');
  }

  throw new Error('无法解析响应格式');
}

/**
 * 解析 WebSocket 消息（支持字符串和二进制格式）
 */
function parseWebSocketMessage(data: string | Uint8Array | ArrayBuffer | Blob): ASRResponse {
  console.log(`[火山引擎] 收到消息类型: ${typeof data}, 大小: ${data instanceof Uint8Array ? data.length : 'N/A'}`);

  if (typeof data === 'string') {
    return JSON.parse(data);
  } else if (data instanceof Blob) {
    return parseWebSocketMessage(data.arrayBuffer());
  } else if (data instanceof ArrayBuffer) {
    return parseWebSocketMessage(new Uint8Array(data));
  } else {
    return parseResponse(data);
  }
}

/**
 * 保存音频文件到本地
 */
async function saveAudioFile(audioData: Uint8Array): Promise<string> {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');

  // 创建目录: ~/.exomind/asr/
  const asrDir = path.join(os.homedir(), '.exomind', 'asr');
  fs.mkdirSync(asrDir, { recursive: true });

  // 生成文件名: asr-YYYYMMDD-HHmmss-xxx.wav
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `asr-${timestamp}.wav`;
  const filePath = path.join(asrDir, filename);

  // 写入 WAV 文件（添加 WAV 头）
  const wavBytes = encodeWAV(audioData);
  fs.writeFileSync(filePath, wavBytes);

  console.log(`[文件] 音频已保存: ${filePath}`);
  return filePath;
}

/**
 * 编码为 WAV 格式
 */
function encodeWAV(samples: Uint8Array): Uint8Array {
  const numChannels = 1;
  const sampleRate = 16000;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV 头
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // 音频数据
  new Uint8Array(buffer).set(samples, 44);

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * 连接火山引擎并识别音频
 */
async function recognizeWithVolcano(audioData: Uint8Array): Promise<ASRResponse> {
  const wsUrl = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
  const connectId = createUuidV4();

  // 构建认证 HTTP 请求头（根据火山引擎文档）
  const headers = {
    'X-Api-App-Key': CONFIG.APP_KEY,
    'X-Api-Access-Key': CONFIG.ACCESS_KEY,
    'X-Api-Resource-Id': CONFIG.RESOURCE_ID,
    'X-Api-Connect-Id': connectId,
  };

  console.log('[火山引擎] 正在连接...');
  console.log('[火山引擎] AppKey:', CONFIG.APP_KEY.slice(0, 8) + '***');
  console.log('[火山引擎] ResourceId:', CONFIG.RESOURCE_ID);

  // 连接 WebSocket（认证信息在 HTTP 请求头中）
  const ws = new WebSocket(wsUrl, { headers });

  const result = await new Promise<ASRResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('连接超时'));
    }, 10000);

    ws.onopen = () => {
      console.log('[火山引擎] WebSocket 连接成功');
      clearTimeout(timeout);

      // 发送 full client request
      const request = buildRequest({
        user: { uid: connectId },
        audio: { format: 'pcm', rate: 16000, bits: 16, channel: 1 },
        request: {
          model_name: 'bigmodel',
          enable_itn: true,
          enable_punc: true,
          show_utterances: true,
        },
      });
      ws.send(request);
      console.log('[火山引擎] 配置请求已发送');

      // 发送音频
      const audioMessage = buildAudioMessage(audioData, true);
      ws.send(audioMessage);
      console.log('[火山引擎] 音频已发送');
    };

    ws.onmessage = (event) => {
      const response = parseWebSocketMessage(event.data);
      console.log(`[火山引擎] 响应 code: ${response.code}`);

      if (response.code && response.code !== 20000000) {
        ws.close();
        reject(new Error(`API 错误: ${response.code} ${response.message}`));
        return;
      }

      if (response.audio_info) {
        ws.close();
        resolve(response);
      }
    };

    ws.onerror = (error) => {
      console.error('[火山引擎] WebSocket 错误:', error);
      clearTimeout(timeout);
      reject(new Error('WebSocket 连接失败'));
    };

    ws.onclose = (event) => {
      console.log(`[火山引擎] 连接已关闭: ${event.code}`);
    };
  });

  return result;
}

// ========== HTTP 服务器 ==========

// 使用 Bun.serve 启动 HTTP 服务器
// @ts-ignore - Bun 类型在运行时可用
const server = Bun.serve({
  port: CONFIG.PORT,

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const requestOrigin = req.headers.get('origin');

    // CORS 头
    const corsHeaders = buildCorsHeaders(requestOrigin);

    // 处理 OPTIONS 预检请求
    if (req.method === 'OPTIONS') {
      if (!corsHeaders['Access-Control-Allow-Origin'] && requestOrigin) {
        return new Response('CORS origin denied', { status: 403, headers: corsHeaders });
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 根路径 - 健康检查
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'volcano-asr-backend',
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // ASR 识别接口
    if (url.pathname === '/api/asr' && req.method === 'POST') {
      console.log('\n[请求] 收到 ASR 识别请求');

      try {
        const body = await req.arrayBuffer();
        const audioData = new Uint8Array(body);

        console.log(`[音频] 大小: ${audioData.length} bytes`);

        // 保存音频文件
        await saveAudioFile(audioData);

        // 调用火山引擎
        const result = await recognizeWithVolcano(audioData);

        // 返回结果
        const asrResult = {
          text: result.result?.text || '',
          confidence: 1.0,
          lang: 'zh-CN',
          duration: result.audio_info?.duration || 0,
        };

        console.log(`[结果] "${asrResult.text}"`);
        console.log(`[完成] 识别成功\n`);

        return new Response(JSON.stringify(asrResult), {
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

    // 404
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
});

console.log(`\n✅ 服务已启动: http://localhost:${CONFIG.PORT}`);
console.log(`   健康检查: http://localhost:${CONFIG.PORT}/health`);
console.log(`   ASR 接口: POST http://localhost:${CONFIG.PORT}/api/asr`);
console.log(`\n按 Ctrl+C 停止服务\n`);
