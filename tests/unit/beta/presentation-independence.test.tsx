import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '@/beta/BetaApp';
import { createElement } from 'react';
import type { BetaTimeblockController } from '@/beta/timeblocks-controller';
import { asyncDraftLocks } from './fixtures';
import { B, P, activeSnapshot, timeblockClient } from './timeblock-fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';

const bridge = vi.hoisted(() => ({ focus: null as BetaTimeblockController | null }));
// Capture the main client's read model, never lend it to the Native overlay.
// Independent Native execution is covered by the Host and real-window tests.
vi.mock('@/beta/BetaFocusTimer', async () => {
  const actual=await vi.importActual<typeof import('@/beta/BetaFocusTimer')>('@/beta/BetaFocusTimer');
  return {...actual,BetaFocusTimer:(props:Parameters<typeof actual.BetaFocusTimer>[0])=>{bridge.focus=props.controller;return createElement(actual.BetaFocusTimer,props);}};
});
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); bridge.focus = null;
  Object.defineProperty(navigator, 'locks', { configurable: true, value: asyncDraftLocks() });
});
afterEach(async () => {
  cleanup(); vi.useRealTimers();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks); else Reflect.deleteProperty(navigator, 'locks');
  if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden); else Reflect.deleteProperty(document, 'hidden');
  await new Promise(resolve => setTimeout(resolve, 5));
});

describe('B12-07: presentation never owns the main client data lifecycle', () => {
  it.each(['隐藏专注', '折叠专注', '简洁记录', '同步', '设置', '窗口隐藏'])('%s retains the main client and sends no implicit command', async action => {
    const client = timeblockClient(); client.profiles.mockResolvedValue([{ profile_id: P, display_name: '合成档案' }]);
    client.timeblocks.snapshot.mockResolvedValue(activeSnapshot());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    const ui = render(<BetaApp client={client} peers={null} handoffs={null} intentJournal={memoryIntentJournal()} />);
    for (let turn = 0; turn < 8 && !bridge.focus?.snapshot().remote?.active; turn++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    }
    expect(bridge.focus?.snapshot().remote?.active).toBeTruthy();
    const focus = bridge.focus!;
    const initialReads = client.timeblocks.snapshot.mock.calls.length;
    try {
      if (action === '窗口隐藏') {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        fireEvent(document, new Event('visibilitychange'));
      } else fireEvent.click(screen.getByRole('button', { name: action, exact: true }));
      await act(async () => { await vi.advanceTimersByTimeAsync(6500); });
      expect(bridge.focus).toBe(focus);
      expect(client.timeblocks.snapshot.mock.calls.length).toBeGreaterThan(initialReads);
      expect(focus.displayClock()?.stale).toBe(false);
      expect(client.timeblocks.command).not.toHaveBeenCalled();
      await act(async () => {
        await focus.control('pause',B);
        await focus.control('resume',B);
        focus.setFeedbackDraft(B,'隐藏界面后仍可反馈');await focus.flush();
        await focus.appendFeedback(B);
      });
      expect(client.timeblocks.command.mock.calls.map(([command]) => command.action.kind)).toEqual(['pause', 'resume', 'append_feedback']);
      const reads = client.timeblocks.snapshot.mock.calls.length;
      ui.unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(6500); });
      expect(client.timeblocks.snapshot).toHaveBeenCalledTimes(reads);
    } finally { ui.unmount(); }
  });
});
