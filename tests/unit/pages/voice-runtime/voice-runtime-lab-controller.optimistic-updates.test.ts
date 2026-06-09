import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockDoubaoStore = {
  appId: string;
  accessToken: string;
  secretKey: string;
  modelVersion: string;
  speaker: string;
  connectId: string;
  websocketUrl: string;
};

type MockOmniStore = {
  apiKey: string;
  model: string;
  voice: string;
  instructions: string;
  websocketUrl: string;
  compatibleModel: string;
  compatibleBaseUrl: string;
  compatibleAudioFormat: 'wav' | 'pcm16';
};

type MockRuntimeStore = {
  enabled: boolean;
  autoSpeakEnabled: boolean;
  providerId: 'doubao-o2-realtime' | `${'q'}wen-omni-realtime` | `${'q'}wen-omni-compatible`;
  cloudSessionPolicy: 'on-demand' | 'foreground-persistent';
};

const mockDoubaoStore: MockDoubaoStore = {
  appId: '',
  accessToken: '',
  secretKey: '',
  modelVersion: '1.2.1.1',
  speaker: 'zh_female_vv_jupiter_bigtts',
  connectId: '',
  websocketUrl: 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
};

const mockOmniStore: MockOmniStore = {
  apiKey: '',
  model: `${'q'}wen3.5-omni-plus-realtime`,
  voice: 'Ethan',
  instructions: '你是 ExoMind 的实时语音助手，请准确、简洁地回答用户问题。',
  websocketUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
  compatibleModel: `${'q'}wen3.5-omni-plus`,
  compatibleBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  compatibleAudioFormat: 'wav',
};

const mockRuntimeStore: MockRuntimeStore = {
  enabled: false,
  autoSpeakEnabled: true,
  providerId: 'doubao-o2-realtime',
  cloudSessionPolicy: 'on-demand',
};

let mockRuntimeMode: 'off' | 'push-to-talk' | 'ambient' = 'off';

function resetMockStores(): void {
  mockDoubaoStore.appId = '';
  mockDoubaoStore.accessToken = '';
  mockDoubaoStore.secretKey = '';
  mockDoubaoStore.modelVersion = '1.2.1.1';
  mockDoubaoStore.speaker = 'zh_female_vv_jupiter_bigtts';
  mockDoubaoStore.connectId = '';
  mockDoubaoStore.websocketUrl = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';

  mockOmniStore.apiKey = '';
  mockOmniStore.model = `${'q'}wen3.5-omni-plus-realtime`;
  mockOmniStore.voice = 'Ethan';
  mockOmniStore.instructions = '你是 ExoMind 的实时语音助手，请准确、简洁地回答用户问题。';
  mockOmniStore.websocketUrl = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
  mockOmniStore.compatibleModel = `${'q'}wen3.5-omni-plus`;
  mockOmniStore.compatibleBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  mockOmniStore.compatibleAudioFormat = 'wav';

  mockRuntimeStore.enabled = false;
  mockRuntimeStore.autoSpeakEnabled = true;
  mockRuntimeStore.providerId = 'doubao-o2-realtime';
  mockRuntimeStore.cloudSessionPolicy = 'on-demand';
  mockRuntimeMode = 'off';
}

vi.mock('@/lib/services/voice-signal.service', () => ({
  publishVoiceTranscriptSignal: vi.fn(async () => undefined),
  publishVoiceRuntimeSpeakRequestSignal: vi.fn(async () => undefined),
  publishVoiceRuntimeSpeakCancelSignal: vi.fn(async () => undefined),
}));

vi.mock('@/config/runtime-target', () => ({
  isTauriWindow: () => true,
}));

