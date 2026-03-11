import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Switch } from '@/components/ui/switch';
import { getTaskBackupService } from '@/lib/services';
import { SettingsItemRow } from './settings-item-row';
import { PeerPairingDialog } from '@/ui/app/components/PeerPairingDialog';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';
import {
  getTimerPreferences,
  subscribeTimerPreferencesChanges,
  updateTimerPreferences,
  type CountdownEndMode,
} from '@/config/timer-preferences';
import {
  TIMER_END_SOUND_PRESETS,
  getTimerEndSoundPresetById,
  type TimerEndSoundPresetId,
} from '@/lib/media/timer-end-sounds';
import {
  getLLMApiKey,
  getLLMBaseUrl,
  getLLMModel,
  setLLMApiKey,
  setLLMBaseUrl,
  setLLMModel,
  subscribeLLMSettingsChanges,
} from '@/config/llm-settings';
import {
  getAgentPageEnabled,
  setAgentPageEnabled,
  subscribeAgentPageEnabledChanges,
} from '@/config/agent-page-enabled';
import {
  getDesktopAdaptiveEnabled,
  setDesktopAdaptiveEnabled,
  subscribeDesktopAdaptiveChanges,
} from '@/config/desktop-adaptive';
import {
  getCommandPaletteEnabled,
  setCommandPaletteEnabled,
  subscribeCommandPaletteEnabledChanges,
} from '@/config/command-palette-enabled';
import { getDeveloperModeEnabled } from '@/config/developer-mode';
import { importTasksFromFile } from '@/services/impl/settings-data-service';
import {
  EMBEDDED_RUNTIME_STATUS_STORAGE_KEY,
  getSelectedRuntimeTarget,
  toRuntimeBaseUrl,
} from '@/config/runtime-target';

function useSettingValue<T>(
  getValue: () => T,
  subscribe?: (listener: (value: T) => void) => () => void,
): [T, (value: T) => void] {
  const getValueRef = useRef(getValue);
  getValueRef.current = getValue;
  const [value, setValue] = useState<T>(() => getValueRef.current());

  useEffect(() => {
    if (!subscribe) {
      return;
    }
    return subscribe((nextValue) => {
      setValue(nextValue);
    });
  }, [subscribe]);

  return [value, setValue];
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === 'object' && value !== null && typeof (value as PromiseLike<T>).then === 'function';
}

function NoticeBlock({
  message,
  tone,
}: {
  message: string | null;
  tone: 'success' | 'error';
}) {
  if (!message) {
    return null;
  }

  return (
    <div className={`px-4 pb-3 text-xs ${tone === 'error' ? 'text-red-600' : 'text-[#78716C]'}`}>
      {message}
    </div>
  );
}

