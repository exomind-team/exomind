import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook, waitFor } from '@testing-library/react';
import type { PtyInputTarget } from '@/ui/app/components/pty-input';
import { createTemplatePaneTree, flattenTiledPaneTreeSlotIds } from '@/ui/app/pages/agents/tiled-pane-tree';
import { useTiledWorkbenchKeyboard } from '@/ui/app/pages/agents/useTiledWorkbenchKeyboard';

const ptyInputMocks = vi.hoisted(() => ({
  sendPtyShortcutInput: vi.fn(),
}));

vi.mock('@/ui/app/components/pty-input', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/app/components/pty-input')>();
  return {
    ...actual,
    sendPtyShortcutInput: ptyInputMocks.sendPtyShortcutInput,
  };
});

describe('useTiledWorkbenchKeyboard（平铺工作台键盘控制）', () => {
  const tree = createTemplatePaneTree('1x2');
  const [leftSlotId, rightSlotId] = flattenTiledPaneTreeSlotIds(tree);
  const focusedPtyTarget: PtyInputTarget = {
    rtBaseUrl: 'http://127.0.0.1:1919',
    ptyId: 'pty-keyboard-840',
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    vi.clearAllMocks();
    ptyInputMocks.sendPtyShortcutInput.mockResolvedValue(true);
  });

  it('keeps host shortcuts active while xterm has focus（终端获得焦点时宿主快捷键仍生效）', async () => {
    const onFocusSlot = vi.fn();

    renderHook(() => useTiledWorkbenchKeyboard({
      enabled: true,
      tree,
      focusedSlotId: leftSlotId,
      focusedPtyTarget,
      passthroughArmed: false,
      onPassthroughArmedChange: vi.fn(),
      onFocusSlot,
      onSplitSlot: vi.fn(),
      onClearSlot: vi.fn(),
      onCloseSlot: vi.fn(),
      onOpenSlotEntry: vi.fn(),
    }));

    const xterm = document.createElement('div');
    xterm.className = 'xterm';
    const focusedNode = document.createElement('span');
    xterm.appendChild(focusedNode);
    document.body.appendChild(xterm);

    fireEvent.keyDown(focusedNode, {
      key: 'ArrowRight',
      altKey: true,
      shiftKey: true,
      bubbles: true,
    });

    await waitFor(() => {
      expect(onFocusSlot).toHaveBeenCalledWith(rightSlotId);
    });
  });

  it('arms passthrough and sends the next shortcut to the focused PTY（透传模式会把下一键发给当前 PTY）', async () => {
    const onPassthroughArmedChange = vi.fn();
    const onSplitSlot = vi.fn();
    const { rerender } = renderHook(
      ({ passthroughArmed }: { passthroughArmed: boolean }) => useTiledWorkbenchKeyboard({
        enabled: true,
        tree,
        focusedSlotId: leftSlotId,
        focusedPtyTarget,
        passthroughArmed,
        onPassthroughArmedChange,
        onFocusSlot: vi.fn(),
        onSplitSlot,
        onClearSlot: vi.fn(),
        onCloseSlot: vi.fn(),
        onOpenSlotEntry: vi.fn(),
      }),
      {
        initialProps: { passthroughArmed: false },
      },
    );

    fireEvent.keyDown(document, {
      key: 'P',
      altKey: true,
      shiftKey: true,
    });

    expect(onPassthroughArmedChange).toHaveBeenCalledWith(true);

    rerender({ passthroughArmed: true });

    fireEvent.keyDown(document, {
      key: 'V',
      altKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(ptyInputMocks.sendPtyShortcutInput).toHaveBeenCalledWith(
        focusedPtyTarget,
        'Alt+Shift+V',
      );
    });
    expect(onSplitSlot).not.toHaveBeenCalled();
    expect(onPassthroughArmedChange).toHaveBeenLastCalledWith(false);
  });

  it('ignores shortcuts while a blocking dialog is open（弹层打开时不响应工作台快捷键）', async () => {
    const onSplitSlot = vi.fn();

    renderHook(() => useTiledWorkbenchKeyboard({
      enabled: true,
      tree,
      focusedSlotId: leftSlotId,
      focusedPtyTarget,
      passthroughArmed: false,
      onPassthroughArmedChange: vi.fn(),
      onFocusSlot: vi.fn(),
      onSplitSlot,
      onClearSlot: vi.fn(),
      onCloseSlot: vi.fn(),
      onOpenSlotEntry: vi.fn(),
    }));

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);

    fireEvent.keyDown(document, {
      key: 'V',
      altKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(onSplitSlot).not.toHaveBeenCalled();
    });
  });
});