vi.mock('@/config/voice-runtime-doubao', () => ({
  getVoiceRuntimeDoubaoAppId: () => mockDoubaoStore.appId,
  setVoiceRuntimeDoubaoAppId: (value: string) => {
    mockDoubaoStore.appId = value.trim();
    return mockDoubaoStore.appId;
  },
  subscribeVoiceRuntimeDoubaoAppIdChanges: () => () => {},
  getVoiceRuntimeDoubaoAccessToken: () => mockDoubaoStore.accessToken,
  setVoiceRuntimeDoubaoAccessToken: (value: string) => {
    mockDoubaoStore.accessToken = value.trim();
    return mockDoubaoStore.accessToken;
  },
  subscribeVoiceRuntimeDoubaoAccessTokenChanges: () => () => {},
  getVoiceRuntimeDoubaoSecretKey: () => mockDoubaoStore.secretKey,
  setVoiceRuntimeDoubaoSecretKey: (value: string) => {
    mockDoubaoStore.secretKey = value.trim();
    return mockDoubaoStore.secretKey;
  },
  subscribeVoiceRuntimeDoubaoSecretKeyChanges: () => () => {},
  getVoiceRuntimeDoubaoModelVersion: () => mockDoubaoStore.modelVersion,
  setVoiceRuntimeDoubaoModelVersion: (value: string) => {
    mockDoubaoStore.modelVersion = value.trim() || '1.2.1.1';
    return mockDoubaoStore.modelVersion;
  },
  subscribeVoiceRuntimeDoubaoModelVersionChanges: () => () => {},
  getVoiceRuntimeDoubaoSpeaker: () => mockDoubaoStore.speaker,
  setVoiceRuntimeDoubaoSpeaker: (value: string) => {
    mockDoubaoStore.speaker = value.trim() || 'zh_female_vv_jupiter_bigtts';
    return mockDoubaoStore.speaker;
  },
  subscribeVoiceRuntimeDoubaoSpeakerChanges: () => () => {},
  getVoiceRuntimeDoubaoConnectId: () => mockDoubaoStore.connectId,
  setVoiceRuntimeDoubaoConnectId: (value: string) => {
    mockDoubaoStore.connectId = value.trim();
    return mockDoubaoStore.connectId;
  },
  subscribeVoiceRuntimeDoubaoConnectIdChanges: () => () => {},
  getVoiceRuntimeDoubaoWebsocketUrl: () => mockDoubaoStore.websocketUrl,
  setVoiceRuntimeDoubaoWebsocketUrl: (value: string) => {
    mockDoubaoStore.websocketUrl = value.trim() || 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';
    return mockDoubaoStore.websocketUrl;
  },
  subscribeVoiceRuntimeDoubaoWebsocketUrlChanges: () => () => {},
}));

vi.mock('@/config/voice-runtime-settings', () => ({
  VOICE_RUNTIME_OMNI_PROVIDER: `${'q'}wen-omni-realtime`,
  VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER: `${'q'}wen-omni-compatible`,
  getVoiceRuntimeEnabled: () => mockRuntimeStore.enabled,
  setVoiceRuntimeEnabled: (value: boolean) => {
    mockRuntimeStore.enabled = value;
    return mockRuntimeStore.enabled;
  },
  subscribeVoiceRuntimeEnabledChanges: () => () => {},
  getVoiceRuntimeAutoSpeakEnabled: () => mockRuntimeStore.autoSpeakEnabled,
  setVoiceRuntimeAutoSpeakEnabled: (value: boolean) => {
    mockRuntimeStore.autoSpeakEnabled = value;
    return mockRuntimeStore.autoSpeakEnabled;
  },
  subscribeVoiceRuntimeAutoSpeakEnabledChanges: () => () => {},
  getVoiceRuntimeProvider: () => mockRuntimeStore.providerId,
  setVoiceRuntimeProvider: (value: MockRuntimeStore['providerId']) => {
    mockRuntimeStore.providerId = value;
    return mockRuntimeStore.providerId;
  },
  subscribeVoiceRuntimeProviderChanges: () => () => {},
  getVoiceRuntimeCloudSessionPolicy: () => mockRuntimeStore.cloudSessionPolicy,
  setVoiceRuntimeCloudSessionPolicy: (
    value: 'on-demand' | 'foreground-persistent',
  ) => {
    mockRuntimeStore.cloudSessionPolicy = value;
    return mockRuntimeStore.cloudSessionPolicy;
  },
  subscribeVoiceRuntimeCloudSessionPolicyChanges: () => () => {},
}));

