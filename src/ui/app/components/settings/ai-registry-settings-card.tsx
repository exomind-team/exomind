import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Key } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getLLMSettings } from "@/config/llm-settings";
import {
  COMMON_AI_CAPABILITY_OPTIONS,
  COMMON_AI_VENDOR_OPTIONS,
  deleteAIRegistryOffering,
  getAIRegistryOfferingDraft,
  listAIRegistryCapabilities,
  listAIRegistryOfferings,
  saveAIRegistryOfferingDraft,
  setAIRegistryDefaultOffering,
  type AIRegistryOfferingDraft,
  type AIRegistryOfferingSummary,
} from "@/lib/ai-registry/admin";
import { resolveOfferingForCapability } from "@/lib/ai-registry/resolution";
import {
  getAIRegistrySnapshot,
  subscribeAIRegistryChanges,
} from "@/lib/ai-registry/storage";
import type { AILatencyTier, AIStabilityLevel } from "@/lib/ai-registry/types";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_CHANNEL_NAME,
  DEFAULT_LLM_MODEL,
  getDefaultLLMRegistryDraft,
  saveDefaultLLMRegistryDraft,
} from "@/lib/ai-registry/compat";
import { inferVendorFromBaseUrl } from "@/lib/ai-registry/vendor";
import { SettingRow } from "@/ui/app/components/settings-shared";
import type { SettingsContext } from "@/ui/app/config/settings/settings-types";
import { AIRegistryOfferingFormView, AI_REGISTRY_PANEL_CLASS as DIALOG_PANEL_CLASS, type AIRegistryFormDraft } from "./AIRegistryOfferingFormView";

const GHOST_BUTTON_CLASS =
  "rounded-xl border border-[#F0ECE8] px-3 py-2 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]";
const DIALOG_SURFACE_CLASS =
  "max-w-4xl overflow-hidden rounded-2xl border border-[#E7E5E4] bg-[#FAF7F5] p-0 text-[#1C1917] shadow-[0_24px_80px_-32px_rgba(0,0,0,0.45)] dark:border-[#292524] dark:bg-[#0C0A09] dark:text-[#FAFAF9]";

const DIALOG_CARD_CLASS =
  "rounded-xl border border-[#E7E5E4] bg-white dark:border-[#292524] dark:bg-[#0C0A09]";
const DIALOG_BADGE_CLASS =
  "rounded-full bg-[#FAF7F5] px-2 py-1 text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]";

const DANGER_BUTTON_CLASS =
  "rounded-xl border border-[#F0ECE8] px-3 py-2 text-sm font-medium text-[#B91C1C] hover:bg-[#FEF2F2] dark:border-[#7F1D1D] dark:text-[#FCA5A5] dark:hover:bg-[#2A1111]";

