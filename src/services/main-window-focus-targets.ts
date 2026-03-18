type FocusTarget = () => void;

const focusTargets = new Map<string, FocusTarget>();
let pendingFocusTargetId: string | null = null;

function invokeTarget(target: FocusTarget): void {
  requestAnimationFrame(() => {
    target();
  });
}

export function registerMainWindowFocusTarget(targetId: string, focusTarget: FocusTarget): () => void {
  focusTargets.set(targetId, focusTarget);

  if (pendingFocusTargetId === targetId) {
    pendingFocusTargetId = null;
    invokeTarget(focusTarget);
  }

  return () => {
    if (focusTargets.get(targetId) === focusTarget) {
      focusTargets.delete(targetId);
    }
  };
}

export function requestMainWindowFocusTarget(targetId: string): void {
  pendingFocusTargetId = targetId;
  const focusTarget = focusTargets.get(targetId);
  if (!focusTarget) {
    return;
  }

  pendingFocusTargetId = null;
  invokeTarget(focusTarget);
}

export function clearPendingMainWindowFocusTarget(targetId?: string): void {
  if (!targetId || pendingFocusTargetId === targetId) {
    pendingFocusTargetId = null;
  }
}
