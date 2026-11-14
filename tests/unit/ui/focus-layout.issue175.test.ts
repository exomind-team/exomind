import { createElement, type ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusPage } from '@/ui/app/pages/FocusPage';

const { gate, nowPage, directChat } = vi.hoisted(() => ({
  gate: { open: false }, nowPage: vi.fn(), directChat: vi.fn(),
}));
// Actual profile selection/login behavior is covered by local-profile-guard.
// These probes protect the composition: the guard owns NowPage mounting and
// FocusPage must not render a second ChatPage directly.
vi.mock('@/ui/app/components/LocalProfileGuard', () => ({
  LocalProfileGuard: ({ children }: { children: ReactNode }) => gate.open
    ? createElement('section', { 'data-testid': 'profile-guard-content' }, children)
    : createElement('p', null, 'guard is waiting for a profile'),
}));
vi.mock('@/ui/app/pages/NowPage', () => ({
  NowPage: () => { nowPage(); return createElement('div', { 'data-testid': 'now-page-content' }); },
}));
vi.mock('@/components/Chat/ChatPage', () => ({
  ChatPage: () => { directChat(); return createElement('div', { 'data-testid': 'unexpected-direct-chat' }); },
}));

beforeEach(() => { gate.open = false; vi.clearAllMocks(); });
afterEach(cleanup);

describe('FocusPage delegates to the guarded NowPage', () => {
  it('does not mount record/timer content before its profile guard opens', () => {
    const { rerender } = render(createElement(FocusPage));
    expect(screen.getByText('guard is waiting for a profile')).toBeInTheDocument();
    expect(nowPage).not.toHaveBeenCalled();
    expect(directChat).not.toHaveBeenCalled();
    gate.open = true; rerender(createElement(FocusPage));
    expect(within(screen.getByTestId('profile-guard-content')).getByTestId('now-page-content')).toBeInTheDocument();
  });

  it('mounts the existing NowPage without adding a separate ChatPage layout', () => {
    gate.open = true; render(createElement(FocusPage));
    expect(screen.getAllByTestId('now-page-content')).toHaveLength(1);
    expect(directChat).not.toHaveBeenCalled();
    expect(screen.queryByTestId('unexpected-direct-chat')).not.toBeInTheDocument();
  });
});