function SecondaryValue({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-1 text-sm text-[#A8A29E]">
      <span>{value}</span>
      <ChevronRight className="h-4 w-4" />
    </div>
  );
}

export function CountdownEndModeSetting(_props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  const [countdownEndMode, setCountdownEndMode] = useSettingValue(
    () => getTimerPreferences().countdownEndMode,
    (listener) => subscribeTimerPreferencesChanges((preferences) => listener(preferences.countdownEndMode)),
  );

  const currentLabel = countdownEndMode === 'hard' ? '硬停止' : '柔和提醒';

  const handleSelect = (mode: CountdownEndMode) => {
    setCountdownEndMode(mode);
    updateTimerPreferences({ countdownEndMode: mode });
    setOpen(false);
  };

  return (
    <>
      <SettingsItemRow
        label="倒计时结束"
        onClick={() => setOpen(true)}
        control={<SecondaryValue value={currentLabel} />}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>倒计时结束模式</DialogTitle>
            <DialogDescription>选择倒计时结束后的行为</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {([
              { label: '硬停止', value: 'hard' },
              { label: '柔和提醒', value: 'soft' },
            ] as const).map((option) => {
              const selected = countdownEndMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className="flex w-full items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm"
                >
                  <span>{option.label}</span>
                  {selected ? <Check className="h-4 w-4 text-[#C75B3A]" /> : null}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SoundPresetSetting(_props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  const [timerPreferences, setTimerPreferences] = useSettingValue(
    () => getTimerPreferences(),
    subscribeTimerPreferencesChanges,
  );

  const currentLabel = timerPreferences.countdownEndSoundEnabled
    ? getTimerEndSoundPresetById(timerPreferences.countdownEndSoundPresetId).label
    : '已关闭';

  const handleSelect = (presetId: TimerEndSoundPresetId | 'off') => {
    if (presetId === 'off') {
      setTimerPreferences(updateTimerPreferences({ countdownEndSoundEnabled: false }));
      setOpen(false);
      return;
    }

    setTimerPreferences(updateTimerPreferences({
      countdownEndSoundEnabled: true,
      countdownEndSoundPresetId: presetId,
    }));
    setOpen(false);
  };

  return (
    <>
      <SettingsItemRow
        label="提示音"
        onClick={() => setOpen(true)}
        control={<SecondaryValue value={currentLabel} />}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>选择提示音</DialogTitle>
            <DialogDescription>设置倒计时结束后的提示音</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => handleSelect('off')}
              className="flex w-full items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm"
            >
              <span>关闭提示音</span>
              {!timerPreferences.countdownEndSoundEnabled ? <Check className="h-4 w-4 text-[#C75B3A]" /> : null}
            </button>
            {TIMER_END_SOUND_PRESETS.map((preset) => {
              const selected = timerPreferences.countdownEndSoundEnabled
                && timerPreferences.countdownEndSoundPresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelect(preset.id)}
                  className="flex w-full items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm"
                >
                  <span>{preset.label}</span>
                  {selected ? <Check className="h-4 w-4 text-[#C75B3A]" /> : null}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AiApiKeySetting(_props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useSettingValue(
    () => ({
      apiKey: getLLMApiKey(),
      baseUrl: getLLMBaseUrl(),
      model: getLLMModel(),
    }),
    subscribeLLMSettingsChanges,
  );
  const [apiKeyDraft, setApiKeyDraft] = useState(settings.apiKey);
  const [baseUrlDraft, setBaseUrlDraft] = useState(settings.baseUrl);
  const [modelDraft, setModelDraft] = useState(settings.model);

  return (
    <>
      <SettingsItemRow
        label="AI API Key"
        onClick={() => {
          setApiKeyDraft(getLLMApiKey());
          setBaseUrlDraft(getLLMBaseUrl());
          setModelDraft(getLLMModel());
          setOpen(true);
        }}
        control={<SecondaryValue value={settings.apiKey ? '已配置' : '未配置'} />}
      />
      <NoticeBlock message={notice} tone="success" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>AI 设置</DialogTitle>
            <DialogDescription>配置 Agent 对话使用的大语言模型</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <input
              type="password"
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              placeholder="sk-..."
              className="w-full rounded-xl border border-[#F0ECE8] px-4 py-3 text-sm"
            />
            <input
              type="url"
              value={baseUrlDraft}
              onChange={(event) => setBaseUrlDraft(event.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-xl border border-[#F0ECE8] px-4 py-3 text-sm"
            />
            <input
              type="text"
              value={modelDraft}
              onChange={(event) => setModelDraft(event.target.value)}
              placeholder="gpt-4o"
              className="w-full rounded-xl border border-[#F0ECE8] px-4 py-3 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setLLMApiKey(apiKeyDraft);
                  setLLMBaseUrl(baseUrlDraft);
                  setLLMModel(modelDraft);
                  setSettings({
                    apiKey: apiKeyDraft.trim(),
                    baseUrl: baseUrlDraft.trim(),
                    model: modelDraft.trim(),
                  });
                  setNotice('AI 设置已保存');
                  setOpen(false);
                }}
                className="flex-1 rounded-xl bg-[#C75B3A] px-4 py-2.5 text-sm text-white"
              >
                保存
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function FeatureTogglesSetting(_props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  const [agentPageEnabled, setAgentPageEnabledState] = useSettingValue(
    () => getAgentPageEnabled(),
    subscribeAgentPageEnabledChanges,
  );
  const [desktopAdaptiveEnabled, setDesktopAdaptiveEnabledState] = useSettingValue(
    () => getDesktopAdaptiveEnabled(),
    subscribeDesktopAdaptiveChanges,
  );
  const [commandPaletteEnabled, setCommandPaletteEnabledState] = useSettingValue(
    () => getCommandPaletteEnabled(),
    subscribeCommandPaletteEnabledChanges,
  );

  return (
    <>
      <SettingsItemRow
        label="功能开关"
        onClick={() => setOpen(true)}
        control={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      />
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="dark:bg-[#1C1917]">
          <div className="px-5 pb-8 pt-2">
            <DrawerTitle className="text-center text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
              功能开关
            </DrawerTitle>
            <p className="mt-1 text-center text-xs text-[#A8A29E]">启用或关闭实验性功能</p>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3">
                <span className="text-sm text-[#1C1917]">桌面端适配</span>
                <Switch
                  data-testid="new-settings-desktop-adaptive-switch"
                  checked={desktopAdaptiveEnabled}
                  onCheckedChange={(checked) => {
                    setDesktopAdaptiveEnabledState(checked);
                    setDesktopAdaptiveEnabled(checked);
                  }}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3">
                <span className="text-sm text-[#1C1917]">网络页面</span>
                <Switch
                  data-testid="feature-toggle-agent-page-switch"
                  checked={agentPageEnabled}
                  onCheckedChange={(checked) => {
                    setAgentPageEnabledState(checked);
                    setAgentPageEnabled(checked);
                  }}
                />
              </div>
              <div
                className="flex items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3"
                data-testid="feature-toggle-command-palette-row"
              >
                <span className="text-sm text-[#1C1917]">命令面板</span>
                <Switch
                  data-testid="feature-toggle-command-palette-switch"
                  checked={commandPaletteEnabled}
                  onCheckedChange={(checked) => {
                    setCommandPaletteEnabledState(checked);
                    setCommandPaletteEnabled(checked);
                  }}
                />
              </div>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function readRuntimeInfo() {
  const runtimeBaseUrl = toRuntimeBaseUrl(getSelectedRuntimeTarget());
  let localHostId = 'local';
  let localAuthToken: string | undefined;

  try {
    const raw = window.localStorage.getItem(EMBEDDED_RUNTIME_STATUS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { hostId?: string; authSecret?: string };
      if (typeof parsed.hostId === 'string') {
        localHostId = parsed.hostId;
      }
      if (typeof parsed.authSecret === 'string') {
        localAuthToken = parsed.authSecret;
      }
    }
  } catch {
    // Ignore malformed runtime status cache.
  }

  return {
    runtimeBaseUrl,
    localHostId,
    localAuthToken,
  };
}

export function DevicePairingSetting(_props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  const runtimeInfo = readRuntimeInfo();

  return (
    <>
      <SettingsItemRow
        label="设备配对"
        onClick={() => setOpen(true)}
        control={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      />
      <PeerPairingDialog
        open={open}
        onOpenChange={setOpen}
        runtimeBaseUrl={runtimeInfo.runtimeBaseUrl}
        localHostId={runtimeInfo.localHostId}
        localAuthToken={runtimeInfo.localAuthToken}
      />
    </>
  );
}

export function TaskBackendStatusSetting(_props: { ctx: SettingsContext }) {
  const [status, setStatus] = useState<{
    backend: string;
    supportsJsonBackup: boolean;
    supportsSqliteSnapshot: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const result = getTaskBackupService().getBackendStatus();

    if (isPromiseLike<{
      backend: string;
      supportsJsonBackup: boolean;
      supportsSqliteSnapshot: boolean;
    }>(result)) {
      void result
        .then((nextStatus) => {
          if (!cancelled) {
            setStatus(nextStatus);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setStatus(null);
          }
        });
    } else if (!cancelled) {
      setStatus(result);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) {
    return null;
  }

  const backupLabel = status.supportsJsonBackup && status.supportsSqliteSnapshot
    ? 'JSON / SQLite'
    : status.supportsJsonBackup
      ? 'JSON'
      : status.supportsSqliteSnapshot
        ? 'SQLite'
        : '不可用';

  return (
    <div className="px-4 py-[14px]">
      <p className="text-sm text-[#1C1917]">任务后端：{status.backend}</p>
      <p className="mt-1 text-xs text-[#A8A29E]">任务备份：{backupLabel}</p>
    </div>
  );
}

export function TaskImportActionSetting(_props: { ctx: SettingsContext }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <SettingsItemRow
        label="导入任务数据"
        onClick={() => {
          setNotice(null);
          setError(null);
          inputRef.current?.click();
        }}
        control={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      />
      <input
        ref={inputRef}
        data-testid="new-settings-task-import-input"
        type="file"
        accept=".json,.sqlite,.db"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) {
            return;
          }

          setNotice(null);
          setError(null);

          try {
            const message = await importTasksFromFile(file, 'merge');
            setNotice(message);
          } catch (nextError) {
            const message = nextError instanceof Error ? nextError.message : '未知错误';
            setError(`任务导入失败：${message}`);
          } finally {
            event.target.value = '';
          }
        }}
      />
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
    </div>
  );
}

function VoiceTestActionRow({
  label,
  target,
}: {
  label: string;
  target: '/moss-test' | '/volcano-asr-test';
}) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <SettingsItemRow
        label={label}
        onClick={() => {
          setError(null);
          if (!getDeveloperModeEnabled()) {
            setError('请先开启开发者模式后使用语音测试');
            return;
          }
          navigate({ to: target });
        }}
        control={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      />
      <NoticeBlock message={error} tone="error" />
    </div>
  );
}

export function MossVoiceTestSetting(_props: { ctx: SettingsContext }) {
  return <VoiceTestActionRow label="MOSS 语音测试" target="/moss-test" />;
}

export function VolcanoVoiceTestSetting(_props: { ctx: SettingsContext }) {
  return <VoiceTestActionRow label="火山引擎 ASR 测试" target="/volcano-asr-test" />;
}