vi.mock('@/config/voice-runtime-omni', () => ({
  getVoiceRuntimeOmniApiKey: () => mockOmniStore.apiKey,
  setVoiceRuntimeOmniApiKey: (value: string) => {
    mockOmniStore.apiKey = value.trim();
    return mockOmniStore.apiKey;
  },
  subscribeVoiceRuntimeOmniApiKeyChanges: () => () => {},
  getVoiceRuntimeOmniModel: () => mockOmniStore.model,
  setVoiceRuntimeOmniModel: (value: string) => {
    mockOmniStore.model = value.trim() || `${'q'}wen3.5-omni-plus-realtime`;
    return mockOmniStore.model;
  },
  subscribeVoiceRuntimeOmniModelChanges: () => () => {},
  getVoiceRuntimeOmniVoice: () => mockOmniStore.voice,
  setVoiceRuntimeOmniVoice: (value: string) => {
    mockOmniStore.voice = value.trim() || 'Ethan';
    return mockOmniStore.voice;
  },
  subscribeVoiceRuntimeOmniVoiceChanges: () => () => {},
  getVoiceRuntimeOmniInstructions: () => mockOmniStore.instructions,
  setVoiceRuntimeOmniInstructions: (value: string) => {
    mockOmniStore.instructions = value.trim() || '你是 ExoMind 的实时语音助手，请准确、简洁地回答用户问题。';
    return mockOmniStore.instructions;
  },
  subscribeVoiceRuntimeOmniInstructionsChanges: () => () => {},
  getVoiceRuntimeOmniWebsocketUrl: () => mockOmniStore.websocketUrl,
  setVoiceRuntimeOmniWebsocketUrl: (value: string) => {
    mockOmniStore.websocketUrl = value.trim() || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
    return mockOmniStore.websocketUrl;
  },
  subscribeVoiceRuntimeOmniWebsocketUrlChanges: () => () => {},
  getVoiceRuntimeOmniSearchEnabled: () => true,
  setVoiceRuntimeOmniSearchEnabled: (value: boolean) => value,
  subscribeVoiceRuntimeOmniSearchEnabledChanges: () => () => {},
  getVoiceRuntimeOmniFunctionCallingEnabled: () => false,
  setVoiceRuntimeOmniFunctionCallingEnabled: (value: boolean) => value,
  subscribeVoiceRuntimeOmniFunctionCallingEnabledChanges: () => () => {},
  getVoiceRuntimeOmniToolChoice: () => 'auto',
  setVoiceRuntimeOmniToolChoice: (value: string) => value,
  subscribeVoiceRuntimeOmniToolChoiceChanges: () => () => {},
  getVoiceRuntimeOmniToolsJson: () => '[]',
  setVoiceRuntimeOmniToolsJson: (value: string) => value,
  subscribeVoiceRuntimeOmniToolsJsonChanges: () => () => {},
}));

vi.mock('@/config/voice-runtime-omni-compatible', () => ({
  getVoiceRuntimeOmniCompatibleModel: () => mockOmniStore.compatibleModel,
  setVoiceRuntimeOmniCompatibleModel: (value: string) => {
    mockOmniStore.compatibleModel = value.trim() || `${'q'}wen3.5-omni-plus`;
    return mockOmniStore.compatibleModel;
  },
  subscribeVoiceRuntimeOmniCompatibleModelChanges: () => () => {},
  getVoiceRuntimeOmniCompatibleBaseUrl: () => mockOmniStore.compatibleBaseUrl,
  setVoiceRuntimeOmniCompatibleBaseUrl: (value: string) => {
    mockOmniStore.compatibleBaseUrl = value.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    return mockOmniStore.compatibleBaseUrl;
  },
  subscribeVoiceRuntimeOmniCompatibleBaseUrlChanges: () => () => {},
  getVoiceRuntimeOmniCompatibleAudioFormat: () => mockOmniStore.compatibleAudioFormat,
  setVoiceRuntimeOmniCompatibleAudioFormat: (value: 'wav' | 'pcm16') => {
    mockOmniStore.compatibleAudioFormat = value;
    return mockOmniStore.compatibleAudioFormat;
  },
  subscribeVoiceRuntimeOmniCompatibleAudioFormatChanges: () => () => {},
}));

