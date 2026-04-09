import { useEffect, useMemo, useState } from 'react';
import { Bot, Ear, Waves } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  getVoiceRuntimeEnabled,
  getVoiceRuntimeLabNavEnabled,
  getVoiceRuntimeProvider,
  setVoiceRuntimeEnabled,
  setVoiceRuntimeLabNavEnabled,
  setVoiceRuntimeProvider,
  subscribeVoiceRuntimeEnabledChanges,
  subscribeVoiceRuntimeLabNavEnabledChanges,
  subscribeVoiceRuntimeProviderChanges,
} from '@/config/voice-runtime-settings';
import {
  getVoiceRuntimeMode,
  setVoiceRuntimeMode,
  subscribeVoiceRuntimeModeChanges,
} from '@/config/voice-runtime-mode';
import { SettingsItemRow } from '@/ui/app/components/settings/settings-item-row';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';

// Provider（服务提供方）id，先做 UI 独立组件，不直接绑定 registry。
export type VoiceAssistantProviderId =
  | 'doubao-o2-realtime'
  | 'qwen-omni-compatible'
  | 'qwen-omni-realtime';

// Mode（模式）只覆盖本次需求的两种常驻语音助手交互方式。
export type VoiceAssistantMode = 'push-to-talk' | 'ambient';

export type VoiceAssistantProviderSettingsValue = {
  enabled: boolean;
  mode: VoiceAssistantMode;
  provider: VoiceAssistantProviderId;
};

type VoiceAssistantProviderSettingsProps = {
  ctx?: SettingsContext;
  value?: Partial<VoiceAssistantProviderSettingsValue>;
  defaultValue?: Partial<VoiceAssistantProviderSettingsValue>;
  onChange?: (value: VoiceAssistantProviderSettingsValue) => void;
};

type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  description: string;
};

const DEFAULT_VALUE: VoiceAssistantProviderSettingsValue = {
  enabled: false,
  mode: 'push-to-talk',
  provider: 'doubao-o2-realtime',
};

const MODE_OPTIONS: ChoiceOption<VoiceAssistantMode>[] = [
  {
    value: 'push-to-talk',
    label: '按键说话',
    description: '按住快捷键时采集语音，适合明确开始/结束的对话。',
  },
  {
    value: 'ambient',
    label: '环境监听',
    description: '环境持续监听麦克风，适合免按键对话。',
  },
];

const PROVIDER_OPTIONS: ChoiceOption<VoiceAssistantProviderId>[] = [
  {
    value: 'doubao-o2-realtime',
    label: 'Doubao',
    description: '正式实时链路，优先适配按键说话与环境监听。',
  },
  {
    value: 'qwen-omni-compatible',
    label: 'Omni Compatible',
    description: '兼容接口链路，适合按键说话场景。',
  },
  {
    value: 'qwen-omni-realtime',
    label: 'Omni Realtime',
    description: '实验性实时链路，适合后续 Realtime 能力接入。',
  },
];

function useSubscribedValue<T>(
  getValue: () => T,
  subscribe: (listener: (value: T) => void) => () => void,
): T {
  const [value, setValue] = useState<T>(() => getValue());

  useEffect(() => {
    return subscribe(setValue);
  }, [subscribe]);

  return value;
}

function normalizeValue(
  value?: Partial<VoiceAssistantProviderSettingsValue>,
): VoiceAssistantProviderSettingsValue {
  return {
    ...DEFAULT_VALUE,
    ...value,
  };
}

function isUnsupportedCombination(
  value: VoiceAssistantProviderSettingsValue,
): boolean {
  return value.provider === 'qwen-omni-compatible' && value.mode === 'ambient';
}

