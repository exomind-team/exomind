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

type MockRuntimeStore = {
  enabled: boolean;
  autoSpeakEnabled: boolean;
  providerId: 'doubao-o2-realtime';
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
  setVoiceRuntimeProvider: () => mockRuntimeStore.providerId,
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
    }));
  });
});
