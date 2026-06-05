import { createConfigModule } from './config-factory';

interface SubscriptionsConfig {
  block_completed: boolean;
  block_feedback: boolean;
}

function normalizeSubscriptions(rawValue: string | null | undefined): SubscriptionsConfig {
  if (!rawValue) {
    return { block_completed: true, block_feedback: false };
  }
  try {
    const parsed = JSON.parse(rawValue);
    return {
      block_completed: parsed.block_completed ?? true,
      block_feedback: parsed.block_feedback ?? false,
    };
  } catch {
    return { block_completed: true, block_feedback: false };
  }
}

const _module = createConfigModule<SubscriptionsConfig>({
  storageKey: 'builtin.timeblock_summary.subscriptions',
  eventName: 'exomind:builtin-timeblock-summary-subscriptions-changed',
  defaultValue: { block_completed: true, block_feedback: false },
  normalize: normalizeSubscriptions,
  serialize: (value) => JSON.stringify(value),
  persistMode: 'runtime-preferred',
});

export function getBuiltinTimeblockSummarySubscriptions(): SubscriptionsConfig {
  return _module.get();
}

export function setBuiltinTimeblockSummarySubscriptions(subs: SubscriptionsConfig): void {
  _module.set(subs);
}

export function subscribeBuiltinTimeblockSummarySubscriptionsChanges(
  listener: (subs: SubscriptionsConfig) => void,
): () => void {
  return _module.subscribe(listener);
}
