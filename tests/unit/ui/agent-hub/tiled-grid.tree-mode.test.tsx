import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TiledGrid } from '@/ui/app/pages/agents/TiledGrid';
import { createTemplatePaneSlotBindings, createTemplatePaneTree } from '@/ui/app/pages/agents/tiled-pane-tree';
import type { SessionInfo } from '@/lib/types/session';

vi.mock('@/ui/app/components/PtyTerminal', () => ({
  PtyTerminal: () => <div data-testid="mock-pty-terminal">Mock PTY Terminal</div>,
}));

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
});