function SecondaryValue({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-1 text-sm text-[#A8A29E] dark:text-[#A8A29E]">
      <span>{value}</span>
      <ChevronRight className="h-4 w-4" />
    </div>
  );
}

function buildRegistrySummary() {
  const snapshot = getAIRegistrySnapshot();
  return `${snapshot.channels.length} channels · ${snapshot.offerings.length} offerings`;
}

function ensureRegistryBootstrapped(): void {
  const snapshot = getAIRegistrySnapshot();
  const resolved = resolveOfferingForCapability(snapshot, "llm.chat");
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

function buildCreateDraft(): AIRegistryFormDraft {
  const snapshot = getAIRegistrySnapshot();
  const fallback = getDefaultLLMRegistryDraft();
  const hasAnyOfferings = snapshot.offerings.length > 0;

  return {
    capabilityKey: "llm.chat",
    capabilityDisplayName: "LLM Chat",
    channelName: fallback.channelName || DEFAULT_LLM_CHANNEL_NAME,
    vendor: inferVendorFromBaseUrl(fallback.baseUrl || DEFAULT_LLM_BASE_URL),
    baseUrl: fallback.baseUrl || DEFAULT_LLM_BASE_URL,
    model: fallback.model || DEFAULT_LLM_MODEL,
    apiKey: hasAnyOfferings ? "" : fallback.apiKey,
    qualityScoreManual: "",
    stabilityLevelManual: "",
    latencyTierManual: "",
    notes: "",
    setAsDefault: !resolveOfferingForCapability(snapshot, "llm.chat"),
  };
}

function toFormDraft(summary: AIRegistryOfferingSummary): AIRegistryFormDraft {
  const editable = getAIRegistryOfferingDraft(summary.offeringId);
  if (!editable) {
    return buildCreateDraft();
  }

  return {
    offeringId: editable.offeringId,
    capabilityKey: editable.capabilityKey,
    capabilityDisplayName:
      editable.capabilityDisplayName || summary.capabilityDisplayName,
    channelName: editable.channelName,
    vendor: editable.vendor,
    baseUrl: editable.baseUrl,
    model: editable.model,
    apiKey: editable.apiKey,
    qualityScoreManual:
      typeof editable.qualityScoreManual === "number"
        ? String(editable.qualityScoreManual)
        : "",
    stabilityLevelManual: editable.stabilityLevelManual ?? "",
    latencyTierManual: editable.latencyTierManual ?? "",
    notes: editable.notes ?? "",
    setAsDefault: editable.setAsDefault ?? false,
  };
}

function toSaveDraft(formDraft: AIRegistryFormDraft): AIRegistryOfferingDraft {
  const qualityText = formDraft.qualityScoreManual.trim();
  const stabilityLevel = formDraft.stabilityLevelManual.trim();
  const latencyTier = formDraft.latencyTierManual.trim();

  return {
    offeringId: formDraft.offeringId,
    capabilityKey: formDraft.capabilityKey.trim(),
    capabilityDisplayName: formDraft.capabilityDisplayName.trim(),
    channelName: formDraft.channelName.trim(),
    vendor: formDraft.vendor.trim(),
    baseUrl: formDraft.baseUrl.trim(),
    model: formDraft.model.trim(),
    apiKey: formDraft.apiKey.trim(),
    qualityScoreManual: qualityText ? Number(qualityText) : undefined,
    stabilityLevelManual: normalizeStabilityLevel(stabilityLevel),
    latencyTierManual: normalizeLatencyTier(latencyTier),
    notes: formDraft.notes.trim() || undefined,
    setAsDefault: formDraft.setAsDefault,
  };
}

function normalizeStabilityLevel(value: string): AIStabilityLevel | undefined {
  switch (value) {
    case "unknown":
    case "low":
    case "medium":
    case "high":
      return value;
    default:
      return undefined;
  }
}

function normalizeLatencyTier(value: string): AILatencyTier | undefined {
  switch (value) {
    case "unknown":
    case "slow":
    case "normal":
    case "fast":
      return value;
    default:
      return undefined;
  }
}

export function AIRegistrySetting(_props: { ctx: SettingsContext }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState(() => buildRegistrySummary());
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  const [draft, setDraft] = useState<AIRegistryFormDraft>(() =>
    buildCreateDraft(),
  );
  const snapshot = useMemo(
    () => getAIRegistrySnapshot(),
    [snapshotVersion, summary],
  );
  const capabilities = useMemo(
    () => listAIRegistryCapabilities(snapshot),
    [snapshot],
  );
  const offerings = useMemo(
    () => listAIRegistryOfferings(snapshot),
    [snapshot],
  );

  function refreshRegistryView(resetDraft = false): void {
    setSummary(buildRegistrySummary());
    setSnapshotVersion((value) => value + 1);
    if (resetDraft) {
      setDraft(buildCreateDraft());
    }
  }

  useEffect(() => {
    ensureRegistryBootstrapped();
    refreshRegistryView(true);

    return subscribeAIRegistryChanges(() => {
      refreshRegistryView(false);
    });
  }, []);

  const handleOpen = () => {
    ensureRegistryBootstrapped();
    refreshRegistryView(true);
    setError(null);
    setOpen(true);
  };

  const handleCreateNew = () => {
    setDraft(buildCreateDraft());
    setError(null);
  };

  const handleEdit = (offering: AIRegistryOfferingSummary) => {
    setDraft(toFormDraft(offering));
    setError(null);
  };

  const handleSave = () => {
    try {
      const saved = saveAIRegistryOfferingDraft(toSaveDraft(draft));
      setNotice(
        `AI Registry 已保存：${saved.channelName} / ${saved.capabilityKey}`,
      );
      setError(null);
      refreshRegistryView(false);
      setDraft(toFormDraft(saved));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "AI Registry 保存失败",
      );
    }
  };

  const handleSetDefault = (offeringId: string) => {
    const updated = setAIRegistryDefaultOffering(offeringId);
    if (!updated) {
      setError("默认供给项切换失败");
      return;
    }
    setNotice(
      `默认能力已切换：${updated.capabilityKey} -> ${updated.channelName}`,
    );
    setError(null);
    refreshRegistryView(false);
    if (draft.offeringId === offeringId) {
      setDraft(toFormDraft(updated));
    }
  };

  const handleDelete = (offeringId: string) => {
    deleteAIRegistryOffering(offeringId);
    setNotice("供给项已删除");
    setError(null);
    refreshRegistryView(false);
    if (draft.offeringId === offeringId) {
      setDraft(buildCreateDraft());
    }
  };

  return (
    <>
      <SettingRow
        icon={
          <Key className="h-[18px] w-[18px] text-[#78716C] dark:text-[#A8A29E]" />
        }
        label="AI Registry"
        onClick={handleOpen}
        right={<SecondaryValue value={summary} />}
      />
      {notice ? (
        <div className="px-4 pb-3 text-xs text-[#78716C] dark:text-[#A8A29E]">
          {notice}
        </div>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={DIALOG_SURFACE_CLASS}>
          <div
            data-testid="ai-registry-dialog-shell"
            className="flex max-h-[calc(100vh-32px)] min-h-0 flex-col"
          >
            <div className="shrink-0 border-b border-[#E7E5E4] px-6 py-5 dark:border-[#292524]">
              <DialogHeader>
                <DialogTitle>AI Registry</DialogTitle>
                <DialogDescription className="text-[#78716C] dark:text-[#A8A29E]">
                  管理多渠道、多能力、多模型的 AI
                  供给项，并为每个能力指定默认路由
                </DialogDescription>
              </DialogHeader>
            </div>

            <div
              data-testid="ai-registry-scroll-region"
              className="min-h-0 overflow-y-auto overscroll-contain px-6 py-5"
            >
              <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <div className="min-w-0 space-y-4">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] px-3 py-3 text-xs text-[#57534E] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
                      <div className="text-[11px] uppercase tracking-[0.08em] text-[#A8A29E] dark:text-[#78716C]">
                        Channels
                      </div>
                      <div className="mt-1 text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                        {snapshot.channels.length}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] px-3 py-3 text-xs text-[#57534E] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
                      <div className="text-[11px] uppercase tracking-[0.08em] text-[#A8A29E] dark:text-[#78716C]">
                        Offerings
                      </div>
                      <div className="mt-1 text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                        {snapshot.offerings.length}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] px-3 py-3 text-xs text-[#57534E] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#D6D3D1]">
                      <div className="text-[11px] uppercase tracking-[0.08em] text-[#A8A29E] dark:text-[#78716C]">
                        Defaults
                      </div>
                      <div className="mt-1 text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                        {snapshot.resolutionRules.length}
                      </div>
                    </div>
                  </div>

                  <section className={DIALOG_PANEL_CLASS}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                          默认能力映射
                        </h3>
                        <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                          每个 capability / 能力项 当前默认走哪个 offering /
                          供给项
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {capabilities.length === 0 ? (
                        <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">
                          尚未注册任何 capability / 能力项。
                        </p>
                      ) : (
                        capabilities.map((capability) => (
                          <div
                            key={capability.key}
                            className={`${DIALOG_CARD_CLASS} px-3 py-3 text-sm`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                                  {capability.key}
                                </p>
                                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                                  {capability.displayName}
                                </p>
                              </div>
                              <div className="text-right text-xs text-[#78716C] dark:text-[#A8A29E]">
                                <div>{capability.offeringCount} offerings</div>
                                <div>
                                  {capability.defaultLabel ?? "未配置默认值"}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  <section className={DIALOG_PANEL_CLASS}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                          已注册供给项
                        </h3>
                        <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                          同一个模型可以挂多个渠道；同一个渠道也可以承载多个能力。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCreateNew}
                        className={GHOST_BUTTON_CLASS}
                      >
                        新建供给项
                      </button>
                    </div>
                    <div className="mt-3 space-y-3">
                      {offerings.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-[#D6D3D1] bg-white px-4 py-5 text-sm text-[#78716C] dark:border-[#44403C] dark:bg-[#0C0A09] dark:text-[#A8A29E]">
                          尚未注册任何 AI offering / 供给项。
                        </p>
                      ) : (
                        offerings.map((offering) => (
                          <article
                            key={offering.offeringId}
                            className={`${DIALOG_CARD_CLASS} px-4 py-4`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                                    {offering.channelName}
                                  </h4>
                                  <span className="rounded-full bg-[#F5F0ED] px-2 py-1 text-[11px] text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]">
                                    {offering.capabilityKey}
                                  </span>
                                  {offering.isDefault ? (
                                    <span className="rounded-full bg-[#C75B3A] px-2 py-1 text-[11px] text-white">
                                      默认
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                                  {offering.vendor} / {offering.modelName}
                                </p>
                                <p className="mt-1 text-xs text-[#A8A29E] dark:text-[#78716C]">
                                  {offering.baseUrl}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {!offering.isDefault ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleSetDefault(offering.offeringId)
                                    }
                                    className={GHOST_BUTTON_CLASS}
                                  >
                                    设为默认
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => handleEdit(offering)}
                                  className={GHOST_BUTTON_CLASS}
                                >
                                  编辑
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDelete(offering.offeringId)
                                  }
                                  className={DANGER_BUTTON_CLASS}
                                >
                                  删除
                                </button>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                              <span className={DIALOG_BADGE_CLASS}>
                                API Key{" "}
                                {offering.apiKeyConfigured
                                  ? "已配置"
                                  : "未配置"}
                              </span>
                              {typeof offering.qualityScoreManual ===
                              "number" ? (
                                <span className={DIALOG_BADGE_CLASS}>
                                  质量 {offering.qualityScoreManual}
                                </span>
                              ) : null}
                              {offering.stabilityLevelManual ? (
                                <span className={DIALOG_BADGE_CLASS}>
                                  稳定性 {offering.stabilityLevelManual}
                                </span>
                              ) : null}
                              {offering.latencyTierManual ? (
                                <span className={DIALOG_BADGE_CLASS}>
                                  延迟 {offering.latencyTierManual}
                                </span>
                              ) : null}
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                  </section>
                </div>

                <AIRegistryOfferingFormView
                  draft={draft}
                  onDraftChange={setDraft}
                  capabilityOptions={COMMON_AI_CAPABILITY_OPTIONS}
                  vendorOptions={COMMON_AI_VENDOR_OPTIONS}
                  error={error}
                  onSave={handleSave}
                  onReset={handleCreateNew}
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
