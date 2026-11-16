import type { ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { runActionOnPrimaryModifierEnter } from "@/ui/app/components/dialog-submit-shortcuts";

export interface AIRegistryFormDraft {
  offeringId?: string;
  capabilityKey: string;
  capabilityDisplayName: string;
  channelName: string;
  vendor: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  qualityScoreManual: string;
  stabilityLevelManual: string;
  latencyTierManual: string;
  notes: string;
  setAsDefault: boolean;
}

const TEXT_INPUT_CLASS =
  "w-full rounded-xl border border-[#F0ECE8] bg-white px-4 py-3 text-sm text-[#1C1917] outline-none placeholder:text-[#D6D3D1] focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9] dark:placeholder:text-[#57534E]";
const DIALOG_PANEL_CLASS =
  "rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] p-4 dark:border-[#292524] dark:bg-[#1C1917]";
const FIELD_LABEL_CLASS =
  "text-xs font-medium text-[#78716C] dark:text-[#A8A29E]";
const CHECKBOX_ROW_CLASS =
  "flex items-center gap-2 rounded-xl border border-[#F0ECE8] bg-white px-3 py-3 text-sm text-[#57534E] dark:border-[#292524] dark:bg-[#0C0A09] dark:text-[#D6D3D1]";
const AI_REGISTRY_UNSET_SELECT_VALUE = "__unset__";
export { DIALOG_PANEL_CLASS as AI_REGISTRY_PANEL_CLASS, TEXT_INPUT_CLASS as AI_REGISTRY_INPUT_CLASS, FIELD_LABEL_CLASS as AI_REGISTRY_FIELD_LABEL_CLASS };

export interface AIRegistryOfferingFormViewProps {
  draft: AIRegistryFormDraft;
  onDraftChange: (update: (current: AIRegistryFormDraft) => AIRegistryFormDraft) => void;
  capabilityOptions: readonly { key: string; displayName: string }[];
  vendorOptions: readonly string[];
  error: string | null;
  onSave: () => void;
  onReset: () => void;
  mode?: 'registry' | 'summary';
  secretFieldVisible?: boolean;
  beforeSecret?: ReactNode;
  afterSecret?: ReactNode;
  saveLabel?: string;
  saveDisabled?: boolean;
}

/** The existing Alpha offering editor's presentation only. Its caller owns
 * draft state, option data, validation, credentials and persistence. Importing
 * this View never loads the legacy registry, config, services or bootstrap. */
export function AIRegistryOfferingFormView({ draft, onDraftChange, capabilityOptions, vendorOptions, error, onSave, onReset, mode = 'registry', secretFieldVisible = true, beforeSecret, afterSecret, saveLabel = '保存', saveDisabled = false }: AIRegistryOfferingFormViewProps) {
  return (
    <section className={`${DIALOG_PANEL_CLASS} min-w-0`} onKeyDown={mode === 'summary' ? event => { if (!saveDisabled) runActionOnPrimaryModifierEnter(event, onSave); } : undefined}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
            {mode === 'summary' ? '回顾模型' : draft.offeringId ? "编辑供给项" : "新增供给项"}
          </h3>
          <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
            {mode === 'summary' ? '仅配置本机此档案的回顾。保存启用后供本机负责的回顾任务使用；不自动接管其他设备。' : <>这里编辑的是 model / channel / capability
            的组合项，不只是默认 llm.chat。</>}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {mode === 'registry' && <>
          <div className="space-y-1.5">
            <label className={FIELD_LABEL_CLASS}>
              Capability Key
            </label>
            <input
              list="ai-registry-capability-options"
              type="text"
              value={draft.capabilityKey}
              onChange={(event) =>
                onDraftChange((current) => ({
                  ...current,
                  capabilityKey: event.target.value,
                }))
              }
              placeholder="llm.chat"
              className={TEXT_INPUT_CLASS}
            />
            <datalist id="ai-registry-capability-options">
              {capabilityOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.displayName}
                </option>
              ))}
            </datalist>
          </div>

          <div className="space-y-1.5">
            <label className={FIELD_LABEL_CLASS}>
              Capability Name
            </label>
            <input
              type="text"
              value={draft.capabilityDisplayName}
              onChange={(event) =>
                onDraftChange((current) => ({
                  ...current,
                  capabilityDisplayName: event.target.value,
                }))
              }
              placeholder="LLM Chat"
              className={TEXT_INPUT_CLASS}
            />
          </div>

          <div className="space-y-1.5">
            <label className={FIELD_LABEL_CLASS}>Channel Name</label>
            <input
              type="text"
              value={draft.channelName}
              onChange={(event) =>
                onDraftChange((current) => ({
                  ...current,
                  channelName: event.target.value,
                }))
              }
              placeholder="Primary LLM Channel"
              className={TEXT_INPUT_CLASS}
            />
          </div>

          <div className="space-y-1.5">
            <label className={FIELD_LABEL_CLASS}>
              Vendor / 渠道厂商
            </label>
            <input
              list="ai-registry-vendor-options"
              type="text"
              value={draft.vendor}
              onChange={(event) =>
                onDraftChange((current) => ({
                  ...current,
                  vendor: event.target.value,
                }))
              }
              placeholder="openai"
              className={TEXT_INPUT_CLASS}
            />
            <datalist id="ai-registry-vendor-options">
              {vendorOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </div>

        </>}
        <div className="space-y-1.5">
          <label className={FIELD_LABEL_CLASS}>{mode === 'summary' ? '接口基础地址' : 'Base URL'}</label>
          <input
            type="url"
            aria-label={mode === 'summary' ? '接口基础地址' : undefined}
            value={draft.baseUrl}
            onChange={(event) =>
              onDraftChange((current) => ({
                ...current,
                baseUrl: event.target.value,
              }))
            }
            placeholder="https://api.openai.com/v1"
            className={TEXT_INPUT_CLASS}
          />
        </div>

        <div className="space-y-1.5">
          <label className={FIELD_LABEL_CLASS}>{mode === 'summary' ? '模型名称' : '模型 / Model'}</label>
          <input
            type="text"
            aria-label={mode === 'summary' ? '模型名称' : undefined}
            value={draft.model}
            onChange={(event) =>
              onDraftChange((current) => ({
                ...current,
                model: event.target.value,
              }))
            }
            placeholder="gpt-4o"
            className={TEXT_INPUT_CLASS}
          />
        </div>

        {beforeSecret}
        {secretFieldVisible && (
          <div className="space-y-1.5">
            <label className={FIELD_LABEL_CLASS}>API Key</label>
            <input
              type="password"
              value={draft.apiKey}
              onChange={(event) =>
                onDraftChange((current) => ({
                  ...current,
                  apiKey: event.target.value,
                }))
              }
              aria-label={mode === 'summary' ? '新 API Key' : undefined}
              placeholder={mode === 'summary' ? '输入新密钥（仅本次编辑）' : 'sk-...'}
              className={TEXT_INPUT_CLASS}
            />
          </div>
        )}
        {afterSecret}

        {mode === 'registry' && <>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <label className={FIELD_LABEL_CLASS}>质量分</label>
              <input
                type="number"
                min="0"
                max="100"
                value={draft.qualityScoreManual}
                onChange={(event) =>
                  onDraftChange((current) => ({
                    ...current,
                    qualityScoreManual: event.target.value,
                  }))
                }
                placeholder="92"
                className={TEXT_INPUT_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <label className={FIELD_LABEL_CLASS}>稳定性</label>
              <Select
                value={draft.stabilityLevelManual || AI_REGISTRY_UNSET_SELECT_VALUE}
                onValueChange={(value) =>
                  onDraftChange((current) => ({
                    ...current,
                    stabilityLevelManual: value === AI_REGISTRY_UNSET_SELECT_VALUE ? "" : value,
                  }))
                }
              >
                <SelectTrigger className={TEXT_INPUT_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AI_REGISTRY_UNSET_SELECT_VALUE}>未设置</SelectItem>
                  <SelectItem value="unknown">unknown</SelectItem>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className={FIELD_LABEL_CLASS}>延迟档</label>
              <Select
                value={draft.latencyTierManual || AI_REGISTRY_UNSET_SELECT_VALUE}
                onValueChange={(value) =>
                  onDraftChange((current) => ({
                    ...current,
                    latencyTierManual: value === AI_REGISTRY_UNSET_SELECT_VALUE ? "" : value,
                  }))
                }
              >
                <SelectTrigger className={TEXT_INPUT_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AI_REGISTRY_UNSET_SELECT_VALUE}>未设置</SelectItem>
                  <SelectItem value="unknown">unknown</SelectItem>
                  <SelectItem value="slow">slow</SelectItem>
                  <SelectItem value="normal">normal</SelectItem>
                  <SelectItem value="fast">fast</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={FIELD_LABEL_CLASS}>备注 / Notes</label>
            <textarea
              value={draft.notes}
              onChange={(event) =>
                onDraftChange((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              onKeyDown={(event) => {
                  if (!saveDisabled) runActionOnPrimaryModifierEnter(event, onSave);
              }}
              placeholder="记录质量、价格、额度、代理稳定性等备注"
              className={`${TEXT_INPUT_CLASS} min-h-[88px] resize-y`}
            />
          </div>

          <label className={CHECKBOX_ROW_CLASS}>
            <input
              type="checkbox"
              checked={draft.setAsDefault}
              onChange={(event) =>
                onDraftChange((current) => ({
                  ...current,
                  setAsDefault: event.target.checked,
                }))
              }
            />
            <span>
              设为该 capability / 能力项 的默认 offering / 供给项
            </span>
          </label>

        </>}
        {error ? (
          <p className="text-xs text-red-600 dark:text-[#FCA5A5]">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReset}
            className="flex-1 rounded-xl border border-[#F0ECE8] px-4 py-2.5 text-sm font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#1C1917]"
          >
            {mode === 'summary' ? '撤销修改' : '重置'}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saveDisabled}
            className="flex-1 rounded-xl bg-[#C75B3A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#B5502F]"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
