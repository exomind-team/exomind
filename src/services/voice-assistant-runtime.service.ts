import {
  getVoiceRuntimeEnabled,
  getVoiceRuntimeProvider,
  subscribeVoiceRuntimeEnabledChanges,
  subscribeVoiceRuntimeProviderChanges,
  VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER,
  VOICE_RUNTIME_OMNI_PROVIDER,
} from '@/config/voice-runtime-settings';
import {
  getVoiceRuntimeMode,
  subscribeVoiceRuntimeModeChanges,
} from '@/config/voice-runtime-mode';
import {
  getVoiceRuntimeDoubaoAccessToken,
  getVoiceRuntimeDoubaoAppId,
  getVoiceRuntimeDoubaoConnectId,
  getVoiceRuntimeDoubaoModelVersion,
  getVoiceRuntimeDoubaoSecretKey,
  getVoiceRuntimeDoubaoSpeaker,
  getVoiceRuntimeDoubaoWebsocketUrl,
  subscribeVoiceRuntimeDoubaoAccessTokenChanges,
  subscribeVoiceRuntimeDoubaoAppIdChanges,
  subscribeVoiceRuntimeDoubaoConnectIdChanges,
  subscribeVoiceRuntimeDoubaoModelVersionChanges,
  subscribeVoiceRuntimeDoubaoSecretKeyChanges,
  subscribeVoiceRuntimeDoubaoSpeakerChanges,
  subscribeVoiceRuntimeDoubaoWebsocketUrlChanges,
} from '@/config/voice-runtime-doubao';
import {
  getVoiceRuntimeOmniApiKey,
  getVoiceRuntimeOmniFunctionCallingEnabled,
  getVoiceRuntimeOmniInstructions,
  getVoiceRuntimeOmniModel,
  getVoiceRuntimeOmniSearchEnabled,
  getVoiceRuntimeOmniToolChoice,
  getVoiceRuntimeOmniToolsJson,
  getVoiceRuntimeOmniVoice,
  getVoiceRuntimeOmniWebsocketUrl,
  subscribeVoiceRuntimeOmniApiKeyChanges,
  subscribeVoiceRuntimeOmniFunctionCallingEnabledChanges,
  subscribeVoiceRuntimeOmniInstructionsChanges,
  subscribeVoiceRuntimeOmniModelChanges,
  subscribeVoiceRuntimeOmniSearchEnabledChanges,
  subscribeVoiceRuntimeOmniToolChoiceChanges,
  subscribeVoiceRuntimeOmniToolsJsonChanges,
  subscribeVoiceRuntimeOmniVoiceChanges,
  subscribeVoiceRuntimeOmniWebsocketUrlChanges,
} from '@/config/voice-runtime-omni';
import { VoiceRuntimeLabController } from '@/ui/app/pages/voice-runtime/voice-runtime-lab-controller';

type VoiceAssistantRuntimeGlobal = {
  instance: VoiceAssistantRuntimeService | null;
};

const VOICE_ASSISTANT_RUNTIME_GLOBAL_KEY = '__EXOMIND_VOICE_ASSISTANT_RUNTIME__';

function getVoiceAssistantRuntimeGlobal(): VoiceAssistantRuntimeGlobal {
  const globalScope = globalThis as typeof globalThis & {
    [VOICE_ASSISTANT_RUNTIME_GLOBAL_KEY]?: VoiceAssistantRuntimeGlobal;
  };

  if (!globalScope[VOICE_ASSISTANT_RUNTIME_GLOBAL_KEY]) {
    globalScope[VOICE_ASSISTANT_RUNTIME_GLOBAL_KEY] = {
      instance: null,
    };
  }

  return globalScope[VOICE_ASSISTANT_RUNTIME_GLOBAL_KEY]!;
}

function isSessionActive(status: ReturnType<VoiceRuntimeLabController['getState']>['status']): boolean {
  return status === 'connecting' || status === 'listening' || status === 'responding';
}

function getAmbientRuntimeConfigKey(): string {
  const provider = getVoiceRuntimeProvider();

  if (!getVoiceRuntimeEnabled() || getVoiceRuntimeMode() !== 'ambient') {
    return 'disabled';
  }

  if (provider === VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER) {
    return 'unsupported';
  }

  if (provider === VOICE_RUNTIME_OMNI_PROVIDER) {
    return JSON.stringify({
      provider,
      apiKey: getVoiceRuntimeOmniApiKey(),
      model: getVoiceRuntimeOmniModel(),
      voice: getVoiceRuntimeOmniVoice(),
      instructions: getVoiceRuntimeOmniInstructions(),
      websocketUrl: getVoiceRuntimeOmniWebsocketUrl(),
      searchEnabled: getVoiceRuntimeOmniSearchEnabled(),
      functionCallingEnabled: getVoiceRuntimeOmniFunctionCallingEnabled(),
      toolChoice: getVoiceRuntimeOmniToolChoice(),
      toolsJson: getVoiceRuntimeOmniToolsJson(),
    });
  }

  return JSON.stringify({
    provider,
    appId: getVoiceRuntimeDoubaoAppId(),
    accessToken: getVoiceRuntimeDoubaoAccessToken(),
    secretKey: getVoiceRuntimeDoubaoSecretKey(),
    modelVersion: getVoiceRuntimeDoubaoModelVersion(),
    speaker: getVoiceRuntimeDoubaoSpeaker(),
    connectId: getVoiceRuntimeDoubaoConnectId(),
    websocketUrl: getVoiceRuntimeDoubaoWebsocketUrl(),
  });
}

