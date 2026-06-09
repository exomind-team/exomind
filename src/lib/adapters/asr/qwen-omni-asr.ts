import type {
  ASRInput,
  ASRPartialResult,
  ASRResult,
  IASRConfig,
  IASRPort,
} from '@/lib/ports/asr-port';
import { QWEN_OMNI_OPTIMIZE_PROMPT, QWEN_OMNI_TRANSCRIBE_PROMPT } from '@/lib/voice/qwen-omni-prompts';

export interface QwenOmniASRAdapterConfig extends IASRConfig {
  profileName?: string;
  baseUrl?: string;
  model?: string;
  optimizeEnabled?: boolean;
  transcribePrompt?: string;
  optimizePrompt?: string;
}

interface OpenAICompatMessage {
  role: 'system' | 'user';
  content: unknown;
}

interface OpenAICompatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string | null;
    type?: string | null;
    code?: string | null;
  };
}

interface OpenAICompatStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
}

function normalizeApiKey(value: string | undefined): string {
  if (!value) return '';
  let normalized = value.trim();
  normalized = normalized.replace(/^['"]|['"]$/g, '');
  normalized = normalized.replace(/^Bearer\s+/i, '');
  return normalized.trim();
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}

function extractText(response: OpenAICompatResponse): string {
  return response.choices?.[0]?.message?.content?.trim() || '';
}

function tryParseJson<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function parseStreamingText(body: string): string {
  let result = '';

  for (const line of body.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith(':')) {
      continue;
    }
    if (!trimmedLine.startsWith('data:')) {
      continue;
    }

    const data = trimmedLine.slice(5).trim();
    if (!data || data === '[DONE]') {
      continue;
    }

    const chunk = tryParseJson<OpenAICompatStreamChunk>(data);
    const content = chunk?.choices?.[0]?.delta?.content;
    if (content) {
      result += content;
    }
  }

  return result.trim();
}

function extractTextFromResponseBody(body: string): string {
  const streamedText = parseStreamingText(body);
  if (streamedText) {
    return streamedText;
  }

  const payload = tryParseJson<OpenAICompatResponse>(body);
  return payload ? extractText(payload) : '';
}

function buildAccessDeniedHint(model: string): string {
  if (model.includes('qwen3.5-omni-plus')) {
    return `${model} 当前账号可能无权限，建议先改用 qwen3-omni-flash。`;
  }
  return `${model} 返回 access_denied，请检查百炼模型权限或改用已开放模型。`;
}

function extractErrorDetail(rawBody: string, model: string): string {
  const payload = tryParseJson<OpenAICompatResponse>(rawBody);
  const message = payload?.error?.message?.trim();
  const code = payload?.error?.code?.trim() || payload?.error?.type?.trim();
  if (code === 'access_denied') {
    throw new Error(buildAccessDeniedHint(model));
  }

  const detail = [code, message].filter(Boolean).join(': ');
  return detail || rawBody.trim();
}

export class QwenOmniASRAdapter implements IASRPort {
  private config: Required<Pick<QwenOmniASRAdapterConfig, 'profileName' | 'apiKey' | 'apiUrl' | 'model' | 'optimizeEnabled'>>;
  private transcribePrompt: string;
  private optimizePrompt: string;

  constructor(config?: QwenOmniASRAdapterConfig) {
    this.config = {
      profileName: config?.profileName?.trim() || '',
      apiKey: normalizeApiKey(config?.apiKey),
      apiUrl: config?.apiUrl?.trim() || config?.baseUrl?.trim() || '',
      model: config?.model?.trim() || '',
      optimizeEnabled: config?.optimizeEnabled === true,
    };
    this.transcribePrompt = config?.transcribePrompt?.trim() || QWEN_OMNI_TRANSCRIBE_PROMPT;
    this.optimizePrompt = config?.optimizePrompt?.trim() || QWEN_OMNI_OPTIMIZE_PROMPT;
  }

  configure(config: IASRConfig & Partial<QwenOmniASRAdapterConfig>): void {
    if (typeof config.profileName === 'string') this.config.profileName = config.profileName.trim();
    if (typeof config.apiKey === 'string') this.config.apiKey = normalizeApiKey(config.apiKey);
    if (typeof config.apiUrl === 'string') this.config.apiUrl = config.apiUrl.trim();
    if (typeof config.baseUrl === 'string' && !this.config.apiUrl) this.config.apiUrl = config.baseUrl.trim();
    if (typeof config.model === 'string') this.config.model = config.model.trim();
    if (typeof config.optimizeEnabled === 'boolean') this.config.optimizeEnabled = config.optimizeEnabled;
    if (typeof config.transcribePrompt === 'string' && config.transcribePrompt.trim()) this.transcribePrompt = config.transcribePrompt;
    if (typeof config.optimizePrompt === 'string' && config.optimizePrompt.trim()) this.optimizePrompt = config.optimizePrompt;
  }

  getSupportedLanguages(): string[] {
    return ['zh-CN', 'en-US'];
  }

  isAvailable(): boolean {
    return Boolean(this.config.profileName && this.config.apiKey && this.config.apiUrl && this.config.model);
  }

  async transcribe(input: ASRInput): Promise<ASRResult> {
    if (!this.isAvailable()) {
      throw new Error('Qwen Omni 配置不完整，请先选择语音供应商档案并填写模型 ID');
    }
    if (!input.preRecordedAudio?.length) {
      throw new Error('Qwen Omni 需要预录制音频数据');
    }

    const base64Audio = bytesToBase64(input.preRecordedAudio);
    const url = joinUrl(this.config.apiUrl, '/chat/completions');
    const systemPrompt = this.transcribePrompt;

    const messages: OpenAICompatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [{
          type: 'input_audio',
          input_audio: {
            data: `data:audio/wav;base64,${base64Audio}`,
            format: 'wav',
          },
        }],
      },
    ];

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        modalities: ['text'],
        stream: true,
        stream_options: {
          include_usage: true,
        },
      }),
    });

    const rawBody = await response.text();

    if (!response.ok) {
      const detail = extractErrorDetail(rawBody, this.config.model);
      throw new Error(`Qwen Omni API error: ${response.status}${detail ? ` (${detail})` : ''}`);
    }

    const transcribedText = extractTextFromResponseBody(rawBody);
    const finalText = this.config.optimizeEnabled
      ? await this.optimizeText(url, transcribedText)
      : transcribedText;

    return {
      text: finalText,
      confidence: 1,
      lang: input.lang || 'zh-CN',
    };
  }

  async *streamTranscribe(_input: ASRInput): AsyncIterable<ASRPartialResult> {
    throw new Error('Qwen Omni adapter does not support streaming yet');
  }

  private async optimizeText(url: string, text: string): Promise<string> {
    if (!text.trim()) {
      return text;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        modalities: ['text'],
        messages: [
          { role: 'system', content: this.optimizePrompt },
          { role: 'user', content: `<voice-input>\n${text}\n</voice-input>` },
        ],
        stream: true,
        stream_options: {
          include_usage: true,
        },
      }),
    });

    if (!response.ok) {
      return text;
    }

    const rawBody = await response.text();
    return extractTextFromResponseBody(rawBody) || text;
  }
}
