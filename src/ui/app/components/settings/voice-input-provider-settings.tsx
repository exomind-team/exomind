import { useEffect, useState } from 'react';
import {
  getVoiceShortcutAsrProvider,
  getVoiceShortcutAsrProviderLabel,
  subscribeVoiceShortcutAsrProviderChanges,
} from '@/config/voice-shortcut-asr-provider';
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
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';

type VoiceInputProviderSettingsProps = {
  ctx?: SettingsContext;
};

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

export function VoiceInputProviderSettings({ ctx: _ctx }: VoiceInputProviderSettingsProps = {}) {
  const provider = useSubscribedValue(getVoiceShortcutAsrProvider, subscribeVoiceShortcutAsrProviderChanges);
  const volcanoAppKey = useSubscribedValue(getVolcanoAppKey, subscribeVolcanoAppKeyChanges);
  const volcanoAccessKey = useSubscribedValue(getVolcanoAccessKey, subscribeVolcanoAccessKeyChanges);
  const volcanoResourceId = useSubscribedValue(getVolcanoResourceIdSetting, subscribeVolcanoResourceIdChanges);
  const volcanoEndpoint = useSubscribedValue(getVolcanoEndpointSetting, subscribeVolcanoEndpointChanges);
  const volcanoLanguage = useSubscribedValue(getVolcanoLanguageSetting, subscribeVolcanoLanguageChanges);

  const currentProviderLabel = getVoiceShortcutAsrProviderLabel(provider);
  const volcanoConfigured = Boolean(volcanoAppKey.trim() && volcanoAccessKey.trim());

  return (
    <SettingsSection title="快捷语音输入" testId="voice-input-provider-settings-section">
      <div className="space-y-4 px-4 py-4">
        <div className="rounded-2xl border border-[#F0ECE8] bg-[#FAF7F5] px-4 py-4 dark:border-[#292524] dark:bg-[#120F0E]">
          <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
            Provider / 服务提供方：{currentProviderLabel}
          </p>
          <p className="mt-1 text-xs leading-5 text-[#78716C] dark:text-[#A8A29E]">
            快捷语音输入使用火山引擎 ASR。请确认凭据、资源包和语言参数是否完整。
          </p>
        </div>

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
              : '诊断：缺少 AppKey / AccessKey，需要先补齐火山引擎凭据。'}
          </p>
        </section>
      </div>
    </SettingsSection>
  );
}
