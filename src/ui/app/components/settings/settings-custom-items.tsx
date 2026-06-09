import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Bell, Bot, Check, ChevronRight, Code, Download, Eye, EyeOff, Key, Mic, Music4, Play, Timer, Upload, Wifi, X } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { getEventLogBackupService, getTaskBackupService, getTimeBlockBackupService } from '@/lib/services';
import { exportBackup, importBackupFromContent } from '@/services/impl/settings-data-service';
import {
  getEventlogBackendMode,
  getTaskBackendMode,
  getTimeblockBackendMode,
} from '@/config/domain-backend-mode';
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
import {
  getVolcanoAccessKey,
  getVolcanoAppKey,
  setVolcanoAccessKey,
  setVolcanoAppKey,
  subscribeVolcanoAccessKeyChanges,
  subscribeVolcanoAppKeyChanges,
} from '@/config/volcano-asr-settings';
import {
  DEFAULT_VOLCANO_PACKAGE_HOURS,
  getVolcanoUsageStats,
  getVolcanoUsageSummary,
  setVolcanoPackageHours,
  subscribeVolcanoUsageStatsChanges,
} from '@/config/volcano-usage-stats';
import { importTasksFromFile } from '@/services/impl/settings-data-service';
import {
  getSelectedRuntimeTarget,
  isTauriWindow,
  readEmbeddedRuntimeStatus,
  toRuntimeBaseUrl,
} from '@/config/runtime-target';
import {
  getDevInstanceDiagnosticsSnapshot,
  type DevInstanceEnvStatus,
} from '@/config/dev-instance-diagnostics';
import { loadTauriRuntimeInstanceDiagnostics } from '@/lib/dev-instance-runtime';
import {
  getVoiceOmniProfileId,
  setVoiceOmniProfileId,
  subscribeVoiceOmniProfileIdChanges,
} from '@/config/voice-omni-settings';
import {
  getVoiceOmniPromptDocs,
  resetVoiceOmniPromptDocs,
  setVoiceOmniPromptDocs,
  subscribeVoiceOmniPromptDocsChanges,
} from '@/config/voice-omni-prompts';
import {
  DEFAULT_QWEN_OMNI_PROMPT_DOCS,
  type VoiceOmniPromptDocs,
} from '@/lib/voice/qwen-omni-prompts';
import {
  listProviderProfiles,
  resolveProviderProfile,
} from '@/lib/agent-provider/provider-profile-storage';
import { runActionOnPrimaryModifierEnter } from '@/ui/app/components/dialog-submit-shortcuts';

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
      <span className="shrink-0 text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">{label}</span>
      <span className="exomind-selectable min-w-0 flex-1 break-all text-right text-sm text-[#1C1917] dark:text-[#FAFAF9]">{value}</span>
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

function isDefaultQwenOmniPromptDocs(docs: VoiceOmniPromptDocs): boolean {
  return JSON.stringify(docs) === JSON.stringify(DEFAULT_QWEN_OMNI_PROMPT_DOCS);
}

