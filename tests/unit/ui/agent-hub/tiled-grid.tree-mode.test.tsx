import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TiledGrid } from '@/ui/app/pages/agents/TiledGrid';
import { createTemplatePaneSlotBindings, createTemplatePaneTree } from '@/ui/app/pages/agents/tiled-pane-tree';
import type { SessionInfo } from '@/lib/types/session';

vi.mock('@/ui/app/components/PtyTerminal', () => ({
  PtyTerminal: () => <div data-testid="mock-pty-terminal">Mock PTY Terminal</div>,
}));

const TREE_MODE_DRAGGING_BODY_CLASS = 'exomind-tree-pane-dragging';

function buildSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'session-default',
    agent_kind: 'claude',
    role: 'Terminal Session',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-default',
    context: {
      issue_refs: [],
      labels: [],
    },
    created_at: '2026-04-02T00:00:00.000Z',
    last_active_at: '2026-04-02T00:00:00.000Z',
    turn_count: 0,
    ...overrides,
  };
}

function dragFromSourceToTarget(source: HTMLElement, target: HTMLElement) {
  fireEvent.pointerDown(source, {
    pointerId: 11,
    pointerType: 'mouse',
    clientX: 120,
    clientY: 80,
    isPrimary: true,
    button: 0,
  });

  fireEvent.pointerMove(window, {
    pointerId: 11,
    pointerType: 'mouse',
    clientX: 146,
    clientY: 108,
    isPrimary: true,
    buttons: 1,
  });

  fireEvent.pointerMove(target, {
    pointerId: 11,
    pointerType: 'mouse',
    clientX: 192,
    clientY: 140,
    isPrimary: true,
    buttons: 1,
  });

  fireEvent.pointerUp(target, {
    pointerId: 11,
    pointerType: 'mouse',
    clientX: 192,
    clientY: 140,
    isPrimary: true,
  });
}

function startTreeDrag(source: HTMLElement, options?: Partial<PointerEventInit>) {
  fireEvent.pointerDown(source, {
    pointerId: 11,
    pointerType: 'mouse',
    clientX: 120,
    clientY: 80,
    isPrimary: true,
    button: 0,
    ...options,
  });
}

function moveTreeDrag(target: EventTarget, options?: Partial<PointerEventInit>) {
  fireEvent.pointerMove(target, {
    pointerId: 11,
    pointerType: 'mouse',
    clientX: 146,
    clientY: 108,
    isPrimary: true,
    buttons: 1,
    ...options,
  });
}

function endTreeDrag(target: EventTarget, options?: Partial<PointerEventInit>) {
  fireEvent.pointerUp(target, {
    pointerId: 11,
    pointerType: 'mouse',
    clientX: 192,
    clientY: 140,
    isPrimary: true,
    ...options,
  });
}

function cancelTreeDrag(target: EventTarget, options?: Partial<PointerEventInit>) {
  fireEvent.pointerCancel(target, {
    pointerId: 11,
    pointerType: 'mouse',
    clientX: 192,
    clientY: 140,
    isPrimary: true,
    ...options,
  });
}

function mockElementRect(
  element: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
) {
  return vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => rect,
  } as DOMRect);
}

afterEach(() => {
  document.body.classList.remove(TREE_MODE_DRAGGING_BODY_CLASS);
  vi.restoreAllMocks();
});

