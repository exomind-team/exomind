import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Bell, Bot, Check, ChevronRight, Code, Key, Mic, Music4, Timer, Upload, Wifi } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { getTaskBackupService } from '@/lib/services';
import { SettingRow } from '@/ui/app/components/settings-shared';
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
  getFocusBgmPreferences,
  subscribeFocusBgmPreferencesChanges,
  updateFocusBgmPreferences,
  type FocusBgmPlaybackMode,
  type FocusBgmStopBehavior,
  type FocusBgmSourceType,
} from '@/config/focus-bgm-preferences';
import {
  FOCUS_BGM_PRESETS,
  getFocusBgmPresetById,
  type FocusBgmPresetId,
} from '@/lib/media/focus-bgm-presets';
import { pickFocusBgmTracks } from '@/lib/media/focus-bgm-file-picker';
import {
  getLLMApiKey,
  getLLMBaseUrl,
  getLLMModel,
  setLLMApiKey,
  setLLMBaseUrl,
  setLLMModel,
  subscribeLLMSettingsChanges,
} from '@/config/llm-settings';
import { getDeveloperModeEnabled, subscribeDeveloperModeChanges } from '@/config/developer-mode';
import { importTasksFromFile } from '@/services/impl/settings-data-service';
import {
  EMBEDDED_RUNTIME_STATUS_STORAGE_KEY,
  getSelectedRuntimeTarget,
  toRuntimeBaseUrl,
} from '@/config/runtime-target';
import {
  getDevInstanceDiagnosticsSnapshot,
  type DevInstanceEnvStatus,
} from '@/config/dev-instance-diagnostics';
import { loadTauriRuntimeInstanceDiagnostics } from '@/lib/dev-instance-runtime';

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

function DiagnosticsValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] px-4 py-3 dark:border-[#FFFFFF15] dark:bg-[#1C1917]">
      <span className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">{label}</span>
      <span className="text-right text-sm text-[#1C1917] dark:text-[#FAFAF9]">{value}</span>
    </div>
  );
}

function renderEnvStatusText(status: DevInstanceEnvStatus): string {
  if (!status.configured) {
    return '未配置';
  }

  if (status.sensitive) {
    return '已配置';
  }

  return status.value?.trim() || '已配置';
}

function FocusBgmChoiceButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
        selected
          ? 'border-[#C75B3A] bg-[#FEF0ED] text-[#1C1917] dark:border-[#E8734E] dark:bg-[#2A1510] dark:text-[#FAFAF9]'
          : 'border-[#F0ECE8] bg-white text-[#1C1917] dark:border-[#FFFFFF15] dark:bg-[#1C1917] dark:text-[#FAFAF9]'
      }`}
    >
      <span>{label}</span>
      {selected ? <Check className="h-4 w-4 text-[#C75B3A]" /> : null}
    </button>
  );
}

function hasFocusBgmSourceSelection(sourceType: FocusBgmSourceType, trackCount: number): boolean {
  return sourceType === 'preset' || trackCount > 0;
}

function formatFocusBgmSummary(preferences: ReturnType<typeof getFocusBgmPreferences>): string {
  if (!preferences.enabled) {
    return '已关闭';
  }

  const modeLabel = preferences.playbackMode === 'loop' ? '循环' : '顺序';
  if (preferences.sourceType === 'preset') {
    return `${getFocusBgmPresetById(preferences.presetId).label} · ${modeLabel}`;
  }

  if (preferences.customTracks.length > 0) {
    return `${preferences.customTracks.length} 首本地音频 · ${modeLabel}`;
  }

  return `未选择本地音频 · ${modeLabel}`;
}

export function FocusBgmPanel(_props: { ctx: SettingsContext }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useSettingValue(
    () => getFocusBgmPreferences(),
    subscribeFocusBgmPreferencesChanges,
  );

  const applyPatch = (patch: Partial<typeof preferences>) => {
    const next = {
      ...preferences,
      ...updateFocusBgmPreferences(patch),
    };
    setPreferences(next);
    setError(null);
    return next;
  };

  const handleToggleEnabled = (enabled: boolean) => {
    applyPatch({ enabled });
  };

  const handleSelectSource = (sourceType: FocusBgmSourceType) => {
    applyPatch({ sourceType });
  };

  const handleSelectPreset = (presetId: FocusBgmPresetId) => {
    applyPatch({ sourceType: 'preset', presetId, enabled: true });
  };

  const handleSelectPlaybackMode = (playbackMode: FocusBgmPlaybackMode) => {
    applyPatch({ playbackMode });
  };

  const handleSelectStopBehavior = (stopBehavior: FocusBgmStopBehavior) => {
    applyPatch({ stopBehavior });
  };

  const handleSelectLocalTracks = async () => {
    try {
      const tracks = await pickFocusBgmTracks();
      if (tracks.length === 0) {
        setNotice('未选择新的本地音频');
        setError(null);
        return;
      }

      applyPatch({
        enabled: true,
        sourceType: 'custom',
        customTracks: tracks,
      });
      setNotice(`已选择 ${tracks.length} 首本地音频`);
    } catch (selectionError) {
      setNotice(null);
      setError(selectionError instanceof Error ? selectionError.message : '选择本地音频失败');
    }
  };

  const handleClearLocalTracks = () => {
    applyPatch({ customTracks: [] });
    setNotice('已清空本地音频列表');
    setError(null);
  };

  return (
    <div className="space-y-4">
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium text-[#78716C]">播放开关</p>
          <div className="grid grid-cols-2 gap-2">
            <FocusBgmChoiceButton
              label="关闭背景音"
              selected={!preferences.enabled}
              onClick={() => handleToggleEnabled(false)}
            />
            <FocusBgmChoiceButton
              label="开启背景音"
              selected={preferences.enabled}
              onClick={() => handleToggleEnabled(true)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-[#78716C]">音源类型</p>
          <div className="grid grid-cols-2 gap-2">
            <FocusBgmChoiceButton
              label="预设白噪音"
              selected={preferences.sourceType === 'preset'}
              onClick={() => handleSelectSource('preset')}
            />
            <FocusBgmChoiceButton
              label="本地音频"
              selected={preferences.sourceType === 'custom'}
              onClick={() => handleSelectSource('custom')}
            />
          </div>
        </div>

        {preferences.sourceType === 'preset' ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#78716C]">预设选择</p>
            {FOCUS_BGM_PRESETS.map((preset) => (
              <FocusBgmChoiceButton
                key={preset.id}
                label={preset.label}
                selected={preferences.presetId === preset.id}
                onClick={() => handleSelectPreset(preset.id)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#78716C]">本地音频</p>
            <div className="grid grid-cols-2 gap-2">
              <FocusBgmChoiceButton
                label="选择本地音频"
                selected={preferences.customTracks.length > 0}
                onClick={() => {
                  void handleSelectLocalTracks();
                }}
              />
              <FocusBgmChoiceButton
                label="清空本地列表"
                selected={false}
                onClick={handleClearLocalTracks}
              />
            </div>
            <div className="rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] px-4 py-3 text-xs text-[#57534E] dark:border-[#FFFFFF15] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
              {preferences.customTracks.length > 0 ? (
                <ul className="space-y-1">
                  {preferences.customTracks.map((track) => (
                    <li key={track.path}>{track.name}</li>
                  ))}
                </ul>
              ) : (
                <span>当前未选择本地音频</span>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-[#78716C]">播放模式</p>
          <div className="grid grid-cols-2 gap-2">
            <FocusBgmChoiceButton
              label="循环播放"
              selected={preferences.playbackMode === 'loop'}
              onClick={() => handleSelectPlaybackMode('loop')}
            />
            <FocusBgmChoiceButton
              label="顺序播放"
              selected={preferences.playbackMode === 'sequence'}
              onClick={() => handleSelectPlaybackMode('sequence')}
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-[#78716C]">停止策略</p>
          <div className="grid grid-cols-2 gap-2">
            <FocusBgmChoiceButton
              label="时间到即停"
              selected={preferences.stopBehavior === 'timer-end'}
              onClick={() => handleSelectStopBehavior('timer-end')}
            />
            <FocusBgmChoiceButton
              label="手动结束才停"
              selected={preferences.stopBehavior === 'manual-end'}
              onClick={() => handleSelectStopBehavior('manual-end')}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-[#78716C]">
            <span>音量</span>
            <span>{preferences.volume}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={preferences.volume}
            onChange={(event) => applyPatch({ volume: Number(event.target.value) })}
            className="w-full accent-[#C75B3A]"
            aria-label="背景音音量（Background music volume）"
          />
        </div>

        {!hasFocusBgmSourceSelection(preferences.sourceType, preferences.customTracks.length) ? (
          <p className="text-xs text-[#A8A29E]">切换到本地音频后，请先选择至少一首音频文件。</p>
        ) : null}
      </div>
    </div>
  );
}

export function FocusBgmSetting(_props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  const [preferences] = useSettingValue(
    () => getFocusBgmPreferences(),
    subscribeFocusBgmPreferencesChanges,
  );

  return (
    <>
      <SettingRow
        icon={<Music4 className="h-[18px] w-[18px] text-[#78716C]" />}
        label="专注背景音"
        onClick={() => setOpen(true)}
        right={<SecondaryValue value={formatFocusBgmSummary(preferences)} />}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>专注背景音</DialogTitle>
            <DialogDescription>为专注过程配置白噪音或本地背景音乐</DialogDescription>
          </DialogHeader>
          <FocusBgmPanel ctx={_props.ctx} />
        </DialogContent>
      </Dialog>
    </>
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
      <SettingRow
        icon={<Timer className="h-[18px] w-[18px] text-[#78716C]" />}
        label="倒计时结束"
        onClick={() => setOpen(true)}
        right={<SecondaryValue value={currentLabel} />}
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
      <SettingRow
        icon={<Bell className="h-[18px] w-[18px] text-[#78716C]" />}
        label="提示音"
        onClick={() => setOpen(true)}
        right={<SecondaryValue value={currentLabel} />}
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
      <SettingRow
        icon={<Key className="h-[18px] w-[18px] text-[#78716C]" />}
        label="AI API Key"
        onClick={() => {
          setApiKeyDraft(getLLMApiKey());
          setBaseUrlDraft(getLLMBaseUrl());
          setModelDraft(getLLMModel());
          setOpen(true);
        }}
        right={<SecondaryValue value={settings.apiKey ? '已配置' : '未配置'} />}
      />
      <NoticeBlock message={notice} tone="success" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>AI 设置</DialogTitle>
            <DialogDescription>配置 Agent 对话使用的大语言模型（OpenAI 兼容格式）</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">API Key</label>
              <input
                type="password"
                value={apiKeyDraft}
                onChange={(event) => setApiKeyDraft(event.target.value)}
                placeholder="sk-..."
                className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">Base URL</label>
              <input
                type="url"
                value={baseUrlDraft}
                onChange={(event) => setBaseUrlDraft(event.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">模型</label>
              <input
                type="text"
                value={modelDraft}
                onChange={(event) => setModelDraft(event.target.value)}
                placeholder="gpt-4o"
                className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
              />
            </div>
            <p className="text-xs text-[#A8A29E]">支持 OpenAI、DeepSeek、Moonshot 等兼容 API</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]"
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
                className="flex-1 rounded-xl bg-[#C75B3A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#B5502F]"
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
      <SettingRow
        icon={<Wifi className="h-[18px] w-[18px] text-[#78716C]" />}
        label="设备配对"
        onClick={() => setOpen(true)}
        right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
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
      <p className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">任务后端：{status.backend}</p>
      <p className="mt-1 text-xs text-[#A8A29E]">任务备份：{backupLabel}</p>
    </div>
  );
}

export function DevInstanceDiagnosticsSetting(props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<{ pid: number | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const diagnostics = getDevInstanceDiagnosticsSnapshot(runtimeInfo ?? undefined);
  const shouldUseDialog = props.ctx.isDesktop || Boolean(props.ctx.isLandscape);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    void loadTauriRuntimeInstanceDiagnostics()
      .then((nextInfo) => {
        if (cancelled) {
          return;
        }
        setRuntimeInfo(nextInfo);
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setLoadError(error instanceof Error ? error.message : '加载实例诊断失败');
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const detailContent = (
    <div className="space-y-3">
      <DiagnosticsValue label="Branch" value={diagnostics.branch} />
      <DiagnosticsValue label="Web Port" value={String(diagnostics.webPort)} />
      <DiagnosticsValue label="RT Port" value={String(diagnostics.rtPort)} />
      <DiagnosticsValue label="MCP Port" value={String(diagnostics.mcpPort)} />
      <DiagnosticsValue label="Worktree" value={diagnostics.worktreeName} />
      <DiagnosticsValue label="PID" value={diagnostics.pid ? String(diagnostics.pid) : 'N/A'} />
      <DiagnosticsValue label="Sync URL" value={diagnostics.syncServerUrl} />
      <DiagnosticsValue label="ASR URL" value={diagnostics.asrServerUrl} />

      <div className="space-y-2 pt-2">
        <p className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">环境变量 / 配置状态</p>
        {Object.entries(diagnostics.envStatus).map(([key, status]) => (
          <DiagnosticsValue
            key={key}
            label={key}
            value={renderEnvStatusText(status)}
          />
        ))}
      </div>

      {loadError ? (
        <p className="text-xs text-red-600">{loadError}</p>
      ) : null}
    </div>
  );

  return (
    <>
      <SettingRow
        icon={<Code className="h-[18px] w-[18px] text-[#78716C]" />}
        label="实例诊断信息"
        onClick={() => setOpen(true)}
        right={<SecondaryValue value={`${diagnostics.branch} · Web:${diagnostics.webPort}`} />}
      />
      {shouldUseDialog ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl rounded-2xl">
            <DialogHeader>
              <DialogTitle>实例诊断信息</DialogTitle>
              <DialogDescription>查看当前开发实例的标题辨认与环境诊断信息</DialogDescription>
            </DialogHeader>
            {detailContent}
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="dark:bg-[#1C1917]">
            <DrawerHeader className="pb-0 text-center">
              <DrawerTitle className="text-center text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                实例诊断信息
              </DrawerTitle>
              <DrawerDescription className="text-xs text-[#A8A29E]">
                查看当前开发实例的标题辨认与环境诊断信息
              </DrawerDescription>
            </DrawerHeader>
            <div className="px-5 pb-8 pt-2">
              {detailContent}
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}

export function TaskImportActionSetting(_props: { ctx: SettingsContext }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <SettingRow
        icon={<Upload className="h-[18px] w-[18px] text-[#78716C]" />}
        label="导入任务数据"
        onClick={() => {
          setNotice(null);
          setError(null);
          inputRef.current?.click();
        }}
        right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
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
  icon,
}: {
  label: string;
  target: '/moss-test' | '/volcano-asr-test';
  icon: ReactNode;
}) {
  const navigate = useNavigate();
  const [developerMode] = useSettingValue(
    () => getDeveloperModeEnabled(),
    subscribeDeveloperModeChanges,
  );
  const [error, setError] = useState<string | null>(null);
  const statusLabel = developerMode ? '可用' : '需开发者模式';

  return (
    <div>
      <SettingRow
        icon={icon}
        label={label}
        onClick={() => {
          setError(null);
          if (!getDeveloperModeEnabled()) {
            setError('请先开启开发者模式后使用语音测试');
            return;
          }
          navigate({ to: target });
        }}
        right={<SecondaryValue value={statusLabel} />}
      />
      <NoticeBlock message={error} tone="error" />
    </div>
  );
}

export function MossVoiceTestSetting(_props: { ctx: SettingsContext }) {
  return <VoiceTestActionRow label="MOSS 语音测试" target="/moss-test" icon={<Bot className="h-[18px] w-[18px] text-[#78716C]" />} />;
}

export function VolcanoVoiceTestSetting(_props: { ctx: SettingsContext }) {
  return <VoiceTestActionRow label="火山引擎 ASR 测试" target="/volcano-asr-test" icon={<Mic className="h-[18px] w-[18px] text-[#78716C]" />} />;
}
