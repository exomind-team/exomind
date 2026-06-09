import { useEffect, useMemo, useState } from 'react';
import {
  getVoiceShortcutAsrProvider,
  getVoiceShortcutAsrProviderLabel,
  setVoiceShortcutAsrProvider,
  subscribeVoiceShortcutAsrProviderChanges,
} from '@/config/voice-shortcut-asr-provider';
import {
  getVoiceOmniModelId,
  getVoiceOmniOptimizeEnabled,
  getVoiceOmniProfileId,
  subscribeVoiceOmniModelIdChanges,
  subscribeVoiceOmniOptimizeEnabledChanges,
  subscribeVoiceOmniProfileIdChanges,
} from '@/config/voice-omni-settings';
import {
  getVolcanoAccessKey,
  getVolcanoAppKey,
  getVolcanoEndpointSetting,
  getVolcanoLanguageSetting,
  getVolcanoResourceIdSetting,
  subscribeVolcanoAccessKeyChanges,
  subscribeVolcanoAppKeyChanges,
  subscribeVolcanoEndpointChanges,
  subscribeVolcanoLanguageChanges,
  subscribeVolcanoResourceIdChanges,
} from '@/config/volcano-asr-settings';
import { listProviderProfiles, resolveProviderProfile } from '@/lib/agent-provider/provider-profile-storage';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';

type VoiceInputProviderId = 'moss' | 'volcano' | 'qwen-omni';

type VoiceInputProviderSettingsProps = {
  ctx?: SettingsContext;
};

const ALL_PROVIDER_OPTIONS: VoiceInputProviderId[] = ['moss', 'volcano', 'qwen-omni'];

const SIMPLE_PROVIDER_OPTIONS: VoiceInputProviderId[] = ['moss', 'volcano'];

function useSubscribedValue<T>(
  getValue: () => T,
  subscribe: (listener: (value: T) => void) => () => void,
): T {
  const [value, setValue] = useState(getValue);

  useEffect(() => subscribe(setValue), [subscribe]);

  return value;
}

function formatPresence(value: string): string {
  return value.trim() ? '已配置' : '未配置';
}

function ProviderToggleButton({
  providerId,
  active,
  onSelect,
}: {
  providerId: VoiceInputProviderId;
  active: boolean;
  onSelect: (providerId: VoiceInputProviderId) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(providerId)}
      className={`rounded-full border px-3 py-2 text-sm transition-colors ${
        active
          ? 'border-[#C75B3A] bg-[#FEF0ED] text-[#8A3412] dark:border-[#E8734E] dark:bg-[#2A1510] dark:text-[#FBD2C5]'
          : 'border-[#E7E5E4] bg-white text-[#57534E] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#D6D3D1]'
      }`}
    >
      {getVoiceShortcutAsrProviderLabel(providerId)}
    </button>
  );
}

function DiagnosticRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm dark:border-[#292524] dark:bg-[#1C1917]">
      <span className="text-[#78716C] dark:text-[#A8A29E]">{label}</span>
      <span className="min-w-0 text-right text-[#1C1917] dark:text-[#FAFAF9]">{value}</span>
    </div>
  );
}