export class VoiceAssistantRuntimeService {
  private readonly controller = new VoiceRuntimeLabController();
  private readonly unsubscribers: Array<() => void> = [];
  private initPromise: Promise<void> | null = null;
  private syncChain: Promise<void> = Promise.resolve();
  private destroyed = false;
  private managesAmbientSession = false;
  private activeAmbientConfigKey: string | null = null;

  getController(): VoiceRuntimeLabController {
    return this.controller;
  }

  async init(): Promise<void> {
    if (this.destroyed) {
      this.destroyed = false;
    }
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      const sync = () => {
        void this.syncWithConfig();
      };

      this.unsubscribers.push(
        subscribeVoiceRuntimeEnabledChanges(sync),
        subscribeVoiceRuntimeModeChanges(sync),
        subscribeVoiceRuntimeProviderChanges(sync),
        subscribeVoiceRuntimeDoubaoAppIdChanges(sync),
        subscribeVoiceRuntimeDoubaoAccessTokenChanges(sync),
        subscribeVoiceRuntimeDoubaoSecretKeyChanges(sync),
        subscribeVoiceRuntimeDoubaoModelVersionChanges(sync),
        subscribeVoiceRuntimeDoubaoSpeakerChanges(sync),
        subscribeVoiceRuntimeDoubaoConnectIdChanges(sync),
        subscribeVoiceRuntimeDoubaoWebsocketUrlChanges(sync),
        subscribeVoiceRuntimeOmniApiKeyChanges(sync),
        subscribeVoiceRuntimeOmniModelChanges(sync),
        subscribeVoiceRuntimeOmniVoiceChanges(sync),
        subscribeVoiceRuntimeOmniInstructionsChanges(sync),
        subscribeVoiceRuntimeOmniWebsocketUrlChanges(sync),
        subscribeVoiceRuntimeOmniSearchEnabledChanges(sync),
        subscribeVoiceRuntimeOmniFunctionCallingEnabledChanges(sync),
        subscribeVoiceRuntimeOmniToolChoiceChanges(sync),
        subscribeVoiceRuntimeOmniToolsJsonChanges(sync),
      );

      await this.syncWithConfig();
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
    this.managesAmbientSession = false;
    this.activeAmbientConfigKey = null;
    await this.controller.dispose();
  }

  private async syncWithConfig(): Promise<void> {
    this.syncChain = this.syncChain.then(async () => {
      if (this.destroyed) {
        return;
      }

      const state = this.controller.getState();
      const nextAmbientConfigKey = getAmbientRuntimeConfigKey();
      const shouldRunAmbient = state.isTauri
        && nextAmbientConfigKey !== 'disabled'
        && nextAmbientConfigKey !== 'unsupported';
      const sessionActive = isSessionActive(state.status);

      if (shouldRunAmbient) {
        const shouldRestartManagedSession = this.managesAmbientSession
          && this.activeAmbientConfigKey !== null
          && this.activeAmbientConfigKey !== nextAmbientConfigKey;

        if (shouldRestartManagedSession && (sessionActive || state.status === 'error')) {
          await this.controller.cancelListening();
        }

        const refreshedState = shouldRestartManagedSession
          ? this.controller.getState()
          : state;
        const refreshedSessionActive = isSessionActive(refreshedState.status);

        if (refreshedSessionActive) {
          this.managesAmbientSession = refreshedState.currentMode === 'ambient';
          this.activeAmbientConfigKey = nextAmbientConfigKey;
          return;
        }
        this.managesAmbientSession = true;
        this.activeAmbientConfigKey = nextAmbientConfigKey;
        await this.controller.startListening();
        return;
      }

      if (!this.managesAmbientSession) {
        return;
      }

      this.managesAmbientSession = false;
      this.activeAmbientConfigKey = null;
      if (sessionActive || state.status === 'error') {
        await this.controller.cancelListening();
      }
    }).catch((error) => {
      console.warn(
        'Voice assistant runtime sync failed（常驻语音助手同步失败）',
        error,
      );
    });

    await this.syncChain;
  }
}

export function getVoiceAssistantRuntimeService(): VoiceAssistantRuntimeService {
  const runtime = getVoiceAssistantRuntimeGlobal();
  if (!runtime.instance) {
    runtime.instance = new VoiceAssistantRuntimeService();
  }
  return runtime.instance;
}

export async function initVoiceAssistantRuntimeService(): Promise<void> {
  await getVoiceAssistantRuntimeService().init();
}

export async function destroyVoiceAssistantRuntimeService(): Promise<void> {
  const runtime = getVoiceAssistantRuntimeGlobal();
  if (!runtime.instance) {
    return;
  }

  const instance = runtime.instance;
  runtime.instance = null;
  await instance.destroy();
}

export async function __resetVoiceAssistantRuntimeServiceForTests(): Promise<void> {
  await destroyVoiceAssistantRuntimeService();
}
