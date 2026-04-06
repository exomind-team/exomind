import { useCallback, useEffect } from 'react';
import {
  getResolvedTiledWorkbenchShortcuts,
  matchesKeyboardShortcutEvent,
} from '@/config/tiled-workbench-shortcuts';
import type { PtyInputTarget } from '@/ui/app/components/pty-input';
import { sendPtyShortcutInput } from '@/ui/app/components/pty-input';
import {
  findAdjacentTiledPaneSlot,
  flattenTiledPaneTreeSlotIds,
  type TiledPaneTreeNode,
  type TiledPaneSplitAxis,
} from './tiled-pane-tree';

interface TiledWorkbenchShortcutAction {
  shortcut: string | null;
  run: () => void;
}

export interface UseTiledWorkbenchKeyboardOptions {
  enabled: boolean;
  suspended?: boolean;
  tree: TiledPaneTreeNode;
  focusedSlotId: string | null;
  focusedPtyTarget?: PtyInputTarget | null;
  passthroughArmed: boolean;
  onPassthroughArmedChange: (armed: boolean) => void;
  onFocusSlot: (slotId: string | null) => void;
  onSplitSlot: (slotId: string, axis: TiledPaneSplitAxis) => void;
  onClearSlot: (slotId: string) => void;
  onCloseSlot: (slotId: string) => void;
  onOpenSlotEntry: (slotId: string) => void;
}

function hasBlockingDialog(): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"]')).some((node) => {
    if (!(node instanceof HTMLElement)) {
      return true;
    }

    if (
      node.hidden
      || node.getAttribute('aria-hidden') === 'true'
      || node.getAttribute('data-state') === 'closed'
    ) {
      return false;
    }

    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.closest('.xterm')) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || target.isContentEditable
  );
}

export function useTiledWorkbenchKeyboard(
  options: UseTiledWorkbenchKeyboardOptions,
): void {
  const {
    enabled,
    suspended = false,
    tree,
    focusedSlotId,
    focusedPtyTarget,
    passthroughArmed,
    onPassthroughArmedChange,
    onFocusSlot,
    onSplitSlot,
    onClearSlot,
    onCloseSlot,
    onOpenSlotEntry,
  } = options;

  const resolveFocusTarget = useCallback(() => {
    if (focusedSlotId) {
      return focusedSlotId;
    }
    return flattenTiledPaneTreeSlotIds(tree)[0] ?? null;
  }, [focusedSlotId, tree]);

  const handleHostShortcut = useCallback(async (
    event: KeyboardEvent,
    action: TiledWorkbenchShortcutAction,
  ) => {
    if (!action.shortcut || !matchesKeyboardShortcutEvent(event, action.shortcut)) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();

    if (passthroughArmed && focusedPtyTarget) {
      await sendPtyShortcutInput(focusedPtyTarget, action.shortcut);
      onPassthroughArmedChange(false);
      return true;
    }

    action.run();
    return true;
  }, [focusedPtyTarget, onPassthroughArmedChange, passthroughArmed]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled || suspended || event.defaultPrevented || event.metaKey || event.repeat) {
      return;
    }
    if (hasBlockingDialog() || isEditableTarget(event.target)) {
      return;
    }

    const shortcuts = getResolvedTiledWorkbenchShortcuts();
    if (
      shortcuts.passthroughTrigger
      && matchesKeyboardShortcutEvent(event, shortcuts.passthroughTrigger)
      && focusedPtyTarget
    ) {
      event.preventDefault();
      event.stopPropagation();
      onPassthroughArmedChange(!passthroughArmed);
      return;
    }

    const activeSlotId = resolveFocusTarget();
    if (!activeSlotId) {
      return;
    }

    const navigationActions: TiledWorkbenchShortcutAction[] = [
      {
        shortcut: shortcuts.focusLeft,
        run: () => {
          const next = findAdjacentTiledPaneSlot(tree, activeSlotId, 'left');
          if (next) {
            onFocusSlot(next);
          }
        },
      },
      {
        shortcut: shortcuts.focusRight,
        run: () => {
          const next = findAdjacentTiledPaneSlot(tree, activeSlotId, 'right');
          if (next) {
            onFocusSlot(next);
          }
        },
      },
      {
        shortcut: shortcuts.focusUp,
        run: () => {
          const next = findAdjacentTiledPaneSlot(tree, activeSlotId, 'up');
          if (next) {
            onFocusSlot(next);
          }
        },
      },
      {
        shortcut: shortcuts.focusDown,
        run: () => {
          const next = findAdjacentTiledPaneSlot(tree, activeSlotId, 'down');
          if (next) {
            onFocusSlot(next);
          }
        },
      },
      {
        shortcut: shortcuts.splitHorizontal,
        run: () => onSplitSlot(activeSlotId, 'horizontal'),
      },
      {
        shortcut: shortcuts.splitVertical,
        run: () => onSplitSlot(activeSlotId, 'vertical'),
      },
      {
        shortcut: shortcuts.clearSlot,
        run: () => onClearSlot(activeSlotId),
      },
      {
        shortcut: shortcuts.closeSlot,
        run: () => onCloseSlot(activeSlotId),
      },
      {
        shortcut: shortcuts.openSlotEntry,
        run: () => onOpenSlotEntry(activeSlotId),
      },
    ];

    void (async () => {
      for (const action of navigationActions) {
        if (await handleHostShortcut(event, action)) {
          return;
        }
      }
    })();
  }, [
    enabled,
    suspended,
    focusedPtyTarget,
    handleHostShortcut,
    onClearSlot,
    onCloseSlot,
    onFocusSlot,
    onOpenSlotEntry,
    onPassthroughArmedChange,
    onSplitSlot,
    passthroughArmed,
    resolveFocusTarget,
    tree,
  ]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
}