function ChoiceCard<T extends string>({
  option,
  selected,
  groupLabel,
  onSelect,
}: {
  option: ChoiceOption<T>;
  selected: boolean;
  groupLabel: string;
  onSelect: (value: T) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-label={option.label}
      aria-checked={selected}
      data-group-label={groupLabel}
      onClick={() => onSelect(option.value)}
      className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
        selected
          ? 'border-[#C75B3A] bg-[#FEF0ED] dark:border-[#E8734E] dark:bg-[#2A1510]'
          : 'border-[#F0ECE8] bg-white dark:border-[#292524] dark:bg-[#1C1917]'
      }`}
    >
      <span className="block text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
        {option.label}
      </span>
      <span className="mt-1 block text-xs text-[#78716C] dark:text-[#A8A29E]">
        {option.description}
      </span>
    </button>
  );
}

export function VoiceAssistantProviderSettings({
  ctx,
  value: _value,
  defaultValue: _defaultValue,
  onChange,
}: VoiceAssistantProviderSettingsProps) {
  const enabled = useSubscribedValue(getVoiceRuntimeEnabled, subscribeVoiceRuntimeEnabledChanges);
  const mode = useSubscribedValue(getVoiceRuntimeMode, subscribeVoiceRuntimeModeChanges) as VoiceAssistantMode;
  const provider = useSubscribedValue(
    getVoiceRuntimeProvider,
    subscribeVoiceRuntimeProviderChanges,
  ) as VoiceAssistantProviderId;
  const labNavEnabled = useSubscribedValue(
    getVoiceRuntimeLabNavEnabled,
    subscribeVoiceRuntimeLabNavEnabledChanges,
  );
  const currentValue = normalizeValue({
    enabled,
    mode,
    provider,
  });
  const currentProviderOption = useMemo(
    () => PROVIDER_OPTIONS.find((option) => option.value === currentValue.provider) ?? PROVIDER_OPTIONS[0],
    [currentValue.provider],
  );
  const unsupportedCombination = isUnsupportedCombination(currentValue);
  const developerMode = Boolean(ctx?.developerMode);

  const updateValue = (patch: Partial<VoiceAssistantProviderSettingsValue>) => {
    const nextValue = {
      ...currentValue,
      ...patch,
    };
    if (typeof patch.enabled === 'boolean') {
      setVoiceRuntimeEnabled(patch.enabled);
    }
    if (typeof patch.mode === 'string') {
      setVoiceRuntimeMode(patch.mode);
    }
    if (typeof patch.provider === 'string') {
      setVoiceRuntimeProvider(patch.provider);
    }
    onChange?.(nextValue);
  };

  const currentModeDescription =
    MODE_OPTIONS.find((option) => option.value === currentValue.mode)?.description ?? '';

  return (
    <SettingsSection
      title="常驻语音助手"
      testId="voice-assistant-provider-settings-section"
    >
      <SettingsItemRow
        testId="voice-assistant-provider-settings-enabled-row"
        label="启用常驻语音助手"
        description="控制常驻语音助手总开关；会直接写入运行时配置。"
        control={(
          <Switch
            aria-label="启用常驻语音助手"
            checked={currentValue.enabled}
            onCheckedChange={(checked: boolean) => updateValue({ enabled: checked })}
            data-testid="voice-assistant-provider-settings-enabled-switch"
          />
        )}
      />

      <div className="border-t border-[#F0ECE8] px-4 py-4 dark:border-[#292524]">
        <div className="flex items-center gap-2 text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
          <Ear className="h-4 w-4 text-[#78716C]" />
          <span>对话模式</span>
        </div>
        <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
          先定义常驻助手如何开始收音，再选择 Provider。
        </p>
        <div
          role="radiogroup"
          aria-label="常驻语音助手模式"
          className="mt-3 grid gap-2"
        >
          {MODE_OPTIONS.map((option) => (
            <ChoiceCard
              key={option.value}
              option={option}
              selected={currentValue.mode === option.value}
              groupLabel="voice-assistant-mode"
              onSelect={(nextMode) => updateValue({ mode: nextMode })}
            />
          ))}
        </div>
        <p
          data-testid="voice-assistant-provider-settings-mode-summary"
          className="mt-3 text-xs text-[#57534E] dark:text-[#D6D3D1]"
        >
          {currentModeDescription}
        </p>
      </div>

      <div className="border-t border-[#F0ECE8] px-4 py-4 dark:border-[#292524]">
        <div className="flex items-center gap-2 text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
          <Bot className="h-4 w-4 text-[#78716C]" />
          <span>Provider</span>
          <span className="text-xs text-[#A8A29E]">服务提供方</span>
        </div>
        <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
          先选择当前要使用的对话链路，再补齐该 provider 对应的配置。
        </p>
        <div
          role="radiogroup"
          aria-label="常驻语音助手 Provider"
          className="mt-3 grid gap-2"
        >
          {PROVIDER_OPTIONS.map((option) => (
            <ChoiceCard
              key={option.value}
              option={option}
              selected={currentValue.provider === option.value}
              groupLabel="voice-assistant-provider"
              onSelect={(nextProvider) => updateValue({ provider: nextProvider })}
            />
          ))}
        </div>

        {unsupportedCombination ? (
          <div
            role="alert"
            className="mt-3 rounded-2xl border border-[#F5C2B8] bg-[#FFF4F1] px-4 py-3 text-sm text-[#9A3412] dark:border-[#7C2D12] dark:bg-[#2A1510] dark:text-[#FDBA74]"
          >
            <div className="flex items-center gap-2 font-medium">
              <Waves className="h-4 w-4" />
              <span>当前组合暂不支持</span>
            </div>
            <p className="mt-1 text-xs leading-5">
              Omni Compatible 当前只支持按键说话，不支持环境监听。
            </p>
          </div>
        ) : null}
      </div>

      {developerMode ? (
        <>
          <div
            data-testid={`voice-assistant-provider-settings-advanced-${currentValue.provider}`}
            className="border-t border-[#F0ECE8] px-4 py-4 dark:border-[#292524]"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
              <Bot className="h-4 w-4 text-[#78716C]" />
              <span>{currentProviderOption.label} 高级与诊断</span>
            </div>
            <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
              诊断入口跟随当前 provider，避免不同链路的调试入口混在一起。
            </p>
          </div>
          <SettingsItemRow
            testId="voice-assistant-provider-settings-lab-nav-row"
            label="显示语音诊断入口"
            description={`控制 ${currentProviderOption.label} 当前链路的诊断入口显示。`}
            control={(
              <Switch
                aria-label="显示语音诊断入口"
                checked={labNavEnabled}
                onCheckedChange={(checked: boolean) => setVoiceRuntimeLabNavEnabled(checked)}
                data-testid="voice-assistant-provider-settings-lab-nav-switch"
              />
            )}
          />
          <SettingsItemRow
            testId="voice-assistant-provider-settings-open-lab-row"
            label="打开语音诊断页"
            description={`进入 ${currentProviderOption.label} 当前链路的诊断与事件观察页。`}
            control={(
              <button
                type="button"
                data-testid="voice-assistant-provider-settings-open-lab-button"
                onClick={() => {
                  window.location.pathname = '/voice-runtime';
                }}
                className="rounded-full border border-[#E7E5E4] px-3 py-1.5 text-xs dark:border-[#292524]"
              >
                打开
              </button>
            )}
          />
        </>
      ) : null}
    </SettingsSection>
  );
}
