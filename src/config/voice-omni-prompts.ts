import { createConfigModule } from './config-factory';
import {
  DEFAULT_QWEN_OMNI_PROMPT_DOCS,
  type VoiceOmniPromptDocs,
} from '@/lib/voice/qwen-omni-prompts';

const VOICE_OMNI_PROMPTS_STORAGE_KEY = 'exomind:voiceOmniPromptDocs';
const VOICE_OMNI_PROMPTS_CHANGED_EVENT = 'exomind:voice-omni-prompts-changed';

function normalizePromptDocs(value: unknown): VoiceOmniPromptDocs {
  if (!value || typeof value !== 'object') {
    return DEFAULT_QWEN_OMNI_PROMPT_DOCS;
  }

  const record = value as Partial<VoiceOmniPromptDocs>;
  return {
    agent: typeof record.agent === 'string' && record.agent.trim()
      ? record.agent
      : DEFAULT_QWEN_OMNI_PROMPT_DOCS.agent,
    rules: typeof record.rules === 'string' && record.rules.trim()
      ? record.rules
      : DEFAULT_QWEN_OMNI_PROMPT_DOCS.rules,
    vocabulary: typeof record.vocabulary === 'string' && record.vocabulary.trim()
      ? record.vocabulary
      : DEFAULT_QWEN_OMNI_PROMPT_DOCS.vocabulary,
    textOptimize: typeof record.textOptimize === 'string' && record.textOptimize.trim()
      ? record.textOptimize
      : DEFAULT_QWEN_OMNI_PROMPT_DOCS.textOptimize,
  };
}

function parseStoredPromptDocs(rawValue: string | null | undefined): VoiceOmniPromptDocs {
  if (!rawValue) {
    return DEFAULT_QWEN_OMNI_PROMPT_DOCS;
  }
  try {
    return normalizePromptDocs(JSON.parse(rawValue));
  } catch {
    return DEFAULT_QWEN_OMNI_PROMPT_DOCS;
  }
}

const promptDocsModule = createConfigModule<VoiceOmniPromptDocs>({
  storageKey: VOICE_OMNI_PROMPTS_STORAGE_KEY,
  eventName: VOICE_OMNI_PROMPTS_CHANGED_EVENT,
  defaultValue: DEFAULT_QWEN_OMNI_PROMPT_DOCS,
  normalize: parseStoredPromptDocs,
  serialize: (value) => JSON.stringify(normalizePromptDocs(value)),
  persistMode: 'runtime-preferred',
});

export function getVoiceOmniPromptDocs(): VoiceOmniPromptDocs {
  return promptDocsModule.get();
}

export function setVoiceOmniPromptDocs(value: VoiceOmniPromptDocs): VoiceOmniPromptDocs {
  return promptDocsModule.set(value);
}

export function updateVoiceOmniPromptDocs(patch: Partial<VoiceOmniPromptDocs>): VoiceOmniPromptDocs {
  return promptDocsModule.set({
    ...getVoiceOmniPromptDocs(),
    ...patch,
  });
}

export function resetVoiceOmniPromptDocs(): VoiceOmniPromptDocs {
  return promptDocsModule.set(DEFAULT_QWEN_OMNI_PROMPT_DOCS);
}

export function subscribeVoiceOmniPromptDocsChanges(listener: (value: VoiceOmniPromptDocs) => void): () => void {
  return promptDocsModule.subscribe(listener);
}
