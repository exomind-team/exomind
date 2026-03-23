/**
 * Volcano ASR config helpers（火山 ASR 配置辅助）
 *
 * Notes（说明）:
 * - request.model_name is fixed to `bigmodel` by official docs（官方目前固定为 bigmodel）
 * - model/version switching is done through resourceId（模型版本切换实际通过 resourceId）
 */

export type VolcanoEndpoint = 'bigmodel_async' | 'bigmodel' | 'bigmodel_nostream';

export interface VolcanoCredentialConfig {
  appKey: string;
  accessKey: string;
  resourceId: string;
  language?: string;
}

export interface VolcanoUiOptions {
  endpoint: VolcanoEndpoint;
  enableNonstream: boolean;
  showUtterances: boolean;
  endWindowSize: number;
  forceToSpeechTime: number;
}

export interface VolcanoRuntimeConfig extends VolcanoCredentialConfig {
  endpoint: VolcanoEndpoint;
  request: {
    model_name: 'bigmodel';
    enable_itn: true;
    enable_punc: true;
    show_utterances: boolean;
    enable_nonstream?: boolean;
    end_window_size?: number;
    force_to_speech_time?: number;
  };
}

export interface VolcanoHttpRequestPayload {
  audioBase64: string;
  config: VolcanoRuntimeConfig;
}

export const VOLCANO_MODEL_NAME = 'bigmodel' as const;

export const VOLCANO_STORAGE_KEYS = {
  appKey: 'volcano_asr_app_key',
  accessKey: 'volcano_asr_access_key',
  resourceId: 'volcano_asr_resource_id',
  endpoint: 'volcano_asr_endpoint',
  language: 'volcano_asr_language',
  enableNonstream: 'volcano_asr_enable_nonstream',
  showUtterances: 'volcano_asr_show_utterances',
  endWindowSize: 'volcano_asr_end_window_size',
  forceToSpeechTime: 'volcano_asr_force_to_speech_time',
} as const;

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') return null;
  const localStorageLike = window.localStorage as Partial<Storage> | undefined;
  if (!localStorageLike) return null;
  if (typeof localStorageLike.getItem !== 'function') return null;
  if (typeof localStorageLike.setItem !== 'function') return null;
  return localStorageLike as Pick<Storage, 'getItem' | 'setItem'>;
}

function readStoredString(key: string): string {
  try {
    return getStorage()?.getItem(key)?.trim() || '';
  } catch {
    return '';
  }
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = getStorage()?.getItem(key);
    return raw == null ? fallback : raw === 'true';
  } catch {
    return fallback;
  }
}

function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = getStorage()?.getItem(key);
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export const VOLCANO_ENDPOINT_OPTIONS: Array<{
  value: VolcanoEndpoint;
  label: string;
  description: string;
}> = [
  {
    value: 'bigmodel_async',
    label: '双向流式优化版（推荐）',
    description: '官方更推荐，速度更好；可叠加二遍识别提升最终准确率。',
  },
  {
    value: 'bigmodel',
    label: '双向流式旧版',
    description: '旧链路，返回更早，但当前官方更推荐 async 优化版。',
  },
  {
    value: 'bigmodel_nostream',
    label: '流式输入后返结果',
    description: '更偏准确率，通常在最后一包之后返回结果。',
  },
];

export const VOLCANO_RESOURCE_PRESETS = [
  { value: 'volc.bigasr.sauc.duration', label: '模型 1.0 小时版' },
  { value: 'volc.bigasr.sauc.concurrent', label: '模型 1.0 并发版' },
  { value: 'volc.seedasr.sauc.duration', label: '模型 2.0 小时版' },
  { value: 'volc.seedasr.sauc.concurrent', label: '模型 2.0 并发版' },
] as const;

export const DEFAULT_VOLCANO_RESOURCE_ID = 'volc.seedasr.sauc.duration' as const;

export const VOLCANO_LANGUAGE_OPTIONS = [
  { value: 'zh-CN', label: '中文（zh-CN）' },
  { value: 'en-US', label: '英语（en-US）' },
  { value: 'ja-JP', label: '日语（ja-JP）' },
  { value: 'ko-KR', label: '韩语（ko-KR）' },
] as const;

export const DEFAULT_VOLCANO_ASR_OPTIONS: VolcanoUiOptions = {
  endpoint: 'bigmodel_async',
  enableNonstream: true,
  showUtterances: true,
  endWindowSize: 800,
  forceToSpeechTime: 1000,
};

function trimOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function findVolcanoResourcePreset(resourceId: string): string {
  return VOLCANO_RESOURCE_PRESETS.find((item) => item.value === resourceId)?.value ?? resourceId;
}

export function getVolcanoResourceId(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>
): string {
  return readStoredString(VOLCANO_STORAGE_KEYS.resourceId) || (env.VITE_VOLCANO_RESOURCE_ID || DEFAULT_VOLCANO_RESOURCE_ID);
}

export function setVolcanoResourceId(resourceId: string): string {
  const normalized = findVolcanoResourcePreset(resourceId.trim()) || DEFAULT_VOLCANO_RESOURCE_ID;
  const storage = getStorage();
  if (!storage) return normalized;
  storage.setItem(VOLCANO_STORAGE_KEYS.resourceId, normalized);
  return normalized;
}

export function buildVolcanoRuntimeConfig(
  credentials: VolcanoCredentialConfig,
  options: VolcanoUiOptions
): VolcanoRuntimeConfig {
  const config: VolcanoRuntimeConfig = {
    appKey: credentials.appKey.trim(),
    accessKey: credentials.accessKey.trim(),
    resourceId: credentials.resourceId.trim(),
    language: trimOptional(credentials.language),
    endpoint: options.endpoint,
    request: {
      model_name: VOLCANO_MODEL_NAME,
      enable_itn: true,
      enable_punc: true,
      show_utterances: options.showUtterances,
    },
  };

  if (options.endpoint === 'bigmodel_async' && options.enableNonstream) {
    config.request.enable_nonstream = true;
  }
  if (options.endpoint === 'bigmodel_async' && options.endWindowSize > 0) {
    config.request.end_window_size = options.endWindowSize;
  }
  if (options.endpoint === 'bigmodel_async' && options.forceToSpeechTime > 0) {
    config.request.force_to_speech_time = options.forceToSpeechTime;
  }

  return config;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function buildVolcanoHttpRequestPayload(
  audioBytes: Uint8Array,
  credentials: VolcanoCredentialConfig,
  options: VolcanoUiOptions
): VolcanoHttpRequestPayload {
  return {
    audioBase64: bytesToBase64(audioBytes),
    config: buildVolcanoRuntimeConfig(credentials, options),
  };
}

export function getStoredVolcanoRuntimeConfig(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>
): VolcanoRuntimeConfig {
  const credentials: VolcanoCredentialConfig = {
    appKey: readStoredString(VOLCANO_STORAGE_KEYS.appKey) || (env.VITE_VOLCANO_APP_KEY || ''),
    accessKey: readStoredString(VOLCANO_STORAGE_KEYS.accessKey) || (env.VITE_VOLCANO_ACCESS_KEY || ''),
    resourceId: readStoredString(VOLCANO_STORAGE_KEYS.resourceId) || (env.VITE_VOLCANO_RESOURCE_ID || DEFAULT_VOLCANO_RESOURCE_ID),
    language: readStoredString(VOLCANO_STORAGE_KEYS.language) || 'zh-CN',
  };

  const endpointRaw = readStoredString(VOLCANO_STORAGE_KEYS.endpoint);
  const endpoint = VOLCANO_ENDPOINT_OPTIONS.some((item) => item.value === endpointRaw)
    ? endpointRaw as VolcanoEndpoint
    : DEFAULT_VOLCANO_ASR_OPTIONS.endpoint;

  return buildVolcanoRuntimeConfig(credentials, {
    endpoint,
    enableNonstream: readStoredBoolean(
      VOLCANO_STORAGE_KEYS.enableNonstream,
      DEFAULT_VOLCANO_ASR_OPTIONS.enableNonstream
    ),
    showUtterances: readStoredBoolean(
      VOLCANO_STORAGE_KEYS.showUtterances,
      DEFAULT_VOLCANO_ASR_OPTIONS.showUtterances
    ),
    endWindowSize: readStoredNumber(
      VOLCANO_STORAGE_KEYS.endWindowSize,
      DEFAULT_VOLCANO_ASR_OPTIONS.endWindowSize
    ),
    forceToSpeechTime: readStoredNumber(
      VOLCANO_STORAGE_KEYS.forceToSpeechTime,
      DEFAULT_VOLCANO_ASR_OPTIONS.forceToSpeechTime
    ),
  });
}
