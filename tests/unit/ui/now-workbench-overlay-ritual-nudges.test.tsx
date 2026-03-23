import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildNowWorkbenchOverlayModel } from '@/ui/app/overlay/now-workbench-overlay-model';
import { NowWorkbenchOverlayPage } from '@/pages/NowWorkbenchOverlayPage';

vi.mock('@/ui/app/components/NowInputRow', () => ({
  NowInputRow: () => <div data-testid="new-now-input-row">mock-now-input-row</div>,
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
}));

describe('overlay ritual nudges（悬浮窗仪式提醒）', () => {
  it('shows shutdown nudge when the day is ready to close（待收工时生成收工提醒）', () => {
    const model = buildNowWorkbenchOverlayModel({
      activeBlock: null,
      tasks: [],
      events: [],
      now: Date.UTC(2026, 2, 19, 21, 30, 0),
      ritual: { stage: 'shutdown_ready' },
    });

    expect(model.nudge?.kind).toBe('shutdown_ready');
  });

  it('renders the ritual nudge card above overlay content（悬浮窗渲染提醒卡）', () => {
    const model = buildNowWorkbenchOverlayModel({
      activeBlock: null,
      tasks: [],
      events: [],
      now: Date.UTC(2026, 2, 19, 21, 30, 0),
      ritual: { stage: 'shutdown_ready' },
    });

    render(<NowWorkbenchOverlayPage model={model} />);

    expect(screen.getByTestId('now-overlay-ritual-nudge')).toBeInTheDocument();
    expect(screen.getByText('准备收工')).toBeInTheDocument();
  });
});
