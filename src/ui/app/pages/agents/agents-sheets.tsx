import { ChevronRight, X } from 'lucide-react';
import type { RuntimeCreateAgentRequest } from '@/services/runtime-client';
import type { ApiProviderId, ProviderProfileMeta } from '@/lib/agent-provider/types';
import type { RuntimeHostSnapshot } from '@/services/runtime-manager';
import { DEFAULT_EXTERNAL_RUNTIME_PORT } from '@/config/runtime-target';
import { getAddOptionIcon, type AddNodeOption } from './agents-utils';

export function AddNodeSheet({
  options,
  onClose,
  onSelectAgent,
  onAddDevice,
}: {
  options: AddNodeOption[];
  onClose: () => void;
  onSelectAgent: (kind: RuntimeCreateAgentRequest['kind']) => void;
  onAddDevice: () => void;
}) {
  return (
    <>
      <button
        type="button"
        data-testid="agent-add-node-overlay"
        aria-label="关闭添加节点弹窗（Close Add Node Sheet）"
        className="absolute inset-0 bg-black/35"
        onClick={onClose}
      />
      <section
        data-testid="agent-add-node-sheet"
        className="absolute inset-x-0 bottom-0 z-10 rounded-t-[24px] bg-white pb-7 shadow-[0_-8px_28px_rgba(0,0,0,0.12)] dark:bg-[#1C1917] dark:shadow-[0_-8px_28px_rgba(0,0,0,0.45)]"
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded bg-[#D6D3D1] dark:bg-[#57534E]" />
        </div>
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="text-[18px] font-bold text-[#1C1917] dark:text-[#FAFAF9]">添加节点</h2>
          <button
            type="button"
            data-testid="agent-add-node-close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#A8A29E] dark:bg-[#292524] dark:text-[#78716C]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2 px-5">
          {options.map((option) => {
            const Icon = getAddOptionIcon(option.id);
            return (
              <button
                key={option.id}
                type="button"
                data-testid={`agent-add-node-option-${option.id}`}
                onClick={() => {
                  onClose();
                  if (option.id !== 'device') onSelectAgent(option.id);
                  if (option.id === 'device') onAddDevice();
                }}
                className="flex w-full items-center justify-between rounded-2xl bg-[#FAF7F5] px-4 py-3 text-left dark:bg-[#292524]"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${option.tintColor}20`, color: option.tintColor }}
                  >
                    <Icon size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{option.title}</p>
                    <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{option.description}</p>
                  </div>
                </div>
                <ChevronRight size={14} className="text-[#D6D3D1] dark:text-[#57534E]" />
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

export function AgentCreateSheet({
  kind,
  providerProfiles,
  selectedProviderProfileId,
  apiProfileName,
  apiProvider,
  apiModel,
  apiBaseUrl,
  apiKey,
  compatibleHosts,
  selectedHostId,
  createError,
  isCreating,
  onClose,
  onKindChange,
  onSelectProviderProfile,
  onApiProfileNameChange,
  onApiProviderChange,
  onApiModelChange,
  onApiBaseUrlChange,
  onApiKeyChange,
  onSelectHost,
  onCreate,
}: {
  kind: RuntimeCreateAgentRequest['kind'];
  providerProfiles: ProviderProfileMeta[];
  selectedProviderProfileId: string;
  apiProfileName: string;
  apiProvider: ApiProviderId;
  apiModel: string;
  apiBaseUrl: string;
  apiKey: string;
  compatibleHosts: RuntimeHostSnapshot[];
  selectedHostId: string;
  createError: string;
  isCreating: boolean;
  onClose: () => void;
  onKindChange: (kind: RuntimeCreateAgentRequest['kind']) => void;
  onSelectProviderProfile: (profileId: string) => void;
  onApiProfileNameChange: (value: string) => void;
  onApiProviderChange: (value: ApiProviderId) => void;
  onApiModelChange: (value: string) => void;
  onApiBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSelectHost: (hostId: string) => void;
  onCreate: () => void;
}) {
  const showApiFields = kind === 'api';
  const usingSavedProfile = showApiFields && selectedProviderProfileId.trim().length > 0;

  return (
    <>
      <button
        type="button"
        data-testid="agent-create-overlay"
        aria-label="关闭 Agent 创建弹窗（Close Agent Create Sheet）"
        className="absolute inset-0 z-20 bg-black/35"
        onClick={onClose}
      />
      <section
        data-testid="agent-create-sheet"
        className="absolute inset-x-0 bottom-0 z-30 rounded-t-[24px] bg-white pb-7 shadow-[0_-8px_28px_rgba(0,0,0,0.12)] dark:bg-[#1C1917] dark:shadow-[0_-8px_28px_rgba(0,0,0,0.45)]"
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded bg-[#D6D3D1] dark:bg-[#57534E]" />
        </div>
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="text-[18px] font-bold text-[#1C1917] dark:text-[#FAFAF9]">创建 Agent</h2>
          <button
            type="button"
            data-testid="agent-create-close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#A8A29E] dark:bg-[#292524] dark:text-[#78716C]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5">
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">Agent 类型</p>
            <div className="grid grid-cols-2 gap-2">
              {(['claude_cli', 'codex_cli', 'api', 'echo'] as RuntimeCreateAgentRequest['kind'][]).map((option) => (
                <button
                  key={option}
                  type="button"
                  data-testid={`agent-create-kind-${option}`}
                  onClick={() => onKindChange(option)}
                  className={`rounded-xl border px-3 py-2 text-left text-xs ${
                    kind === option
                      ? 'border-[#0D9488] bg-[#0D948810] text-[#0D9488]'
                      : 'border-[#E7E5E4] bg-[#FAF7F5] text-[#57534E] dark:border-[#292524] dark:bg-[#292524] dark:text-[#D6D3D1]'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {showApiFields && (
            <div className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-[#FAF7F5] p-3 dark:border-[#292524] dark:bg-[#292524]">
              <div className="space-y-1">
                <p className="text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">已保存 Provider Profiles</p>
                {providerProfiles.length > 0 ? (
                  <select
                    data-testid="agent-create-provider-profile-select"
                    value={selectedProviderProfileId}
                    onChange={(event) => onSelectProviderProfile(event.target.value)}
                    className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
                  >
                    <option value="">新建 Provider Profile</option>
                    {providerProfiles.map((profile) => (
                      <option key={profile.profileId} value={profile.profileId}>
                        {profile.name} · {profile.provider} / {profile.model}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">还没有保存的 Provider Profile，将使用下面的新建表单。</p>
                )}
              </div>

              <input
                data-testid="agent-create-provider-name-input"
                value={apiProfileName}
                onChange={(event) => onApiProfileNameChange(event.target.value)}
                disabled={usingSavedProfile}
                placeholder="Profile 名称（例如 OpenAI GPT-5）"
                className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
              />
              <select
                data-testid="agent-create-provider-select"
                value={apiProvider}
                onChange={(event) => onApiProviderChange(event.target.value as ApiProviderId)}
                disabled={usingSavedProfile}
                className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
              <input
                data-testid="agent-create-model-input"
                value={apiModel}
                onChange={(event) => onApiModelChange(event.target.value)}
                disabled={usingSavedProfile}
                placeholder="Model（例如 gpt-5 / claude-sonnet-4-5）"
                className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
              />
              <input
                data-testid="agent-create-base-url-input"
                value={apiBaseUrl}
                onChange={(event) => onApiBaseUrlChange(event.target.value)}
                disabled={usingSavedProfile}
                placeholder="Base URL（可选）"
                className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
              />
              <input
                data-testid="agent-create-api-key-input"
                value={apiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
                disabled={usingSavedProfile}
                placeholder="API Key"
                className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
              />
              {usingSavedProfile && (
                <p className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                  当前使用已保存 Profile；如需修改请切回"新建 Provider Profile"。
                </p>
              )}
            </div>
          )}

          {compatibleHosts.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">Runtime 目标（多目标时需显式选择）</p>
              <div className="space-y-2">
                {compatibleHosts.map((snapshot) => (
                  <button
                    key={snapshot.host.id}
                    type="button"
                    data-testid={`agent-create-runtime-host-${snapshot.host.id}`}
                    onClick={() => onSelectHost(snapshot.host.id)}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-xs ${
                      selectedHostId === snapshot.host.id
                        ? 'border-[#0D9488] bg-[#0D948810] text-[#0D9488]'
                        : 'border-[#E7E5E4] bg-[#FAF7F5] text-[#57534E] dark:border-[#292524] dark:bg-[#292524] dark:text-[#D6D3D1]'
                    }`}
                  >
                    <p className="font-semibold">{snapshot.host.name}</p>
                    <p className="mt-1 text-[11px] opacity-75">{snapshot.host.host}:{snapshot.host.port}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {compatibleHosts.length === 1 && (
            <p className="rounded-lg bg-[#0D948810] px-3 py-2 text-[11px] text-[#0D9488]">
              单目标自动直达：{compatibleHosts[0]?.host.name}
            </p>
          )}

          {createError && (
            <p className="rounded-lg bg-[#EF444410] px-3 py-2 text-[11px] text-[#DC2626]">{createError}</p>
          )}

          <button
            type="button"
            data-testid="agent-create-submit"
            onClick={onCreate}
            disabled={isCreating}
            className="h-10 w-full rounded-xl bg-[#0D9488] text-sm font-semibold text-white disabled:opacity-50"
          >
            {isCreating ? '创建中...' : '创建 Agent'}
          </button>
        </div>
      </section>
    </>
  );
}

export function RuntimeHostManagerSheet({
  hostSnapshots,
  runtimeHostName,
  runtimeHostAddress,
  runtimeHostError,
  onRuntimeHostNameChange,
  onRuntimeHostAddressChange,
  onRuntimeHostAdd,
  onRuntimeHostProbe,
  onRuntimeHostRemove,
  onClose,
}: {
  hostSnapshots: RuntimeHostSnapshot[];
  runtimeHostName: string;
  runtimeHostAddress: string;
  runtimeHostError: string;
  onRuntimeHostNameChange: (value: string) => void;
  onRuntimeHostAddressChange: (value: string) => void;
  onRuntimeHostAdd: () => Promise<void>;
  onRuntimeHostProbe: (hostId: string) => Promise<void>;
  onRuntimeHostRemove: (hostId: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <>
      <button
        type="button"
        data-testid="agent-host-manager-overlay"
        aria-label="关闭主机管理弹窗（Close Runtime Host Manager）"
        className="absolute inset-0 z-20 bg-black/35"
        onClick={onClose}
      />
      <section
        data-testid="agent-host-manager-sheet"
        className="absolute inset-x-0 bottom-0 z-30 rounded-t-[24px] bg-white pb-7 shadow-[0_-8px_28px_rgba(0,0,0,0.12)] dark:bg-[#1C1917] dark:shadow-[0_-8px_28px_rgba(0,0,0,0.45)]"
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded bg-[#D6D3D1] dark:bg-[#57534E]" />
        </div>
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="text-[18px] font-bold text-[#1C1917] dark:text-[#FAFAF9]">添加设备</h2>
          <button
            type="button"
            data-testid="agent-host-manager-close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#A8A29E] dark:bg-[#292524] dark:text-[#78716C]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 px-5">
          <input
            data-testid="runtime-host-name-input"
            value={runtimeHostName}
            onChange={(event) => onRuntimeHostNameChange(event.target.value)}
            placeholder="Name（名称，可选）"
            className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#292524] dark:bg-[#292524] dark:text-[#FAFAF9]"
          />
          <input
            data-testid="runtime-host-address-input"
            value={runtimeHostAddress}
            onChange={(event) => onRuntimeHostAddressChange(event.target.value)}
            placeholder={`host 或 host:port（例如 127.0.0.1 或 127.0.0.1:${DEFAULT_EXTERNAL_RUNTIME_PORT}）`}
            className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#292524] dark:bg-[#292524] dark:text-[#FAFAF9]"
          />
          <button
            type="button"
            data-testid="runtime-host-add-button"
            onClick={() => {
              void onRuntimeHostAdd();
            }}
            className="h-9 w-full rounded-lg bg-[#C75B3A] text-xs font-semibold text-white"
          >
            添加 exomind-rt
          </button>
        </div>

        {runtimeHostError && (
          <p className="mx-5 mt-2 rounded-md bg-[#EF444410] px-2 py-1 text-[11px] text-[#DC2626]">{runtimeHostError}</p>
        )}

        <div className="mt-3 space-y-2 px-5">
          {hostSnapshots.map((item) => (
            <div
              key={item.host.id}
              className="rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-2 dark:border-[#292524] dark:bg-[#292524]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{item.host.name}</p>
                  <p className="truncate text-[11px] text-[#78716C] dark:text-[#A8A29E]">{item.host.host}:{item.host.port}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    data-testid={`runtime-host-status-${item.host.id}`}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      item.connectionState === 'online'
                        ? 'bg-[#22C55E20] text-[#16A34A]'
                        : item.connectionState === 'offline'
                          ? 'bg-[#EF444420] text-[#DC2626]'
                          : 'bg-[#F59E0B20] text-[#D97706]'
                    }`}
                  >
                    {item.connectionState}
                  </span>
                  <button
                    type="button"
                    data-testid={`runtime-host-probe-${item.host.id}`}
                    onClick={() => {
                      void onRuntimeHostProbe(item.host.id);
                    }}
                    className="rounded bg-[#F5F0ED] px-2 py-1 text-[10px] text-[#57534E] dark:bg-[#1C1917] dark:text-[#D6D3D1]"
                  >
                    重试
                  </button>
                  <button
                    type="button"
                    data-testid={`runtime-host-remove-${item.host.id}`}
                    onClick={() => {
                      void onRuntimeHostRemove(item.host.id);
                    }}
                    className="rounded bg-[#FEE2E2] px-2 py-1 text-[10px] text-[#B91C1C] dark:bg-[#451A1A] dark:text-[#FCA5A5]"
                  >
                    删除
                  </button>
                </div>
              </div>
              {item.error && <p className="mt-1 text-[10px] text-[#DC2626]">{item.error}</p>}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
