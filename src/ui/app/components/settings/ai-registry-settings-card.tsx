import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Key } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getLLMSettings } from '@/config/llm-settings';
import { resolveOfferingForCapability } from '@/lib/ai-registry/resolution';
import {
  getAIRegistrySnapshot,
  subscribeAIRegistryChanges,
} from '@/lib/ai-registry/storage';
import {
  DEFAULT_LLM_CHANNEL_NAME,
  getDefaultLLMRegistryDraft,
  saveDefaultLLMRegistryDraft,
} from '@/lib/ai-registry/compat';
import { SettingRow } from '@/ui/app/components/settings-shared';
import type { SettingsContext } from '@/ui/app/config/settings/settings-types';

interface AIRegistryDraft {
  channelName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

function SecondaryValue({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-1 text-sm text-[#A8A29E]">
      <span>{value}</span>
      <ChevronRight className="h-4 w-4" />
    </div>
  );
}

function getInitialDraft(snapshot = getAIRegistrySnapshot()): AIRegistryDraft {
  const draft = getDefaultLLMRegistryDraft();
  if (draft.apiKey.trim() || snapshot.channels.length > 0) {
    return draft;
  }

  const legacy = getLLMSettings();
  return {
    channelName: DEFAULT_LLM_CHANNEL_NAME,
    baseUrl: legacy.baseUrl,
    model: legacy.model,
    apiKey: legacy.apiKey,
  };
}

function ensureRegistryBootstrapped(): void {
  const snapshot = getAIRegistrySnapshot();
  const resolved = resolveOfferingForCapability(snapshot, 'llm.chat');
  if (resolved) {
    return;
  }

  const legacy = getLLMSettings();
  if (!legacy.apiKey.trim()) {
    return;
  }

  saveDefaultLLMRegistryDraft({
    channelName: DEFAULT_LLM_CHANNEL_NAME,
    baseUrl: legacy.baseUrl,
    model: legacy.model,
    apiKey: legacy.apiKey,
  });
}

function buildRegistrySummary(): string {
  const resolved = resolveOfferingForCapability(getAIRegistrySnapshot(), 'llm.chat');
  if (!resolved) {
    return 'Default llm.chat · 未配置';
  }

  return `Default llm.chat · ${resolved.model.displayName}`;
}

function saveDefaultRegistryDraft(draft: AIRegistryDraft): void {
  saveDefaultLLMRegistryDraft({
    channelName: draft.channelName.trim() || DEFAULT_LLM_CHANNEL_NAME,
    baseUrl: draft.baseUrl.trim(),
    model: draft.model.trim(),
    apiKey: draft.apiKey.trim(),
  });
}

export function AIRegistrySetting(_props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AIRegistryDraft>(() => getInitialDraft());
  const [summary, setSummary] = useState(() => buildRegistrySummary());
  const snapshot = useMemo(() => getAIRegistrySnapshot(), [summary]);

  useEffect(() => {
    ensureRegistryBootstrapped();
    setSummary(buildRegistrySummary());

    return subscribeAIRegistryChanges(() => {
      setSummary(buildRegistrySummary());
    });
  }, []);

  const handleOpen = () => {
    ensureRegistryBootstrapped();
    setDraft(getInitialDraft());
    setError(null);
    setOpen(true);
  };

  const handleSave = () => {
    if (!draft.baseUrl.trim() || !draft.model.trim() || !draft.apiKey.trim()) {
      setError('请填写渠道名称、Base URL、模型与 API Key');
      return;
    }

    saveDefaultRegistryDraft(draft);
    setNotice('AI Registry 已保存');
    setError(null);
    setOpen(false);
  };

  return (
    <>
      <SettingRow
        icon={<Key className="h-[18px] w-[18px] text-[#78716C]" />}
        label="AI Registry"
        onClick={handleOpen}
        right={<SecondaryValue value={summary} />}
      />
      {notice ? <div className="px-4 pb-3 text-xs text-[#78716C]">{notice}</div> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>AI Registry</DialogTitle>
            <DialogDescription>管理默认 `llm.chat / 默认聊天能力` 的渠道、模型与密钥</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] px-3 py-3 text-xs text-[#57534E]">
                <div className="text-[11px] uppercase tracking-[0.08em] text-[#A8A29E]">Channels</div>
                <div className="mt-1 text-sm font-medium text-[#1C1917]">{snapshot.channels.length}</div>
              </div>
              <div className="rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] px-3 py-3 text-xs text-[#57534E]">
                <div className="text-[11px] uppercase tracking-[0.08em] text-[#A8A29E]">Offerings</div>
                <div className="mt-1 text-sm font-medium text-[#1C1917]">{snapshot.offerings.length}</div>
              </div>
              <div className="rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] px-3 py-3 text-xs text-[#57534E]">
                <div className="text-[11px] uppercase tracking-[0.08em] text-[#A8A29E]">Default</div>
                <div className="mt-1 text-sm font-medium text-[#1C1917]">llm.chat</div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">Channel Name</label>
              <input
                type="text"
                value={draft.channelName}
                onChange={(event) => setDraft((current) => ({ ...current, channelName: event.target.value }))}
                placeholder="Primary LLM Channel"
                className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">Base URL</label>
              <input
                type="url"
                value={draft.baseUrl}
                onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                placeholder="https://api.openai.com/v1"
                className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">模型 / Model</label>
              <input
                type="text"
                value={draft.model}
                onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
                placeholder="gpt-4o"
                className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">API Key</label>
              <input
                type="password"
                value={draft.apiKey}
                onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder="sk-..."
                className="w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]"
              />
            </div>
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
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
                onClick={handleSave}
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