function normalizePromptTextareaValue(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export function QwenOmniProfileSetting(_props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useSettingValue(
    () => getVoiceOmniProfileId(),
    subscribeVoiceOmniProfileIdChanges,
  );
  const [profiles, setProfiles] = useState(() =>
    listProviderProfiles().filter((profile) => profile.provider === 'openai'),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setProfiles(listProviderProfiles().filter((profile) => profile.provider === 'openai'));
  }, [open]);

  const selectedProfile = profileId ? resolveProviderProfile(profileId) : null;
  const summary = selectedProfile?.name ?? '未选择';

  return (
    <div>
      <SettingRow
        testId="new-settings-voice-omni-profile-row"
        icon={<Key className="h-[18px] w-[18px] text-[#78716C]" />}
        label="Qwen Omni 供应商档案"
        onClick={() => {
          setError(null);
          setNotice(null);
          setOpen(true);
        }}
        right={<SecondaryValue value={summary} />}
      />
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Qwen Omni 供应商档案</DialogTitle>
            <DialogDescription>
              选择一个已在 AI Registry 中配置好 Base URL 与 API Key 的 OpenAI-compatible 档案。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {profiles.length === 0 ? (
              <div className="rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] px-4 py-3 text-sm text-[#57534E] dark:border-[#FFFFFF15] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
                还没有可用的 OpenAI-compatible 档案。请先到 AI Registry 添加 DashScope / 兼容档案。
              </div>
            ) : (
              profiles.map((profile) => {
                const selected = profile.profileId === profileId;
                return (
                  <button
                    key={profile.profileId}
                    type="button"
                    data-testid={`new-settings-voice-omni-profile-option-${profile.profileId}`}
                    onClick={() => {
                      const nextValue = setVoiceOmniProfileId(profile.profileId);
                      setProfileId(nextValue);
                      setNotice(`Qwen Omni 供应商档案已切换为 ${profile.name}`);
                      setError(null);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                      selected
                        ? 'border-[#C75B3A] bg-[#FEF0ED] text-[#1C1917] dark:border-[#E8734E] dark:bg-[#2A1510] dark:text-[#FAFAF9]'
                        : 'border-[#F0ECE8] bg-white text-[#1C1917] dark:border-[#FFFFFF15] dark:bg-[#1C1917] dark:text-[#FAFAF9]'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{profile.name}</span>
                      <span className="mt-1 block text-xs text-[#78716C] dark:text-[#A8A29E]">
                        {profile.baseUrl || '未配置 Base URL'} · {profile.model}
                      </span>
                    </span>
                    {selected ? <Check className="h-4 w-4 text-[#C75B3A]" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function QwenOmniPromptDocsSetting(_props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useSettingValue(
    () => getVoiceOmniPromptDocs(),
    subscribeVoiceOmniPromptDocsChanges,
  );
  const [draft, setDraft] = useState<VoiceOmniPromptDocs>(docs);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(docs);
    }
  }, [docs, open]);

  const summary = isDefaultQwenOmniPromptDocs(docs) ? '使用默认文档' : '已自定义';

  const handleDraftChange = (field: keyof VoiceOmniPromptDocs) => (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = normalizePromptTextareaValue(event.target.value);
    setDraft((current) => ({
      ...current,
      [field]: nextValue,
    }));
  };

  const handleSavePromptDocs = () => {
    try {
      const nextDocs = setVoiceOmniPromptDocs(draft);
      setDocs(nextDocs);
      setDraft(nextDocs);
      setNotice('Qwen Omni 提示词已保存');
      setError(null);
      setOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  return (
    <div>
      <SettingRow
        testId="new-settings-voice-omni-prompts-row"
        icon={<Code className="h-[18px] w-[18px] text-[#78716C]" />}
        label="Qwen Omni 提示词"
        onClick={() => {
          setDraft(docs);
          setError(null);
          setNotice(null);
          setOpen(true);
        }}
        right={<SecondaryValue value={summary} />}
      />
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Qwen Omni 提示词文档</DialogTitle>
            <DialogDescription>
              管理 agent / rules / vocabulary / textOptimize 四份文档。默认使用 byetype 风格文档。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {([
              ['agent', 'Agent 文档'],
              ['rules', 'Rules 文档'],
              ['vocabulary', 'Vocabulary 文档'],
              ['textOptimize', 'Text Optimize 文档'],
            ] as Array<[keyof VoiceOmniPromptDocs, string]>).map(([field, label]) => (
              <label key={field} className="block space-y-2">
                <span className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{label}</span>
                <textarea
                  data-testid={`new-settings-voice-omni-prompts-${field}`}
                  value={draft[field]}
                  onChange={handleDraftChange(field)}
                  onKeyDown={(event) => {
                    runActionOnPrimaryModifierEnter(event, handleSavePromptDocs);
                  }}
                  className="min-h-[120px] w-full rounded-xl border border-[#F0ECE8] bg-white px-3 py-2 text-sm text-[#1C1917] focus:border-[#C75B3A] focus:outline-none focus:ring-1 focus:ring-[#C75B3A] dark:border-[#FFFFFF15] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
                />
              </label>
            ))}
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <div className="flex gap-2">
              <button
                type="button"
                className="settings-dialog-secondary-button flex-1"
                onClick={() => setOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                data-testid="new-settings-voice-omni-prompts-reset"
                className="settings-dialog-secondary-button flex-1"
                onClick={() => {
                  const nextDocs = resetVoiceOmniPromptDocs();
                  setDocs(nextDocs);
                  setDraft(nextDocs);
                  setNotice('Qwen Omni 提示词已恢复为 byetype 默认文档');
                  setError(null);
                }}
              >
                恢复默认
              </button>
              <button
                type="button"
                data-testid="new-settings-voice-omni-prompts-save"
                className="settings-dialog-primary-button flex-1"
                onClick={handleSavePromptDocs}
              >
                保存
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
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
                <div key={preset.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelect(preset.id)}
                    className="flex flex-1 items-center justify-between rounded-xl border border-[#F0ECE8] px-4 py-3 text-left text-sm dark:border-[#292524]"
                  >
                    <span>{preset.label}</span>
                    {selected ? <Check className="h-4 w-4 text-[#C75B3A]" /> : null}
                  </button>
                  <button
                    type="button"
                    aria-label={`试听 ${preset.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const audio = new Audio(preset.url);
                      audio.play().catch(() => {});
                    }}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#F0ECE8] text-[#78716C] transition-colors hover:bg-[#F5F0ED] hover:text-[#1C1917] dark:border-[#292524] dark:hover:bg-[#292524] dark:hover:text-[#FAFAF9]"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                </div>
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
  const localHostId = readEmbeddedRuntimeStatus()?.hostId ?? 'local';

  return {
    runtimeBaseUrl,
    localHostId,
    localAuthToken: undefined,
  };
}

export function DevicePairingSetting(_props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  // Legacy developer entry（旧开发者入口）: keep pairing reachable from settings,
  // but product primary flow now lives in Network -> Device.
  const runtimeInfo = readRuntimeInfo();

  return (
    <>
      <SettingRow
        icon={<Wifi className="h-[18px] w-[18px] text-[#78716C]" />}
        label="高级设备配对"
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
      <DiagnosticsValue label="Desktop OS" value={String(diagnostics.isDesktopOS)} />
      <DiagnosticsValue label="Tauri" value={String(diagnostics.isTauri)} />
      <DiagnosticsValue label="Hardware Keyboard" value={`${diagnostics.hasHardwareKeyboard} (${diagnostics.keyboardType})`} />

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
          <DialogContent className="flex max-h-[calc(100vh-32px)] min-h-0 max-w-2xl flex-col overflow-hidden rounded-2xl">
            <DialogHeader>
              <DialogTitle>实例诊断信息</DialogTitle>
              <DialogDescription>查看当前开发实例的标题辨认与环境诊断信息</DialogDescription>
            </DialogHeader>
            <div
              data-testid="settings-instance-diagnostics-scroll-region"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
            >
              {detailContent}
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="flex max-h-[85vh] min-h-0 flex-col dark:bg-[#1C1917]">
            <DrawerHeader className="pb-0 text-center">
              <DrawerTitle className="text-center text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                实例诊断信息
              </DrawerTitle>
              <DrawerDescription className="text-xs text-[#A8A29E]">
                查看当前开发实例的标题辨认与环境诊断信息
              </DrawerDescription>
            </DrawerHeader>
            <div
              data-testid="settings-instance-diagnostics-scroll-region"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-2"
            >
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
  requiresDeveloperMode = true,
  blockedLabel = '需开发者模式',
  readyLabel = '可用',
  blockedMessage = '请先开启开发者模式后使用语音测试',
}: {
  label: string;
  target: '/moss-test' | '/volcano-asr-test';
  icon: ReactNode;
  requiresDeveloperMode?: boolean;
  blockedLabel?: string;
  readyLabel?: string;
  blockedMessage?: string;
}) {
  const navigate = useNavigate();
  const [developerMode] = useSettingValue(
    () => getDeveloperModeEnabled(),
    subscribeDeveloperModeChanges,
  );
  const [error, setError] = useState<string | null>(null);
  const statusLabel = !requiresDeveloperMode || developerMode ? readyLabel : blockedLabel;

  return (
    <div>
      <SettingRow
        icon={icon}
        label={label}
        onClick={() => {
          setError(null);
          if (requiresDeveloperMode && !getDeveloperModeEnabled()) {
            setError(blockedMessage);
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
  return (
    <VoiceTestActionRow
      label="火山引擎 ASR 测试"
      target="/volcano-asr-test"
      icon={<Mic className="h-[18px] w-[18px] text-[#78716C]" />}
      requiresDeveloperMode={false}
      readyLabel="进入"
    />
  );
}

function formatVolcanoEngineKeySummary(appKey: string, accessKey: string): string {
  const hasAppKey = appKey.trim().length > 0;
  const hasAccessKey = accessKey.trim().length > 0;
  if (hasAppKey && hasAccessKey) {
    return '已配置';
  }
  if (hasAppKey || hasAccessKey) {
    return '部分配置';
  }
  return '未配置';
}

function formatHoursFromSeconds(seconds: number): string {
  return `${(seconds / 3600).toFixed(2)}h`;
}

function formatEstimatedDays(days: number | null): string {
  if (days == null || !Number.isFinite(days)) {
    return '暂无估算';
  }
  return `${days.toFixed(1)} 天`;
}

function VolcanoUsageSummaryPanel() {
  const [stats, setStats] = useSettingValue(
    () => getVolcanoUsageStats(),
    subscribeVolcanoUsageStatsChanges,
  );
  const [packageHoursDraft, setPackageHoursDraft] = useState(() => String(getVolcanoUsageStats().packageHours));
  const summary = getVolcanoUsageSummary(stats);

  useEffect(() => {
    setPackageHoursDraft(String(stats.packageHours));
  }, [stats.packageHours]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        <DiagnosticsValue label="资源包总时长" value={`${stats.packageHours}h`} />
        <DiagnosticsValue label="本地累计识别" value={formatHoursFromSeconds(summary.totalUsedSeconds)} />
        <DiagnosticsValue label="今日识别时长" value={formatHoursFromSeconds(summary.todayUsedSeconds)} />
        <DiagnosticsValue label="本地剩余估算" value={formatHoursFromSeconds(summary.remainingSeconds)} />
        <DiagnosticsValue label="已用占比" value={`${(summary.usedRatio * 100).toFixed(1)}%`} />
        <DiagnosticsValue label="近 7 日累计" value={formatHoursFromSeconds(summary.last7DaysUsedSeconds)} />
        <DiagnosticsValue label="预计剩余可用" value={formatEstimatedDays(summary.estimatedRemainingDays)} />
      </div>

      <div className="space-y-2 rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] px-4 py-3 text-xs text-[#57534E] dark:border-[#FFFFFF15] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
        <p>本地统计仅覆盖当前设备、当前应用内成功完成的火山语音识别。</p>
        <p>资源包总时长可按你已购买的套餐手动填写，面板会基于本地累计识别时长推导剩余估算。</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">资源包总时长（小时）</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            step={1}
            value={packageHoursDraft}
            onChange={(event) => setPackageHoursDraft(event.target.value)}
            className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
          />
          <button
            type="button"
            onClick={() => setStats(setVolcanoPackageHours(Number.parseInt(packageHoursDraft || '0', 10) || DEFAULT_VOLCANO_PACKAGE_HOURS))}
            className="shrink-0 rounded-xl bg-[#1C1917] px-4 py-3 text-sm text-white transition-colors hover:bg-[#292524] dark:bg-[#FAFAF9] dark:text-[#1C1917]"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export function VolcanoUsageSummarySetting(props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  const [stats] = useSettingValue(
    () => getVolcanoUsageStats(),
    subscribeVolcanoUsageStatsChanges,
  );
  const summary = getVolcanoUsageSummary(stats);
  const shouldUseDialog = props.ctx.isDesktop || Boolean(props.ctx.isLandscape);
  const detail = <VolcanoUsageSummaryPanel />;

  return (
    <>
      <SettingRow
        icon={<Mic className="h-[18px] w-[18px] text-[#78716C]" />}
        label="火山用量概览"
        onClick={() => setOpen(true)}
        right={<SecondaryValue value={`已用 ${formatHoursFromSeconds(summary.totalUsedSeconds)} / ${stats.packageHours}h`} />}
      />
      {shouldUseDialog ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="flex max-h-[calc(100vh-32px)] min-h-0 flex-col overflow-hidden rounded-2xl">
            <DialogHeader>
              <DialogTitle>火山用量概览</DialogTitle>
              <DialogDescription>查看当前设备内的火山语音识别累计时长与剩余估算</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              {detail}
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="flex max-h-[85vh] min-h-0 flex-col dark:bg-[#1C1917]">
            <DrawerHeader className="pb-0 text-center">
              <DrawerTitle className="text-center text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                火山用量概览
              </DrawerTitle>
              <DrawerDescription className="text-xs text-[#A8A29E]">
                查看当前设备内的火山语音识别累计时长与剩余估算
              </DrawerDescription>
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-2">
              {detail}
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}


function VolcanoEngineKeyPanel({
  appKey,
  accessKey,
  setAppKey,
  setAccessKey,
  appKeyVisible,
  accessKeyVisible,
  setAppKeyVisible,
  setAccessKeyVisible,
  notice,
  error,
  saving,
  onSave,
}: {
  appKey: string;
  accessKey: string;
  setAppKey: (value: string) => void;
  setAccessKey: (value: string) => void;
  appKeyVisible: boolean;
  accessKeyVisible: boolean;
  setAppKeyVisible: (value: boolean) => void;
  setAccessKeyVisible: (value: boolean) => void;
  notice: string | null;
  error: string | null;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-4">
      <NoticeBlock message={notice} tone="success" />
      <NoticeBlock message={error} tone="error" />
      <div className="space-y-4">
        <label className="block space-y-2">
          <span className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">AppKey</span>
          <div className="relative">
            <input
              data-testid="new-settings-volcano-engine-app-key-input"
              aria-label="AppKey"
              type={appKeyVisible ? 'text' : 'password'}
              value={appKey}
              onChange={(event) => setAppKey(event.target.value)}
              placeholder="输入火山 AppKey"
              className="h-11 w-full rounded-xl border border-[#E7E5E4] bg-white px-4 pr-28 text-sm text-[#1C1917] outline-none transition-colors placeholder:text-[#A8A29E] focus:border-[#C75B3A] dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
            />
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1">
              <button
                type="button"
                data-testid="new-settings-volcano-engine-app-key-clear"
                aria-label="清空 AppKey"
                onClick={() => setAppKey('')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#DC2626] transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C] dark:hover:bg-[#3F1D1D]"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-testid="new-settings-volcano-engine-app-key-visibility"
                onClick={() => setAppKeyVisible(!appKeyVisible)}
                aria-label={appKeyVisible ? '隐藏 AppKey' : '显示 AppKey'}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#78716C] transition-colors hover:bg-[#F5F0ED] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:bg-[#292524] dark:hover:text-[#FAFAF9]"
              >
                {appKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">AccessKey</span>
          <div className="relative">
            <input
              data-testid="new-settings-volcano-engine-access-key-input"
              aria-label="AccessKey"
              type={accessKeyVisible ? 'text' : 'password'}
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              placeholder="输入火山 AccessKey"
              className="h-11 w-full rounded-xl border border-[#E7E5E4] bg-white px-4 pr-28 text-sm text-[#1C1917] outline-none transition-colors placeholder:text-[#A8A29E] focus:border-[#C75B3A] dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
            />
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1">
              <button
                type="button"
                data-testid="new-settings-volcano-engine-access-key-clear"
                aria-label="清空 AccessKey"
                onClick={() => setAccessKey('')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#DC2626] transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C] dark:hover:bg-[#3F1D1D]"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-testid="new-settings-volcano-engine-access-key-visibility"
                onClick={() => setAccessKeyVisible(!accessKeyVisible)}
                aria-label={accessKeyVisible ? '隐藏 AccessKey' : '显示 AccessKey'}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#78716C] transition-colors hover:bg-[#F5F0ED] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:bg-[#292524] dark:hover:text-[#FAFAF9]"
              >
                {accessKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </label>

        <div className="flex justify-end">
          <button
            type="button"
            data-testid="new-settings-volcano-engine-key-save"
            onClick={onSave}
            disabled={saving}
            className="rounded-xl bg-[#1C1917] px-4 py-2 text-sm text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#FAFAF9] dark:text-[#1C1917]"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function VolcanoEngineKeySetting(props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  const [appKeyValue, setAppKeyValue] = useSettingValue(
    () => getVolcanoAppKey(),
    subscribeVolcanoAppKeyChanges,
  );
  const [accessKeyValue, setAccessKeyValue] = useSettingValue(
    () => getVolcanoAccessKey(),
    subscribeVolcanoAccessKeyChanges,
  );
  const [draftAppKey, setDraftAppKey] = useState('');
  const [draftAccessKey, setDraftAccessKey] = useState('');
  const [appKeyVisible, setAppKeyVisible] = useState(false);
  const [accessKeyVisible, setAccessKeyVisible] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shouldUseDialog = props.ctx.isDesktop || Boolean(props.ctx.isLandscape);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraftAppKey(appKeyValue);
    setDraftAccessKey(accessKeyValue);
    setAppKeyVisible(false);
    setAccessKeyVisible(false);
    setNotice(null);
    setError(null);
  }, [open, appKeyValue, accessKeyValue]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setAppKeyVisible(false);
      setAccessKeyVisible(false);
      setNotice(null);
      setError(null);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const nextAppKeyRaw = setVolcanoAppKey(draftAppKey);
      const nextAccessKeyRaw = setVolcanoAccessKey(draftAccessKey);
      const nextAppKey = isPromiseLike<string>(nextAppKeyRaw) ? await nextAppKeyRaw : (nextAppKeyRaw ?? draftAppKey);
      const nextAccessKey = isPromiseLike<string>(nextAccessKeyRaw) ? await nextAccessKeyRaw : (nextAccessKeyRaw ?? draftAccessKey);
      setAppKeyValue(nextAppKey);
      setAccessKeyValue(nextAccessKey);
      setDraftAppKey(nextAppKey);
      setDraftAccessKey(nextAccessKey);
      setNotice('火山引擎 Key 已保存');
      setOpen(false);
    } catch (nextError) {
      setNotice(null);
      setError(nextError instanceof Error ? nextError.message : '保存火山引擎 Key 失败');
    } finally {
      setSaving(false);
    }
  };

  const panel = (
    <VolcanoEngineKeyPanel
      appKey={draftAppKey}
      accessKey={draftAccessKey}
      setAppKey={setDraftAppKey}
      setAccessKey={setDraftAccessKey}
      appKeyVisible={appKeyVisible}
      accessKeyVisible={accessKeyVisible}
      setAppKeyVisible={setAppKeyVisible}
      setAccessKeyVisible={setAccessKeyVisible}
      notice={notice}
      error={error}
      saving={saving}
      onSave={() => {
        void handleSave();
      }}
    />
  );

  return (
    <>
      <SettingRow
        testId="new-settings-volcano-engine-key-row"
        icon={<Key className="h-[18px] w-[18px] text-[#78716C]" />}
        label="火山引擎 Key"
        onClick={() => setOpen(true)}
        right={<SecondaryValue value={formatVolcanoEngineKeySummary(appKeyValue, accessKeyValue)} />}
      />
      {shouldUseDialog ? (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent className="rounded-2xl">
            <DialogHeader>
              <DialogTitle>火山引擎 Key</DialogTitle>
              <DialogDescription>配置火山语音识别 AppKey 与 AccessKey（仅保存在当前设备）</DialogDescription>
            </DialogHeader>
            {panel}
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer open={open} onOpenChange={handleOpenChange}>
          <DrawerContent className="dark:bg-[#1C1917]">
            <DrawerHeader className="pb-0 text-center">
              <DrawerTitle className="text-center text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                火山引擎 Key
              </DrawerTitle>
              <DrawerDescription className="text-xs text-[#A8A29E]">
                配置火山语音识别 AppKey 与 AccessKey（仅保存在当前设备）
              </DrawerDescription>
            </DrawerHeader>
            <div className="px-5 pb-8 pt-2">
              {panel}
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}

type DataTransferDomain = 'all' | 'eventlog' | 'task' | 'timeblock';
type DataTransferFormat = 'json' | 'sqlite';

const DATA_TRANSFER_DOMAIN_OPTIONS: Array<{ value: DataTransferDomain; label: string; description: string }> = [
  { value: 'all', label: '全部数据', description: '将事件日志、任务与时间块一起打包到单个文件。' },
  { value: 'eventlog', label: '事件日志', description: '导入或导出语音输入、随手记录与事件流。' },
  { value: 'task', label: '任务', description: '导入或导出任务与其 RT SQLite 快照。' },
  { value: 'timeblock', label: '时间块', description: '导入或导出时间块与当前进行中时间块快照。' },
];

const DATA_TRANSFER_FORMAT_OPTIONS: Array<{ value: DataTransferFormat; label: string; description: string }> = [
  { value: 'json', label: 'JSON', description: '可读、可审查、适合外部备份交换。' },
  { value: 'sqlite', label: 'SQLite', description: '保留本地域快照，适合完整迁移或恢复。' },
];

function downloadFileFallback(content: BlobPart, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function DataTransferChoiceList<T extends string>({
  options,
  currentValue,
  onSelect,
}: {
  options: Array<{ value: T; label: string; description: string }>;
  currentValue: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((option) => {
        const selected = currentValue === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(option.value)}
            className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
              selected
                ? 'border-[#1C1917] bg-[#F5F0ED] dark:border-[#FAFAF9] dark:bg-[#292524]'
                : 'border-[#E7E5E4] bg-white dark:border-[#44403C] dark:bg-[#1C1917]'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{option.label}</span>
              {selected && <Check className="h-4 w-4 text-[#1C1917] dark:text-[#FAFAF9]" />}
            </div>
            <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{option.description}</p>
          </button>
        );
      })}
    </div>
  );
}

export function DataTransferSetting(_props: { ctx: SettingsContext }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [domain, setDomain] = useState<DataTransferDomain>('eventlog');
  const [format, setFormat] = useState<DataTransferFormat>('json');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [eventlogBackendStatus, setEventlogBackendStatus] = useState<{
    backend: string; supportsJsonBackup: boolean; supportsSqliteSnapshot: boolean;
  } | null>(null);
  const [taskBackendStatus, setTaskBackendStatus] = useState<{
    backend: string; supportsJsonBackup: boolean; supportsSqliteSnapshot: boolean;
  } | null>(null);
  const [timeblockBackendStatus, setTimeblockBackendStatus] = useState<{
    backend: string; supportsJsonBackup: boolean; supportsSqliteSnapshot: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    type BackendStatus = { backend: string; supportsJsonBackup: boolean; supportsSqliteSnapshot: boolean };
    const loadStatus = async (
      getStatus: () => BackendStatus | Promise<BackendStatus>,
      setter: (s: BackendStatus) => void,
    ) => {
      try {
        const result = getStatus();
        const status = isPromiseLike(result) ? await result : result;
        if (!cancelled) setter(status);
      } catch { /* ignore */ }
    };
    void loadStatus(() => getEventLogBackupService().getBackendStatus(), setEventlogBackendStatus);
    void loadStatus(() => getTaskBackupService().getBackendStatus(), setTaskBackendStatus);
    void loadStatus(() => getTimeBlockBackupService().getBackendStatus(), setTimeblockBackendStatus);
    return () => { cancelled = true; };
  }, []);

  const clearNotice = () => { setStatusMessage(''); setErrorMessage(''); };

  const eventlogBackendMode = getEventlogBackendMode();
  const taskBackendMode = getTaskBackendMode();
  const timeblockBackendMode = getTimeblockBackendMode();

  const selectedDomainBackendMode = domain === 'all' ? null
    : domain === 'eventlog' ? eventlogBackendMode
    : domain === 'task' ? taskBackendMode
    : timeblockBackendMode;
  const selectedDomainStatus = domain === 'all' ? null
    : domain === 'eventlog' ? eventlogBackendStatus
    : domain === 'task' ? taskBackendStatus
    : timeblockBackendStatus;
  const isRuntimeUnsupported = !isTauriWindow();
  const isLegacyMode = selectedDomainBackendMode === 'legacy';
  const isAllSqliteUnsupported = domain === 'all' && format === 'sqlite';
  const isDisabled = isRuntimeUnsupported || isLegacyMode || isAllSqliteUnsupported || (
    domain !== 'all' && selectedDomainStatus
      ? (format === 'json' ? selectedDomainStatus.supportsJsonBackup === false : selectedDomainStatus.supportsSqliteSnapshot === false)
      : false
  );
  const dataImportAccept = format === 'json' ? '.json' : '.sqlite,.db';

  const executeExport = async () => {
    if (domain === 'all') {
      if (format !== 'json') throw new Error('全部数据当前仅支持 JSON 打包导入导出。');
      setStatusMessage(await exportBackup());
      return;
    }

    const domainMeta = {
      eventlog: { label: '事件日志', countUnit: '条事件' },
      task: { label: '任务', countUnit: '条任务' },
      timeblock: { label: '时间块', countUnit: '条记录' },
    } as const;
    const { label: domainLabel, countUnit } = domainMeta[domain];

    const saveAndNotify = async (
      content: string | Uint8Array,
      fileName: string,
      count: number,
      formatLabel: 'JSON' | 'SQLite',
    ) => {
      const isRunningInTauri = await isTauri();
      if (isRunningInTauri) {
        const savedPath = typeof content === 'string'
          ? await invoke<string | null>('save_json_file', { content, defaultName: fileName })
          : await invoke<string | null>('save_binary_file', { content: Array.from(content), defaultName: fileName, filters: ['sqlite', 'db'] });
        if (!savedPath) { setStatusMessage('已取消保存。'); return; }
        setStatusMessage(`${domainLabel}导出成功（${formatLabel}），共 ${count} ${countUnit}。保存路径：${savedPath}`);
        return;
      }
      const mimeType = typeof content === 'string' ? 'application/json;charset=utf-8' : 'application/octet-stream';
      downloadFileFallback(content, mimeType, fileName);
      setStatusMessage(`${domainLabel}导出成功（${formatLabel}），共 ${count} ${countUnit}。`);
    };

    if (format === 'json') {
      if (domain === 'eventlog') {
        const r = await getEventLogBackupService().exportEventsAsJson();
        await saveAndNotify(r.content, r.fileName, r.eventCount, 'JSON');
      } else if (domain === 'task') {
        const r = await getTaskBackupService().exportTasksAsJson();
        await saveAndNotify(r.content, r.fileName, r.taskCount, 'JSON');
      } else {
        const r = await getTimeBlockBackupService().exportTimeBlocksAsJson();
        await saveAndNotify(r.content, r.fileName, r.timeBlockCount, 'JSON');
      }
      return;
    }

    if (domain === 'eventlog') {
      const r = await getEventLogBackupService().exportEventsAsSqliteSnapshot();
      await saveAndNotify(r.bytes, r.fileName, r.eventCount, 'SQLite');
    } else if (domain === 'task') {
      const r = await getTaskBackupService().exportTasksAsSqliteSnapshot();
      await saveAndNotify(r.bytes, r.fileName, r.taskCount, 'SQLite');
    } else {
      const r = await getTimeBlockBackupService().exportTimeBlocksAsSqliteSnapshot();
      await saveAndNotify(r.bytes, r.fileName, r.timeBlockCount, 'SQLite');
    }
  };

  const executeImport = async (file: File) => {
    if (domain === 'all') {
      if (format !== 'json') throw new Error('全部数据当前仅支持 JSON 打包导入导出。');
      const content = await file.text();
      setStatusMessage(await importBackupFromContent(content, file.name, 'merge'));
      return;
    }

    if (format === 'json') {
      const content = await file.text();
      if (domain === 'eventlog') {
        const r = await getEventLogBackupService().importEventsFromJson(content, 'merge');
        setStatusMessage(`事件日志导入成功：新增 ${r.imported} 条，跳过 ${r.skipped} 条，当前共 ${r.total} 条。`);
      } else if (domain === 'timeblock') {
        const r = await getTimeBlockBackupService().importTimeBlocksFromJson(content, 'merge');
        setStatusMessage(`时间块导入成功：新增 ${r.imported} 条，跳过 ${r.skipped} 条，当前共 ${r.total} 条。`);
      } else {
        const r = await getTaskBackupService().importTasksFromJson(content, 'merge');
        setStatusMessage(`任务导入成功：新增 ${r.imported} 条，跳过 ${r.skipped} 条，当前共 ${r.total} 条。`);
      }
      return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (domain === 'eventlog') {
      const r = await getEventLogBackupService().importEventsFromSqliteSnapshot(bytes, 'merge');
      setStatusMessage(`事件日志导入成功：新增 ${r.imported} 条，跳过 ${r.skipped} 条，当前共 ${r.total} 条。`);
    } else if (domain === 'timeblock') {
      const r = await getTimeBlockBackupService().importTimeBlocksFromSqliteSnapshot(bytes, 'merge');
      setStatusMessage(`时间块导入成功：新增 ${r.imported} 条，跳过 ${r.skipped} 条，当前共 ${r.total} 条。`);
    } else {
      const r = await getTaskBackupService().importTasksFromSqliteSnapshot(bytes, 'merge');
      setStatusMessage(`任务导入成功：新增 ${r.imported} 条，跳过 ${r.skipped} 条，当前共 ${r.total} 条。`);
    }
  };

  const handleConfirmExport = async () => {
    clearNotice();
    setExportDialogOpen(false);
    setLoading(true);
    try { await executeExport(); }
    catch (error) { setErrorMessage(`导出失败：${error instanceof Error ? error.message : '未知错误'}`); }
    finally { setLoading(false); }
  };

  const handleConfirmImport = () => {
    clearNotice();
    setImportDialogOpen(false);
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try { await executeImport(file); }
    catch (error) { setErrorMessage(`导入失败：${error instanceof Error ? error.message : '未知错误'}`); }
    finally { e.target.value = ''; setLoading(false); }
  };

  const selectedDomainLabel = DATA_TRANSFER_DOMAIN_OPTIONS.find((o) => o.value === domain)?.label ?? '未选择';
  const selectedFormatLabel = DATA_TRANSFER_FORMAT_OPTIONS.find((o) => o.value === format)?.label ?? '未选择';

  const renderDisabledHint = () => {
    if (isRuntimeUnsupported) return <p className="mt-1 text-[#B91C1C] dark:text-[#FCA5A5]">当前环境不支持统一导入导出，请在桌面端使用。</p>;
    if (isLegacyMode) return <p className="mt-1 text-[#B91C1C] dark:text-[#FCA5A5]">legacy 后端暂不支持统一导入导出，请先切换到 rt-sqlite。</p>;
    if (isAllSqliteUnsupported) return <p className="mt-1 text-[#B91C1C] dark:text-[#FCA5A5]">全部数据当前仅支持 JSON 打包导入导出。</p>;
    if (isDisabled) return <p className="mt-1 text-[#B91C1C] dark:text-[#FCA5A5]">当前后端不支持所选格式，请切换格式或后端。</p>;
    return null;
  };

  return (
    <div>
      <input ref={fileInputRef} type="file" accept={dataImportAccept} className="hidden" onChange={handleFileInputChange} data-testid="new-settings-data-import-input" />

      <SettingRow
        icon={<Download className="h-[18px] w-[18px] text-[#78716C]" />}
        label="导出数据"
        onClick={() => { clearNotice(); setDomain('eventlog'); setFormat('json'); setExportDialogOpen(true); }}
        right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      />
      <SettingRow
        icon={<Upload className="h-[18px] w-[18px] text-[#78716C]" />}
        label="导入数据"
        onClick={() => { clearNotice(); setDomain('eventlog'); setFormat('json'); setImportDialogOpen(true); }}
        right={<ChevronRight className="h-4 w-4 text-[#A8A29E]" />}
      />

      {statusMessage && <NoticeBlock message={statusMessage} tone="success" />}
      {errorMessage && <NoticeBlock message={errorMessage} tone="error" />}

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>导出数据</DialogTitle>
            <DialogDescription>按域选择导出范围，再选择导出格式。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">范围</p>
              <DataTransferChoiceList options={DATA_TRANSFER_DOMAIN_OPTIONS} currentValue={domain} onSelect={setDomain} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">格式</p>
              <DataTransferChoiceList options={DATA_TRANSFER_FORMAT_OPTIONS} currentValue={format} onSelect={setFormat} />
            </div>
            <div className="rounded-2xl bg-[#F5F0ED] px-4 py-3 text-xs text-[#57534E] dark:bg-[#292524] dark:text-[#D6D3D1]">
              <p>当前选择：{selectedDomainLabel} / {selectedFormatLabel}</p>
              {renderDisabledHint()}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setExportDialogOpen(false)} className="flex-1 rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]">取消</button>
              <button type="button" onClick={() => void handleConfirmExport()} disabled={loading || isDisabled} className="flex-1 rounded-xl bg-[#C75B3A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#B5502F] disabled:cursor-not-allowed disabled:bg-[#D6D3D1] disabled:text-[#78716C]">开始导出</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>导入数据</DialogTitle>
            <DialogDescription>按域选择导入范围，再选择要导入的文件格式。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">范围</p>
              <DataTransferChoiceList options={DATA_TRANSFER_DOMAIN_OPTIONS} currentValue={domain} onSelect={setDomain} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">格式</p>
              <DataTransferChoiceList options={DATA_TRANSFER_FORMAT_OPTIONS} currentValue={format} onSelect={setFormat} />
            </div>
            <div className="rounded-2xl bg-[#F5F0ED] px-4 py-3 text-xs text-[#57534E] dark:bg-[#292524] dark:text-[#D6D3D1]">
              <p>当前选择：{selectedDomainLabel} / {selectedFormatLabel}</p>
              <p className="mt-1">导入策略：merge（合并）</p>
              {renderDisabledHint()}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setImportDialogOpen(false)} className="flex-1 rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]">取消</button>
              <button type="button" onClick={handleConfirmImport} disabled={loading || isDisabled} className="flex-1 rounded-xl bg-[#C75B3A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#B5502F] disabled:cursor-not-allowed disabled:bg-[#D6D3D1] disabled:text-[#78716C]">选择文件并导入</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