describe('tiled grid tree mode（平铺树模式）', () => {
  it('renders a persistent empty slot with scoped bind and spawn actions（空窗格是持久槽位并提供作用域化绑定与新建入口）', () => {
    const onBindSessionToSlot = vi.fn();
    const onSpawnInSlot = vi.fn();

    render(
      <TiledGrid
        sessions={[]}
        layout="1x1"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={null}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x1')}
        paneSlots={createTemplatePaneSlotBindings('1x1')}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
        unassignedSessions={[
          buildSession({
            id: 'session-unassigned',
            role: 'Unassigned Session',
          }),
        ]}
        onBindSessionToSlot={onBindSessionToSlot}
        onSpawnInSlot={onSpawnInSlot}
      />,
    );

    const slot = screen.getByTestId('tiled-slot-slot-1');
    within(slot).getByText('空窗格');
    expect(slot.className).toContain('h-full');
    expect(slot.className).toContain('min-h-0');
    within(slot).getByRole('button', { name: '新建终端' }).click();
    within(slot).getByRole('button', { name: '绑定 Unassigned Session' }).click();

    expect(onSpawnInSlot).toHaveBeenCalledWith('slot-1');
    expect(onBindSessionToSlot).toHaveBeenCalledWith('slot-1', 'session-unassigned');
  });

  it('routes split, clear, and close actions through slot-scoped callbacks（分割、清空、关闭都作用于当前槽位）', () => {
    const onSplitSlot = vi.fn();
    const onClearSlot = vi.fn();
    const onCloseSlot = vi.fn();

    render(
      <TiledGrid
        sessions={[
          buildSession({
            id: 'session-slot-1',
            role: 'Slot 1 Session',
            pty_id: 'pty-slot-1',
          }),
        ]}
        layout="1x1"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x1')}
        paneSlots={[
          { slotId: 'slot-1', sessionId: 'session-slot-1' },
        ]}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
        onSplitSlot={onSplitSlot}
        onClearSlot={onClearSlot}
        onCloseSlot={onCloseSlot}
      />,
    );

    const slot = screen.getByTestId('tiled-slot-slot-1');
    expect(slot.className).toContain('min-h-0');
    expect(within(slot).getByTestId('mock-pty-terminal')).toBeInTheDocument();
    within(slot).getByTitle('垂直分割').click();
    within(slot).getByTitle('清空窗格').click();
    within(slot).getByTitle('关闭窗格').click();

    expect(onSplitSlot).toHaveBeenCalledWith('slot-1', 'vertical');
    expect(onClearSlot).toHaveBeenCalledWith('slot-1');
    expect(onCloseSlot).toHaveBeenCalledWith('slot-1');
  });

  it('refreshes empty-slot bind actions when the unassigned pool changes after first render（未分配会话池变化后空窗格绑定按钮应更新）', () => {
    const firstAssign = vi.fn();
    const secondAssign = vi.fn();
    const rendered = render(
      <TiledGrid
        sessions={[]}
        layout="1x1"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={null}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x1')}
        paneSlots={createTemplatePaneSlotBindings('1x1')}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
        unassignedSessions={[
          buildSession({
            id: 'session-first',
            role: 'First Session',
          }),
        ]}
        onBindSessionToSlot={firstAssign}
      />,
    );

    const slot = screen.getByTestId('tiled-slot-slot-1');
    within(slot).getByRole('button', { name: '绑定 First Session' }).click();
    expect(firstAssign).toHaveBeenCalledWith('slot-1', 'session-first');

    rendered.rerender(
      <TiledGrid
        sessions={[]}
        layout="1x1"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={null}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x1')}
        paneSlots={createTemplatePaneSlotBindings('1x1')}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
        unassignedSessions={[
          buildSession({
            id: 'session-second',
            role: 'Second Session',
          }),
        ]}
        onBindSessionToSlot={secondAssign}
      />,
    );

    const updatedSlot = screen.getByTestId('tiled-slot-slot-1');
    expect(within(updatedSlot).queryByRole('button', { name: '绑定 First Session' })).not.toBeInTheDocument();
    within(updatedSlot).getByRole('button', { name: '绑定 Second Session' }).click();

    expect(firstAssign).toHaveBeenCalledTimes(1);
    expect(secondAssign).toHaveBeenCalledWith('slot-1', 'session-second');
  });

  it('keeps disconnected panes shrink-safe like live panes（断开窗格也保留 min-h-0 以避免高度链断裂）', () => {
    render(
      <TiledGrid
        sessions={[]}
        layout="1x1"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x1')}
        paneSlots={[
          { slotId: 'slot-1', sessionId: 'session-missing' },
        ]}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
      />,
    );

    const slot = screen.getByTestId('tiled-slot-slot-1');
    expect(slot.className).toContain('min-h-0');
    expect(within(slot).getByText('会话已断开')).toBeInTheDocument();
  });

  it('does not introduce a dedicated drag-handle button in tree mode（树模式不应引入额外拖拽把手按钮）', () => {
    render(
      <TiledGrid
        sessions={[
          buildSession({
            id: 'session-drag-source',
            role: 'Drag Source Session',
            pty_id: 'pty-drag-source',
          }),
        ]}
        layout="1x1"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x1')}
        paneSlots={[
          { slotId: 'slot-1', sessionId: 'session-drag-source' },
        ]}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
      />,
    );

    const slot = screen.getByTestId('tiled-slot-slot-1');
    expect(within(slot).queryByRole('button', { name: '拖拽会话窗格' })).not.toBeInTheDocument();
  });

  it('shows grab affordance on draggable header background while keeping title text out of the drag cursor hint（可拖头栏背景应显示拖拽暗示，但文本区域不应伪装成拖拽把手）', () => {
    render(
      <TiledGrid
        sessions={[
          buildSession({
            id: 'session-live',
            role: 'Live Session',
            pty_id: 'pty-live',
          }),
        ]}
        layout="1x2"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x2')}
        paneSlots={[
          { slotId: 'slot-1', sessionId: 'session-live' },
          {
            slotId: 'slot-2',
            terminalRecovery: {
              sessionId: 'recoverable-session',
              sourceHostId: 'runtime-host-1',
              agentType: 'claude',
              innerSessionId: 'recoverable-inner',
              role: 'Recoverable Terminal',
              workdir: 'D:/project/exomind',
              projectPathKey: 'd:/project/exomind',
            },
          },
        ]}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
        onMoveSessionBetweenSlots={vi.fn()}
      />,
    );

    expect(screen.getByTestId('tiled-slot-header-slot-1')).toHaveAttribute('title', '拖动以移动/换位此窗格');
    expect(screen.getByTestId('tiled-slot-header-slot-1').className).toContain('cursor-grab');
    expect(screen.getByTestId('tiled-slot-header-slot-2')).toHaveAttribute('title', '拖动以移动/换位此窗格');
    expect(screen.getByTestId('tiled-slot-header-slot-2').className).toContain('cursor-grab');
    expect(within(screen.getByTestId('tiled-slot-slot-1')).getByText('Live Session').className).toContain('cursor-text');
    expect(within(screen.getByTestId('tiled-slot-header-slot-2')).getByText('可恢复终端').className).toContain('cursor-text');
  });

  it('reports a tree-mode move when dragging from the PTY titlebar background into an empty slot（树模式从 PTY 顶栏文本外背景区域拖到空窗格应上报 slot-to-slot move）', async () => {
    const onMoveSessionBetweenSlots = vi.fn();
    const props: any = {
      sessions: [
        buildSession({
          id: 'session-drag-source',
          role: 'Drag Source Session',
          pty_id: 'pty-drag-source',
        }),
      ],
      layout: '1x2',
      resolveSessionConnection: () => ({
        rtBaseUrl: 'http://127.0.0.1:1949',
      }),
      focusedIndex: 0,
      onFocusPane: vi.fn(),
      paneTree: createTemplatePaneTree('1x2'),
      paneSlots: [
        { slotId: 'slot-1', sessionId: 'session-drag-source' },
        { slotId: 'slot-2' },
      ],
      focusedSlotId: 'slot-1',
      onFocusSlot: vi.fn(),
      onMoveSessionBetweenSlots,
    };

    render(<TiledGrid {...props} />);

    const sourceSlot = screen.getByTestId('tiled-slot-slot-1');
    const headerChrome = sourceSlot.firstElementChild as HTMLElement | null;
    expect(headerChrome).not.toBeNull();

    dragFromSourceToTarget(
      headerChrome!,
      screen.getByTestId('tiled-slot-slot-2'),
    );

    await waitFor(() => {
      expect(onMoveSessionBetweenSlots).toHaveBeenCalledWith('slot-1', 'slot-2');
    });
  });

  it('reports a tree-mode move when dragging a recoverable pane from its header background into an empty slot（可恢复终端也应能从头栏背景拖到空窗格）', async () => {
    const onMoveSessionBetweenSlots = vi.fn();

    render(
      <TiledGrid
        sessions={[]}
        layout="1x2"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x2')}
        paneSlots={[
          {
            slotId: 'slot-1',
            terminalRecovery: {
              sessionId: 'recoverable-session',
              sourceHostId: 'runtime-host-1',
              agentType: 'claude',
              innerSessionId: 'recoverable-inner',
              role: 'Recoverable Terminal',
              workdir: 'D:/project/exomind',
              projectPathKey: 'd:/project/exomind',
            },
          },
          { slotId: 'slot-2' },
        ]}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
        onMoveSessionBetweenSlots={onMoveSessionBetweenSlots}
      />,
    );

    dragFromSourceToTarget(
      screen.getByTestId('tiled-slot-header-slot-1'),
      screen.getByTestId('tiled-slot-slot-2'),
    );

    await waitFor(() => {
      expect(onMoveSessionBetweenSlots).toHaveBeenCalledWith('slot-1', 'slot-2');
    });
  });

  it('treats recoverable panes as valid swap targets for tree-mode dragging（可恢复终端应能作为换位目标）', async () => {
    const onMoveSessionBetweenSlots = vi.fn();

    render(
      <TiledGrid
        sessions={[
          buildSession({
            id: 'session-drag-source',
            role: 'Drag Source Session',
            pty_id: 'pty-drag-source',
          }),
        ]}
        layout="1x2"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x2')}
        paneSlots={[
          { slotId: 'slot-1', sessionId: 'session-drag-source' },
          {
            slotId: 'slot-2',
            terminalRecovery: {
              sessionId: 'recoverable-session',
              sourceHostId: 'runtime-host-1',
              agentType: 'claude',
              innerSessionId: 'recoverable-inner',
              role: 'Recoverable Terminal',
              workdir: 'D:/project/exomind',
              projectPathKey: 'd:/project/exomind',
            },
          },
        ]}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
        onMoveSessionBetweenSlots={onMoveSessionBetweenSlots}
      />,
    );

    dragFromSourceToTarget(
      screen.getByTestId('tiled-slot-header-slot-1'),
      screen.getByTestId('tiled-slot-slot-2'),
    );

    await waitFor(() => {
      expect(onMoveSessionBetweenSlots).toHaveBeenCalledWith('slot-1', 'slot-2');
    });
  });

  it('does not start a drag when the gesture begins on header text（从顶栏文本发起手势不应触发拖拽）', async () => {
    const onMoveSessionBetweenSlots = vi.fn();

    render(
      <TiledGrid
        sessions={[
          buildSession({
            id: 'session-drag-source',
            role: 'Drag Source Session',
            pty_id: 'pty-drag-source',
          }),
        ]}
        layout="1x2"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x2')}
        paneSlots={[
          { slotId: 'slot-1', sessionId: 'session-drag-source' },
          { slotId: 'slot-2' },
        ]}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
        onMoveSessionBetweenSlots={onMoveSessionBetweenSlots}
      />,
    );

    dragFromSourceToTarget(
      within(screen.getByTestId('tiled-slot-slot-1')).getByText('Drag Source Session'),
      screen.getByTestId('tiled-slot-slot-2'),
    );

    await waitFor(() => {
      expect(onMoveSessionBetweenSlots).not.toHaveBeenCalled();
    });
  });

  it('does not start a drag when the gesture begins on a header button（从顶栏按钮发起手势不应触发拖拽）', async () => {
    const onMoveSessionBetweenSlots = vi.fn();

    render(
      <TiledGrid
        sessions={[
          buildSession({
            id: 'session-drag-source',
            role: 'Drag Source Session',
            pty_id: 'pty-drag-source',
          }),
        ]}
        layout="1x2"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x2')}
        paneSlots={[
          { slotId: 'slot-1', sessionId: 'session-drag-source' },
          { slotId: 'slot-2' },
        ]}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
        onMoveSessionBetweenSlots={onMoveSessionBetweenSlots}
      />,
    );

    dragFromSourceToTarget(
      within(screen.getByTestId('tiled-slot-slot-1')).getByRole('button', {
        name: '全屏',
      }),
      screen.getByTestId('tiled-slot-slot-2'),
    );

    await waitFor(() => {
      expect(onMoveSessionBetweenSlots).not.toHaveBeenCalled();
    });
  });

  it('shows a mouse-following drag preview with a stable pointer offset and hovered-slot highlight only after activation（超过阈值后才显示跟手预览，且保持鼠标相对位置不变）', async () => {
    const onMoveSessionBetweenSlots = vi.fn();
    const removeAllRanges = vi.fn();
    vi.spyOn(window, 'getSelection').mockReturnValue({
      removeAllRanges,
    } as unknown as Selection);

    render(
      <TiledGrid
        sessions={[
          buildSession({
            id: 'session-drag-source',
            role: 'Drag Source Session',
            pty_id: 'pty-drag-source',
          }),
        ]}
        layout="1x2"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x2')}
        paneSlots={[
          { slotId: 'slot-1', sessionId: 'session-drag-source' },
          { slotId: 'slot-2' },
        ]}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
        onMoveSessionBetweenSlots={onMoveSessionBetweenSlots}
      />,
    );

    const sourceSlot = screen.getByTestId('tiled-slot-slot-1');
    const sourceHeader = screen.getByTestId('tiled-slot-header-slot-1');
    const targetSlot = screen.getByTestId('tiled-slot-slot-2');
    mockElementRect(sourceSlot, {
      left: 40,
      top: 50,
      width: 320,
      height: 240,
    });

    startTreeDrag(sourceHeader, {
      clientX: 120,
      clientY: 80,
    });

    moveTreeDrag(window, {
      clientX: 125,
      clientY: 84,
    });

    expect(screen.queryByTestId('tiled-grid-tree-drag-preview')).not.toBeInTheDocument();
    expect(document.body).not.toHaveClass(TREE_MODE_DRAGGING_BODY_CLASS);
    expect(removeAllRanges).not.toHaveBeenCalled();
    expect(targetSlot).not.toHaveAttribute('data-tree-drag-hovered');

    moveTreeDrag(targetSlot, {
      clientX: 230,
      clientY: 190,
    });

    const preview = screen.getByTestId('tiled-grid-tree-drag-preview');
    expect(preview).toHaveTextContent('Drag Source Session');
    expect(preview).toHaveStyle({
      left: '150px',
      top: '160px',
      width: '320px',
      height: '240px',
    });
    expect(document.body).toHaveClass(TREE_MODE_DRAGGING_BODY_CLASS);
    expect(removeAllRanges).toHaveBeenCalled();
    expect(screen.getByTestId('tiled-slot-slot-2')).toHaveAttribute('data-tree-drag-hovered', 'true');

    moveTreeDrag(targetSlot, {
      clientX: 260,
      clientY: 210,
    });

    expect(screen.getByTestId('tiled-grid-tree-drag-preview')).toHaveStyle({
      left: '180px',
      top: '180px',
    });

    endTreeDrag(targetSlot, {
      clientX: 260,
      clientY: 210,
    });

    await waitFor(() => {
      expect(onMoveSessionBetweenSlots).toHaveBeenCalledWith('slot-1', 'slot-2');
    });

    expect(screen.queryByTestId('tiled-grid-tree-drag-preview')).not.toBeInTheDocument();
    expect(document.body).not.toHaveClass(TREE_MODE_DRAGGING_BODY_CLASS);
    expect(screen.getByTestId('tiled-slot-slot-2')).not.toHaveAttribute('data-tree-drag-hovered');
  });

  it('cleans preview, hover, and body no-select state on pointercancel without dispatching a move（取消拖拽时必须清理状态且不触发换位）', () => {
    const onMoveSessionBetweenSlots = vi.fn();
    const removeAllRanges = vi.fn();
    vi.spyOn(window, 'getSelection').mockReturnValue({
      removeAllRanges,
    } as unknown as Selection);

    render(
      <TiledGrid
        sessions={[
          buildSession({
            id: 'session-drag-source',
            role: 'Drag Source Session',
            pty_id: 'pty-drag-source',
          }),
        ]}
        layout="1x2"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x2')}
        paneSlots={[
          { slotId: 'slot-1', sessionId: 'session-drag-source' },
          { slotId: 'slot-2' },
        ]}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
        onMoveSessionBetweenSlots={onMoveSessionBetweenSlots}
      />,
    );

    const sourceSlot = screen.getByTestId('tiled-slot-slot-1');
    const sourceHeader = screen.getByTestId('tiled-slot-header-slot-1');
    const targetSlot = screen.getByTestId('tiled-slot-slot-2');
    mockElementRect(sourceSlot, {
      left: 40,
      top: 50,
      width: 320,
      height: 240,
    });

    startTreeDrag(sourceHeader, {
      clientX: 120,
      clientY: 80,
    });
    moveTreeDrag(targetSlot, {
      clientX: 230,
      clientY: 190,
    });

    expect(screen.getByTestId('tiled-grid-tree-drag-preview')).toBeInTheDocument();
    expect(document.body).toHaveClass(TREE_MODE_DRAGGING_BODY_CLASS);
    expect(targetSlot).toHaveAttribute('data-tree-drag-hovered', 'true');
    expect(removeAllRanges).toHaveBeenCalled();

    cancelTreeDrag(targetSlot, {
      clientX: 230,
      clientY: 190,
    });

    expect(onMoveSessionBetweenSlots).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tiled-grid-tree-drag-preview')).not.toBeInTheDocument();
    expect(document.body).not.toHaveClass(TREE_MODE_DRAGGING_BODY_CLASS);
    expect(screen.getByTestId('tiled-slot-slot-2')).not.toHaveAttribute('data-tree-drag-hovered');
  });

  it('cancels an active tree drag on window blur so no-select state cannot leak（窗口失焦时应取消拖拽并清理全局状态）', () => {
    const onMoveSessionBetweenSlots = vi.fn();

    render(
      <TiledGrid
        sessions={[
          buildSession({
            id: 'session-drag-source',
            role: 'Drag Source Session',
            pty_id: 'pty-drag-source',
          }),
        ]}
        layout="1x2"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        paneTree={createTemplatePaneTree('1x2')}
        paneSlots={[
          { slotId: 'slot-1', sessionId: 'session-drag-source' },
          { slotId: 'slot-2' },
        ]}
        focusedSlotId="slot-1"
        onFocusSlot={vi.fn()}
        onMoveSessionBetweenSlots={onMoveSessionBetweenSlots}
      />,
    );

    const sourceSlot = screen.getByTestId('tiled-slot-slot-1');
    const sourceHeader = screen.getByTestId('tiled-slot-header-slot-1');
    mockElementRect(sourceSlot, {
      left: 40,
      top: 50,
      width: 320,
      height: 240,
    });

    startTreeDrag(sourceHeader, {
      clientX: 120,
      clientY: 80,
    });
    moveTreeDrag(screen.getByTestId('tiled-slot-slot-2'), {
      clientX: 230,
      clientY: 190,
    });

    expect(screen.getByTestId('tiled-grid-tree-drag-preview')).toBeInTheDocument();
    expect(document.body).toHaveClass(TREE_MODE_DRAGGING_BODY_CLASS);

    fireEvent.blur(window);

    expect(onMoveSessionBetweenSlots).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tiled-grid-tree-drag-preview')).not.toBeInTheDocument();
    expect(document.body).not.toHaveClass(TREE_MODE_DRAGGING_BODY_CLASS);
    expect(screen.getByTestId('tiled-slot-slot-2')).not.toHaveAttribute('data-tree-drag-hovered');
  });
});
