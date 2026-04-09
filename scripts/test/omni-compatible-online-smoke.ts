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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function decodeAudioDelta(delta: unknown): Uint8Array | null {
  if (!delta || typeof delta !== 'object') {
    return null;
  }

  const payload = delta as Record<string, unknown>;
  const candidates: unknown[] = [
    payload.audio,
    payload.audio_data,
    (payload.audio as Record<string, unknown> | undefined)?.data,
    (payload.audio as Record<string, unknown> | undefined)?.chunk,
  ];

  for (const item of candidates) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    try {
      return new Uint8Array(Buffer.from(trimmed, 'base64'));
    } catch {
      // ignore invalid base64 chunk（忽略非法片段）
    }
  }

  return null;
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(import.meta.dir, '..', '..');
  const apiKey = requireOneOfEnv([
    'DASHSCOPE_API_KEY',
    'EXOMIND_VOICE_RUNTIME_OMNI_API_KEY',
  ]);

  const baseUrl = normalizeBaseUrl(optionalEnv(
    'EXOMIND_OMNI_COMPAT_BASE_URL',
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ));
  const model = optionalEnv('EXOMIND_OMNI_COMPAT_MODEL', `${'q'}wen3.5-omni-plus`);
  const voice = optionalEnv('EXOMIND_OMNI_COMPAT_VOICE', 'Ethan');
  const audioFormat = optionalEnv('EXOMIND_OMNI_COMPAT_AUDIO_FORMAT', 'wav');
  const prompt = optionalEnv('EXOMIND_OMNI_COMPAT_PROMPT', '你是谁？请用一句中文回答。');
  const outputPath = optionalEnv(
    'EXOMIND_OMNI_COMPAT_OUTPUT_PATH',
    path.join(projectRoot, '.tmp', `omni-compatible-smoke-output.${audioFormat}`),
  );

  console.log('[omni-compatible-online-smoke] 准备启动在线 smoke...');
  console.log(`[omni-compatible-online-smoke] API Key: ${maskSecret(apiKey)}`);
  console.log(`[omni-compatible-online-smoke] Base URL: ${baseUrl}`);
  console.log(`[omni-compatible-online-smoke] Model: ${model}`);
  console.log(`[omni-compatible-online-smoke] Voice: ${voice}`);
  console.log(`[omni-compatible-online-smoke] Audio Format: ${audioFormat}`);
  console.log(`[omni-compatible-online-smoke] Prompt: ${prompt}`);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'user', content: prompt },
      ],
      modalities: ['text', 'audio'],
      audio: {
        voice,
        format: audioFormat,
      },
      stream: true,
      stream_options: {
        include_usage: true,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `HTTP ${response.status} ${response.statusText}（请求失败）: ${body || '<empty body>'}`,
    );
  }

  if (!response.body) {
    throw new Error('服务端未返回流式响应体（missing stream body）');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const audioChunks: Uint8Array[] = [];
  let transcript = '';
  let usageSummary = '';
  let pending = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    pending += decoder.decode(value, { stream: true });

    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) {
        continue;
      }

      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') {
        continue;
      }

      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (chunk.usage && typeof chunk.usage === 'object') {
        usageSummary = JSON.stringify(chunk.usage);
      }

      const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
      if (choices.length === 0) {
        continue;
      }

      const firstChoice = choices[0] as Record<string, unknown>;
      const delta = firstChoice.delta as Record<string, unknown> | undefined;
      if (!delta) {
        continue;
      }

      const content = delta.content;
      if (typeof content === 'string' && content) {
        transcript += content;
        process.stdout.write(content);
      }

      const audioDelta = decodeAudioDelta(delta);
      if (audioDelta && audioDelta.byteLength > 0) {
        audioChunks.push(audioDelta);
      }
    }
  }

  console.log('\n[omni-compatible-online-smoke] 文本输出结束');

  const mergedAudio = audioChunks.length > 0
    ? Buffer.concat(audioChunks.map((chunk) => Buffer.from(chunk)))
    : Buffer.alloc(0);

  await Bun.write(outputPath, mergedAudio);

  console.log(`[omni-compatible-online-smoke] 文本长度: ${transcript.length} chars`);
  console.log(`[omni-compatible-online-smoke] 音频长度: ${mergedAudio.byteLength} bytes`);
  console.log(`[omni-compatible-online-smoke] 音频已写入: ${outputPath}`);
  if (usageSummary) {
    console.log(`[omni-compatible-online-smoke] Usage: ${usageSummary}`);
  }
  console.log('[omni-compatible-online-smoke] PASS');
}

void main().catch((error) => {
  console.error('[omni-compatible-online-smoke] FAIL', error);
  process.exitCode = 1;
});