export function VoiceInputProviderSettings({ ctx }: VoiceInputProviderSettingsProps = {}) {
  const provider = useSubscribedValue(getVoiceShortcutAsrProvider, subscribeVoiceShortcutAsrProviderChanges);
  const developerMode = Boolean(ctx?.developerMode);

  const providerOptions = developerMode ? ALL_PROVIDER_OPTIONS : SIMPLE_PROVIDER_OPTIONS;

  useEffect(() => {
    if (!developerMode && provider === 'qwen-omni') {
      setVoiceShortcutAsrProvider('moss');
    }
  }, [developerMode, provider]);
  const volcanoAppKey = useSubscribedValue(getVolcanoAppKey, subscribeVolcanoAppKeyChanges);
  const volcanoAccessKey = useSubscribedValue(getVolcanoAccessKey, subscribeVolcanoAccessKeyChanges);
  const volcanoResourceId = useSubscribedValue(getVolcanoResourceIdSetting, subscribeVolcanoResourceIdChanges);
  const volcanoEndpoint = useSubscribedValue(getVolcanoEndpointSetting, subscribeVolcanoEndpointChanges);
  const volcanoLanguage = useSubscribedValue(getVolcanoLanguageSetting, subscribeVolcanoLanguageChanges);
  const qwenProfileId = useSubscribedValue(getVoiceOmniProfileId, subscribeVoiceOmniProfileIdChanges);
  const qwenModelId = useSubscribedValue(getVoiceOmniModelId, subscribeVoiceOmniModelIdChanges);
  const qwenOptimizeEnabled = useSubscribedValue(
    getVoiceOmniOptimizeEnabled,
    subscribeVoiceOmniOptimizeEnabledChanges,
  );

  const qwenProfile = useMemo(
    () => (qwenProfileId ? resolveProviderProfile(qwenProfileId) : null),
    [qwenProfileId],
  );
  const qwenProfileCount = useMemo(
    () => listProviderProfiles().filter((profile) => profile.provider === 'openai').length,
    [qwenProfileId],
  );

  const currentProviderLabel = getVoiceShortcutAsrProviderLabel(provider);
  const volcanoConfigured = Boolean(volcanoAppKey.trim() && volcanoAccessKey.trim());
  const qwenConfigured = Boolean(qwenProfileId.trim() && qwenProfile);

  const handleSelectProvider = (providerId: VoiceInputProviderId) => {
    const nextProvider = setVoiceShortcutAsrProvider(providerId);
    if (nextProvider !== providerId) {
      return;
    }
  };

  return (
    <SettingsSection title="快捷语音输入" testId="voice-input-provider-settings-section">
      <div className="space-y-4 px-4 py-4">
        <div className="rounded-2xl border border-[#F0ECE8] bg-[#FAF7F5] px-4 py-4 dark:border-[#292524] dark:bg-[#120F0E]">
          <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
            Provider / 服务提供方：{currentProviderLabel}
          </p>
          <p className="mt-1 text-xs leading-5 text-[#78716C] dark:text-[#A8A29E]">
            这个设置块只负责“快捷语音输入”入口的 provider 驱动展示。即使 registry / 注册表还没接好，也能独立渲染当前 provider 对应的配置区。
          </p>
        </div>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="快捷语音输入 provider 切换">
          {providerOptions.map((providerId) => (
            <ProviderToggleButton
              key={providerId}
              providerId={providerId}
              active={provider === providerId}
              onSelect={handleSelectProvider}
            />
          ))}
        </div>

        {provider === 'moss' ? (
          <section
            data-testid="voice-input-provider-panel-moss"
            className="space-y-3 rounded-2xl border border-[#F0ECE8] bg-[#FCFBFA] px-4 py-4 dark:border-[#292524] dark:bg-[#120F0E]"
          >
            <div>
              <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">MOSS 本地识别配置区</h3>
              <p className="mt-1 text-xs leading-5 text-[#78716C] dark:text-[#A8A29E]">
                本地默认链路，无需额外云端 Key，适合先验证快捷语音输入是否打通。
              </p>
            </div>
            <DiagnosticRow label="识别链路 / Runtime" value="Local-first / 本地优先" />
            <DiagnosticRow label="说明 / Notes" value="默认作为兜底 provider，切换成本最低。" />
            <p className="text-xs text-[#8A3412] dark:text-[#FBD2C5]">
              诊断：如果快捷键已触发但没有文字回填，优先检查麦克风权限、主窗口聚焦状态和本地录音链路。
            </p>
          </section>
        ) : null}

        {provider === 'volcano' ? (
          <section
            data-testid="voice-input-provider-panel-volcano"
            className="space-y-3 rounded-2xl border border-[#F0ECE8] bg-[#FCFBFA] px-4 py-4 dark:border-[#292524] dark:bg-[#120F0E]"
          >
            <div>
              <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">火山 ASR 配置区</h3>
              <p className="mt-1 text-xs leading-5 text-[#78716C] dark:text-[#A8A29E]">
                面向火山引擎实时/异步识别配置，重点确认凭据、资源包和语言参数是否完整。
              </p>
            </div>
            <DiagnosticRow label="App Key / 应用密钥" value={formatPresence(volcanoAppKey)} />
            <DiagnosticRow label="Access Key / 访问密钥" value={formatPresence(volcanoAccessKey)} />
            <DiagnosticRow label="Resource ID / 资源包" value={volcanoResourceId || '未配置'} />
            <DiagnosticRow label="Endpoint / 接入端点" value={volcanoEndpoint || '未配置'} />
            <DiagnosticRow label="Language / 语言" value={volcanoLanguage || '未配置'} />
            <p className={`text-xs ${volcanoConfigured ? 'text-[#166534] dark:text-[#86EFAC]' : 'text-[#8A3412] dark:text-[#FBD2C5]'}`}>
              {volcanoConfigured
                ? '诊断：火山凭据已就绪，下一步重点验证 Resource ID 与语言参数是否匹配当前识别场景。'
                : '诊断：缺少 AppKey / AccessKey，切到火山前需要先补齐火山引擎凭据。'}
            </p>
          </section>
        ) : null}

        {provider === 'qwen-omni' ? (
          <section
            data-testid="voice-input-provider-panel-qwen-omni"
            className="space-y-3 rounded-2xl border border-[#F0ECE8] bg-[#FCFBFA] px-4 py-4 dark:border-[#292524] dark:bg-[#120F0E]"
          >
            <div>
              <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">Qwen Omni 配置区</h3>
              <p className="mt-1 text-xs leading-5 text-[#78716C] dark:text-[#A8A29E]">
                这里关注 provider profile / 供应商档案、模型与文本优化开关；即使 AI Registry 还没接线，也要明确当前缺口。
              </p>
            </div>
            <DiagnosticRow
              label="Provider Profile / 供应商档案"
              value={qwenProfile ? qwenProfile.name : '未绑定'}
            />
            <DiagnosticRow label="Model / 模型" value={qwenModelId || '未配置'} />
            <DiagnosticRow label="Text Optimize / 文本优化" value={qwenOptimizeEnabled ? '已开启' : '未开启'} />
            <DiagnosticRow label="Available Profiles / 可用档案数" value={String(qwenProfileCount)} />
            <p className={`text-xs ${qwenConfigured ? 'text-[#166534] dark:text-[#86EFAC]' : 'text-[#8A3412] dark:text-[#FBD2C5]'}`}>
              {qwenConfigured
                ? '诊断：Qwen Omni 已绑定兼容档案，联调时重点验证模型与优化开关是否符合当前输入链路。'
                : '诊断：还没绑定 provider profile，建议先在 AI Registry 配 DashScope 兼容档案。'}
            </p>
          </section>
        ) : null}
      </div>
    </SettingsSection>
  );
}
