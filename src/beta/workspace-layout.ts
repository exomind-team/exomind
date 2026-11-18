import { useMemo, useState, useSyncExternalStore } from 'react';

export type BetaPaneState = 'expanded' | 'collapsed' | 'hidden';
export interface BetaWorkspaceLayout { focus: BetaPaneState; records: BetaPaneState; minimal?: boolean }
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
    if (value?.version === 1 && valid(value.focus) && valid(value.records)) return { focus: value.focus, records: value.records, minimal: value.minimal === true };
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

export interface BetaWorkspacePresentation {
  layout: BetaWorkspaceLayout;
  error: string;
  change: (patch: Partial<BetaWorkspaceLayout>) => void;
}
/** Lives above the profile's writer. A profile switch must not replace the
 * navigation/select controls or discard a session-only layout on write failure. */
export function useBetaWorkspacePresentation(): BetaWorkspacePresentation {
  const saved = useBetaWorkspaceLayout();
  const [temporary, setTemporary] = useState<BetaWorkspaceLayout | null>(null);
  const [error, setError] = useState('');
  return { layout: temporary ?? saved, error, change(patch) {
    try { updateBetaWorkspaceLayout(temporary ? { ...temporary, ...patch } : patch); setTemporary(null); setError(''); }
    catch { setTemporary({ ...saved, ...temporary, ...patch }); setError('布局已应用，但本机偏好未能保存；本窗口仍可继续使用，重启后可能恢复原布局'); }
  } };
}