vi.mock('@/config/voice-runtime-mode', () => ({
  getVoiceRuntimeMode: () => mockRuntimeMode,
  setVoiceRuntimeMode: (value: 'off' | 'push-to-talk' | 'ambient') => {
    mockRuntimeMode = value;
    return mockRuntimeMode;
  },
  subscribeVoiceRuntimeModeChanges: () => () => {},
}));

describe('VoiceRuntimeLabController optimistic updates（控制器本地即时更新）', () => {
  beforeEach(() => {
    resetMockStores();
    vi.resetModules();
  });

  it('applies local credential and mode updates immediately even without config callbacks（即使没有配置回调也会立即刷新本地状态）', async () => {
    const { VoiceRuntimeLabController } = await import(
      '@/ui/app/pages/voice-runtime/voice-runtime-lab-controller'
    );

    const controller = new VoiceRuntimeLabController({
      audioPlayerFactory: () => ({
        enqueuePcm16: vi.fn(async () => undefined),
        interrupt: vi.fn(async () => undefined),
        dispose: vi.fn(async () => undefined),
      }),
    });

    controller.updateAppId('4587429383');
    controller.updateAccessToken('access-token');
    controller.updateSecretKey('secret-key');
    controller.updateModelVersion('1.2.1.1');
    controller.updateSpeaker('zh_female_vv_jupiter_bigtts');
    controller.updateConnectId('connect-id');
    controller.updateWebsocketUrl('wss://openspeech.bytedance.com/api/v3/realtime/dialogue');
    controller.updateRuntimeEnabled(true);
    controller.updateAutoSpeakEnabled(false);
    controller.updateRuntimeMode('ambient');
    controller.updateCloudSessionPolicy('foreground-persistent');
    controller.updateProvider(`${'q'}wen-omni-realtime`);
    controller.updateOmniApiKey('dashscope-api-key');
    controller.updateOmniModel(`${'q'}wen3.5-omni-plus-realtime`);
    controller.updateOmniVoice('Ethan');
    controller.updateOmniInstructions('你是实时语音助手');
    controller.updateOmniWebsocketUrl('wss://dashscope.aliyuncs.com/api-ws/v1/realtime');
    controller.updateOmniCompatibleModel(`${'q'}wen3.5-omni-plus`);
    controller.updateOmniCompatibleBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1');
    controller.updateOmniCompatibleAudioFormat('wav');

    expect(controller.getState()).toEqual(expect.objectContaining({
      appId: '4587429383',
      accessToken: 'access-token',
      secretKey: 'secret-key',
      modelVersion: '1.2.1.1',
      speaker: 'zh_female_vv_jupiter_bigtts',
      connectId: 'connect-id',
      websocketUrl: 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
      credentialConfigured: true,
      runtimeEnabled: true,
      autoSpeakEnabled: false,
      currentMode: 'ambient',
      currentCloudSessionPolicy: 'foreground-persistent',
      providerId: `${'q'}wen-omni-realtime`,
      omniApiKey: 'dashscope-api-key',
      omniModel: `${'q'}wen3.5-omni-plus-realtime`,
      omniVoice: 'Ethan',
      omniInstructions: '你是实时语音助手',
      omniWebsocketUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
      omniCompatibleModel: `${'q'}wen3.5-omni-plus`,
      omniCompatibleBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      omniCompatibleAudioFormat: 'wav',
    }));
  });
});
