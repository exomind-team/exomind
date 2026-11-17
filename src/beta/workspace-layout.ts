import { useMemo, useSyncExternalStore } from 'react';

export type BetaPaneState = 'expanded' | 'collapsed' | 'hidden';
export interface BetaWorkspaceLayout { focus: BetaPaneState; records: BetaPaneState }
const KEY = 'exomind:beta:workspace-layout';
const CHANGE = 'exomind:beta:workspace-layout-changed';
export const DEFAULT_WORKSPACE_LAYOUT: BetaWorkspaceLayout = { focus: 'expanded', records: 'expanded' };

function read(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function decode(raw: string | null): BetaWorkspaceLayout {
  try {
    const value = JSON.parse(raw ?? 'null');
    const valid = (state: unknown): state is BetaPaneState => state === 'expanded' || state === 'collapsed' || state === 'hidden';
    if (value?.version === 1 && valid(value.focus) && valid(value.records)) return { focus: value.focus, records: value.records };
  } catch { /* Unknown/old preferences use the established layout, never modify facts. */ }
  return DEFAULT_WORKSPACE_LAYOUT;
}
function subscribe(changed: () => void): () => void {
  const storage = (event: StorageEvent) => { if (!event.key || event.key === KEY) changed(); };
  window.addEventListener(CHANGE, changed); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(CHANGE, changed); window.removeEventListener('storage', storage); };
}
/** Device-local presentation only. Read the latest value at the write boundary
 * so changing one pane does not overwrite another window's other pane. */
export function updateBetaWorkspaceLayout(patch: Partial<BetaWorkspaceLayout>): void {
  localStorage.setItem(KEY, JSON.stringify({ version: 1, ...decode(read()), ...patch }));
  window.dispatchEvent(new Event(CHANGE));
}
export function useBetaWorkspaceLayout(): BetaWorkspaceLayout {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  return useMemo(() => decode(raw), [raw]);
}
