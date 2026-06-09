import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRuntimeConfigCacheForTests } from '@/config/runtime-config-cache';
import {
  setVoiceRuntimeDoubaoAccessToken,
} from '@/config/voice-runtime-doubao';
import {
  setVoiceRuntimeEnabled,
  setVoiceRuntimeProvider,
  VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER,
} from '@/config/voice-runtime-settings';
import { setVoiceRuntimeMode } from '@/config/voice-runtime-mode';
import {
  VoiceAssistantRuntimeService,
  __resetVoiceAssistantRuntimeServiceForTests,
} from '@/services/voice-assistant-runtime.service';

const controllerState = {
  status: 'idle' as 'idle' | 'connecting' | 'listening' | 'responding' | 'error',
  currentMode: 'off' as 'off' | 'push-to-talk' | 'ambient',
  isTauri: true,
};

const startListeningMock = vi.fn(async () => {
  controllerState.status = 'listening';
  controllerState.currentMode = 'ambient';
});
const cancelListeningMock = vi.fn(async () => {
  controllerState.status = 'idle';
});
const disposeMock = vi.fn(async () => undefined);

vi.mock('@/ui/app/pages/voice-runtime/voice-runtime-lab-controller', () => ({
  VoiceRuntimeLabController: class FakeVoiceRuntimeLabController {
    getState() {
      return {
        status: controllerState.status,
        currentMode: controllerState.currentMode,
        isTauri: controllerState.isTauri,
      };
    }

    subscribe(): () => void {
      return () => undefined;
    }

    startListening = startListeningMock;
    cancelListening = cancelListeningMock;
    dispose = disposeMock;
  },
}));

describe('VoiceAssistantRuntimeService（常驻语音助手运行时服务）', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
    await __resetVoiceAssistantRuntimeServiceForTests();
    controllerState.status = 'idle';
    controllerState.currentMode = 'off';
    controllerState.isTauri = true;
    startListeningMock.mockClear();
    cancelListeningMock.mockClear();
    disposeMock.mockClear();
    setVoiceRuntimeEnabled(false);
    setVoiceRuntimeMode('off');
    setVoiceRuntimeProvider('doubao-o2-realtime');
  });

  it('auto starts listening when ambient assistant is enabled（环境监听开启后自动启动监听）', async () => {
    setVoiceRuntimeEnabled(true);
    setVoiceRuntimeMode('ambient');

    const service = new VoiceAssistantRuntimeService();
    await service.init();

    expect(startListeningMock).toHaveBeenCalledTimes(1);
    expect(cancelListeningMock).not.toHaveBeenCalled();

    await service.destroy();
  });

  it('cancels managed ambient session when feature is disabled（关闭功能后回收常驻监听会话）', async () => {
    setVoiceRuntimeEnabled(true);
    setVoiceRuntimeMode('ambient');

    const service = new VoiceAssistantRuntimeService();
    await service.init();
    expect(startListeningMock).toHaveBeenCalledTimes(1);

    setVoiceRuntimeEnabled(false);
    await vi.waitFor(() => {
      expect(cancelListeningMock).toHaveBeenCalledTimes(1);
    });

    await service.destroy();
  });

  it('does not auto start unsupported ambient provider（不自动启动不支持环境监听的 Provider）', async () => {
    setVoiceRuntimeEnabled(true);
    setVoiceRuntimeMode('ambient');
    setVoiceRuntimeProvider(VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER);

    const service = new VoiceAssistantRuntimeService();
    await service.init();

    expect(startListeningMock).not.toHaveBeenCalled();
    expect(cancelListeningMock).not.toHaveBeenCalled();

    await service.destroy();
  });

  it('does not auto start in web preview environment（Web 预览环境不自动启动常驻监听）', async () => {
    controllerState.isTauri = false;
    setVoiceRuntimeEnabled(true);
    setVoiceRuntimeMode('ambient');

    const service = new VoiceAssistantRuntimeService();
    await service.init();

    expect(startListeningMock).not.toHaveBeenCalled();
    expect(cancelListeningMock).not.toHaveBeenCalled();

    await service.destroy();
  });

  it('restarts managed ambient session after config changes（配置变更后重建常驻环境监听会话）', async () => {
    setVoiceRuntimeEnabled(true);
    setVoiceRuntimeMode('ambient');

    const service = new VoiceAssistantRuntimeService();
    await service.init();
    expect(startListeningMock).toHaveBeenCalledTimes(1);

    setVoiceRuntimeDoubaoAccessToken('updated-token');

    await vi.waitFor(() => {
      expect(cancelListeningMock).toHaveBeenCalledTimes(1);
      expect(startListeningMock).toHaveBeenCalledTimes(2);
    });

    await service.destroy();
  });
});
