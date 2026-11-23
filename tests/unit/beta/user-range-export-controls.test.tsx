import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BetaUserRangeExportControls } from '../../../src/beta/BetaUserRangeExportControls';
import type { UserRangeExportSnapshot, UserRangeExportStateController } from '../../../src/beta/user-range-export-state';

const PROFILE = '33333333-3333-4333-8333-333333333333';
const REQUEST = '55555555-5555-4555-8555-555555555555';
const EVENT = '66666666-6666-4666-8666-666666666666';
function fixture() {
  const state = {
    ready: true, supported: true, storageReady: true, profile_id: PROFILE,
    selections: [{ kind: 'event', event_id: EVENT }], task: null, error: null,
  } as UserRangeExportSnapshot;
  const actions = { startExport: vi.fn(async () => {}), confirmNewRequestAfterUnknown: vi.fn(async () => {}),
    resetSelections: vi.fn(), removeSelection: vi.fn(), refreshStatus: vi.fn(), requestCancel: vi.fn() };
  return { state, actions, owner: actions as unknown as UserRangeExportStateController };
}

describe('selected export controls disclosure', () => {
  it('exposes a stable mode switch and reports the selected count in browse and export modes', () => {
    const { state, owner } = fixture();
    const onModeChange = vi.fn();
    const view = render(<BetaUserRangeExportControls state={state} owner={owner} mode="browse" onModeChange={onModeChange} />);
    expect(screen.getByTestId('beta-user-range-export-controls').firstElementChild?.className).toContain('flex-wrap');
    const entry = screen.getByRole('button', { name: '选择并导出 · 已选 1 项' });
    expect(entry).toHaveAttribute('aria-expanded', 'false');
    expect(entry).not.toHaveAttribute('aria-pressed');
    expect(entry.className).toContain('[@media(pointer:coarse)]:min-h-11');
    expect(entry.className).toContain('touch-manipulation');
    expect(screen.queryByRole('button', { name: '导出所选内容' })).toBeNull();
    fireEvent.click(entry);
    expect(onModeChange).toHaveBeenCalledWith('select-export');
    view.rerender(<BetaUserRangeExportControls state={state} owner={owner} mode="select-export" onModeChange={onModeChange} />);
    expect(screen.getByRole('button', { name: '退出选择导出 · 已选 1 项' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(/选择导出模式 · 33333333 · 浏览周期变化或退出后保留已选内容/);
    expect(screen.getByRole('status')).not.toHaveTextContent('已选 1 项');
    const exportButton = screen.getByRole('button', { name: '导出所选内容' });
    expect(exportButton).toBeEnabled();
    expect(exportButton.className).toContain('[@media(pointer:coarse)]:min-h-11');
    expect(exportButton.className).toContain('touch-manipulation');
    fireEvent.click(screen.getByRole('button', { name: '退出选择导出 · 已选 1 项' }));
    expect(onModeChange).toHaveBeenLastCalledWith('browse');
    expect(screen.getByText(/浏览周期变化或退出后保留已选内容/)).toBeVisible();
    expect(state.selections).toHaveLength(1);
  });

  it('waits for explicit confirmation and keeps file verification details optional', () => {
    const { state, owner, actions } = fixture();
    const view = render(<BetaUserRangeExportControls state={state} owner={owner} mode="select-export" onModeChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '导出所选内容' }));
    expect(actions.startExport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续并选择保存位置' }));
    expect(actions.startExport).toHaveBeenCalledTimes(1);
    const hash = 'a'.repeat(64);
    const next = { ...state, task: {
      version: 1, request_id: REQUEST, profile_id: PROFILE, device_id: EVENT, runtime_id: EVENT,
      selections: state.selections, phase: 'saved', message: null, cancelAccepted: null,
      result: { request_id: REQUEST, profile_id: PROFILE, phase: 'saved', content_complete: true,
        partial_output: false, included_originals: 1, omitted_originals: 0,
        archive_byte_length: 4096, archive_sha256: hash, failure_code: null },
    } } as UserRangeExportSnapshot;
    view.rerender(<BetaUserRangeExportControls state={next} owner={owner} mode="select-export" onModeChange={vi.fn()} />);
    expect(screen.queryByText(hash)).toBeNull();
    expect(screen.queryByText(REQUEST, { exact: false })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看校验详情' }));
    expect(screen.getByText(hash)).toBeVisible();
    expect(screen.getByText(REQUEST, { exact: false })).toBeVisible();
  });

  it('does not describe a cancelled export as a partial package that can be inspected', () => {
    const { state, owner } = fixture();
    const cancelled = { ...state, task: {
      version: 1, request_id: REQUEST, profile_id: PROFILE, device_id: EVENT, runtime_id: EVENT,
      selections: state.selections, phase: 'cancelled', message: '导出已取消',
      cancelAccepted: true,
      result: { request_id: REQUEST, profile_id: PROFILE, phase: 'cancelled',
        content_complete: false, partial_output: false, included_originals: 4,
        omitted_originals: 0, archive_byte_length: null, archive_sha256: null,
        failure_code: 'cancelled' },
    } } as UserRangeExportSnapshot;
    render(<BetaUserRangeExportControls state={cancelled} owner={owner} mode="select-export" onModeChange={vi.fn()} />);

    expect(screen.getByText('已取消')).toBeVisible();
    expect(screen.getByText('本次未生成可核对的导出包。')).toBeVisible();
    expect(screen.queryByText('部分内容未包含，请查看包内清单。')).toBeNull();
    expect(screen.queryByText(/本机原件：包含/)).toBeNull();
    expect(screen.queryByText('未包含的附件请查看包内清单。')).toBeNull();
  });
});
