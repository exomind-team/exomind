import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaOriginalExportCenter } from '@/beta/BetaOriginalExportCenter';
import { exportOriginalDownload } from '@/beta/original-download';
import {
  nativeOriginalExports,
  type BetaOriginalExportHistoryEntry,
  type BetaOriginalExportResult,
  type BetaOriginalExportsClient,
} from '@/beta/original-export';
import { OriginalExportTasks, originalExportTasks } from '@/beta/original-export-tasks';
import type { BetaOriginal } from '@/beta/original-types';
import { deferred, fakeClient } from './fixtures';

const PROFILE = '10000000-0000-4000-8000-000000000001';
const OTHER_PROFILE = '10000000-0000-4000-8000-000000000002';
const ORIGINAL_ID = '20000000-0000-4000-8000-000000000001';
const OLD_REQUEST = '30000000-0000-4000-8000-000000000001';
const SHA256 = 'b'.repeat(64);
const INTERRUPTED_MESSAGE = '上次导出未确认，所选位置可能留有空/未完成文档，原件保留';

function historyEntry(patch: Partial<BetaOriginalExportHistoryEntry> = {}): BetaOriginalExportHistoryEntry {
  const phase = patch.phase ?? 'interrupted';
  const requiresFailureCode = phase === 'cancelled' || phase === 'failed' || phase === 'interrupted';
  return {
    request_id: OLD_REQUEST,
    profile_id: PROFILE,
    original_id: ORIGINAL_ID,
    file_name: 'recovered.raw',
    byte_length: 8192,
    sha256: SHA256,
    phase,
    failure_code: requiresFailureCode ? 'native_interrupted' : null,
    partial_output: phase === 'writing' || phase === 'verifying',
    ...patch,
  };
}

function exportClient(overrides: Partial<BetaOriginalExportsClient> = {}): BetaOriginalExportsClient {
  return {
    save: vi.fn(async () => ({ cancelled: false, byte_length: 8192, sha256: SHA256 })),
    cancel: vi.fn(async () => true),
    history: vi.fn(async () => []),
    ...overrides,
  };
}

function original(): BetaOriginal {
  return {
    original_id: ORIGINAL_ID,
    file_name: 'recovered.raw',
    byte_length: 8192,
    sha256: SHA256,
    media_type: 'application/octet-stream',
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Native original export recovery', () => {
  it('reads the fixed history command and rejects cross-profile or malformed history', async () => {
    const wrongScopeCall = vi.fn(async () => [historyEntry({ profile_id: OTHER_PROFILE })]);
    const wrongScope = nativeOriginalExports(wrongScopeCall as Parameters<typeof nativeOriginalExports>[0]);
    await expect(wrongScope.history!(PROFILE)).rejects.toMatchObject({ code: 'invalid_export_response' });

    const malformedCall = vi.fn(async () => [{ ...historyEntry(), unexpected: 'field' }]);
    const malformed = nativeOriginalExports(malformedCall as Parameters<typeof nativeOriginalExports>[0]);
    await expect(malformed.history!(PROFILE)).rejects.toMatchObject({ code: 'invalid_export_response' });

    const call = vi.fn(async () => [historyEntry()]);
    const valid = nativeOriginalExports(call as Parameters<typeof nativeOriginalExports>[0]);
    await expect(valid.history!(PROFILE)).resolves.toEqual([historyEntry()]);
    expect(call).toHaveBeenCalledWith('beta_original_export_history', { profileId: PROFILE });
  });

  it('accepts a non-nil standard UUID without assuming RFC version or variant bits', async () => {
    const profileId = '00000000-0000-0000-0000-000000000001';
    const entry = historyEntry({
      request_id: '00000000-0000-0000-0000-000000000002',
      profile_id: profileId,
      original_id: '00000000-0000-0000-0000-000000000003',
    });
    const call = vi.fn(async () => [entry]);
    const native = nativeOriginalExports(call as Parameters<typeof nativeOriginalExports>[0]);

    await expect(native.history!(profileId)).resolves.toEqual([entry]);
    await expect(native.history!('00000000-0000-0000-0000-000000000000'))
      .rejects.toMatchObject({ code: 'invalid_export_response' });
  });

  it('matches Native journal length and phase constraints for metadata', async () => {
    const invalidWritingCall = vi.fn(async () => [historyEntry({ phase: 'writing', partial_output: false })]);
    const invalidWritingResult = nativeOriginalExports(invalidWritingCall as Parameters<typeof nativeOriginalExports>[0]);
    await expect(invalidWritingResult.history!(PROFILE))
      .rejects.toMatchObject({ code: 'invalid_export_response' });

    const overlongNameCall = vi.fn(async () => [historyEntry({ file_name: '界'.repeat(1366) })]);
    const overlongUtf8Name = nativeOriginalExports(overlongNameCall as Parameters<typeof nativeOriginalExports>[0]);
    await expect(overlongUtf8Name.history!(PROFILE))
      .rejects.toMatchObject({ code: 'invalid_export_response' });
  });

  it('rebuilds an interrupted task after owner loss and starts a fresh save request from Native metadata', async () => {
    const blob = vi.spyOn(globalThis, 'Blob');
    const native = exportClient({ history: vi.fn(async () => [historyEntry()]) });
    const client = { ...fakeClient(), originalExports: native };
    const owner = originalExportTasks(client);

    render(<BetaOriginalExportCenter client={client} profileId={PROFILE} />);
    await waitFor(() => expect(native.history).toHaveBeenCalledWith(PROFILE));
    fireEvent.click(screen.getByRole('button', { name: '附件导出任务' }));
    expect(await screen.findByText(INTERRUPTED_MESSAGE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新选择保存位置' }));

    await waitFor(() => expect(native.save).toHaveBeenCalledTimes(1));
    const newRequest = vi.mocked(native.save).mock.calls[0][2];
    expect(newRequest).not.toBe(OLD_REQUEST);
    expect(native.save).toHaveBeenCalledWith(PROFILE, ORIGINAL_ID, newRequest);
    await screen.findByText('原件已导出并完成校验');
    expect(blob).not.toHaveBeenCalled();
    expect(owner.snapshot().some(task => task.requestId === OLD_REQUEST && task.phase === 'interrupted')).toBe(true);
  });

  it('does not let late history replace a task started while the read was pending', async () => {
    const historyGate = deferred<BetaOriginalExportHistoryEntry[]>();
    const saveGate = deferred<BetaOriginalExportResult>();
    const native = exportClient({
      history: vi.fn(() => historyGate.promise),
      save: vi.fn(() => saveGate.promise),
    });
    const owner = new OriginalExportTasks({ ...fakeClient(), originalExports: native });
    const restoring = owner.restoreHistory(PROFILE);

    const requestId = owner.start(PROFILE, original());
    historyGate.resolve([historyEntry({ request_id: requestId, phase: 'writing' })]);
    await restoring;
    expect(owner.snapshot()).toContainEqual(expect.objectContaining({
      requestId,
      phase: 'running',
      message: '正在流式导出并校验原件…',
    }));
    saveGate.resolve({ cancelled: true, partial_output: false });
  });

  it('does not let late active history replace a terminal result', async () => {
    const historyGate = deferred<BetaOriginalExportHistoryEntry[]>();
    const native = exportClient({ history: vi.fn(() => historyGate.promise) });
    const owner = new OriginalExportTasks({ ...fakeClient(), originalExports: native });
    const restoring = owner.restoreHistory(PROFILE);

    const requestId = owner.start(PROFILE, original());
    await waitFor(() => expect(owner.snapshot().find(task => task.requestId === requestId)?.phase).toBe('succeeded'));
    historyGate.resolve([historyEntry({ request_id: requestId, phase: 'writing' })]);
    await restoring;
    expect(owner.snapshot()).toContainEqual(expect.objectContaining({
      requestId,
      phase: 'succeeded',
      message: '原件已导出并完成校验',
    }));
  });

  it('maps every Native active phase to a pending task', async () => {
    for (const phase of ['preparing', 'awaiting_destination', 'writing', 'verifying'] as const) {
      const native = exportClient({ history: vi.fn(async () => [historyEntry({ phase })]) });
      const owner = new OriginalExportTasks({ ...fakeClient(), originalExports: native });
      await owner.restoreHistory(PROFILE);
      expect(owner.snapshot()).toContainEqual(expect.objectContaining({
        requestId: OLD_REQUEST,
        phase: 'running',
        cancelPending: false,
      }));
    }
  });

  it('keeps current tasks after a failed history read and offers a manual retry', async () => {
    const saveGate = deferred<BetaOriginalExportResult>();
    let historySucceeds = false;
    const history = vi.fn(async () => {
      if (!historySucceeds) throw new Error('offline');
      return [];
    });
    const native = exportClient({ history, save: vi.fn(() => saveGate.promise) });
    const client = { ...fakeClient(), originalExports: native };
    const owner = originalExportTasks(client);
    owner.start(PROFILE, original());

    render(<BetaOriginalExportCenter client={client} profileId={PROFILE} />);
    await waitFor(() => expect(history).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '附件导出任务' }));
    await waitFor(() => expect(history).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/导出历史读取失败/)).toBeInTheDocument();
    historySucceeds = true;
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
    await waitFor(() => expect(history).toHaveBeenCalledTimes(3));

    expect(screen.getByRole('dialog')).toHaveTextContent('recovered.raw');
    expect(owner.snapshot()).toHaveLength(1);
    saveGate.resolve({ cancelled: true, partial_output: false });
  });

  it('keeps accepted cancellation pending until Native returns a terminal result', async () => {
    const saveGate = deferred<BetaOriginalExportResult>();
    const native = exportClient({
      save: vi.fn(() => saveGate.promise),
      cancel: vi.fn(async () => true),
    });
    const owner = new OriginalExportTasks({ ...fakeClient(), originalExports: native });
    const requestId = owner.start(PROFILE, original());

    await owner.cancel(requestId);
    expect(native.cancel).toHaveBeenCalledWith(requestId);
    expect(owner.snapshot()).toContainEqual(expect.objectContaining({
      requestId,
      phase: 'running',
      cancelPending: true,
    }));
    saveGate.resolve({ cancelled: true, partial_output: true });
    await waitFor(() => expect(owner.snapshot().find(task => task.requestId === requestId)?.phase).toBe('cancelled'));
  });

  it('keeps accepted cancellation pending through active history and settles from a Native terminal row', async () => {
    const saveGate = deferred<BetaOriginalExportResult>();
    let historyResult: BetaOriginalExportHistoryEntry[] = [];
    const history = vi.fn(async () => historyResult);
    const native = exportClient({
      history,
      save: vi.fn(() => saveGate.promise),
      cancel: vi.fn(async () => true),
    });
    const owner = new OriginalExportTasks({ ...fakeClient(), originalExports: native });
    const requestId = owner.start(PROFILE, original());

    await owner.cancel(requestId);
    historyResult = [historyEntry({ request_id: requestId, phase: 'writing' })];
    await owner.restoreHistory(PROFILE);
    expect(owner.snapshot()).toContainEqual(expect.objectContaining({
      requestId,
      phase: 'running',
      cancelPending: true,
      message: '正在取消导出…',
    }));

    historyResult = [historyEntry({ request_id: requestId, phase: 'cancelled' })];
    await owner.refreshHistory(PROFILE);
    expect(owner.snapshot().find(task => task.requestId === requestId)?.phase).toBe('cancelled');
    saveGate.resolve({ cancelled: true, partial_output: true });
  });

  it('lets later Native history confirm success after a local export RPC error', async () => {
    let historyResult: BetaOriginalExportHistoryEntry[] = [];
    const history = vi.fn(async () => historyResult);
    const native = exportClient({
      history,
      save: vi.fn(async () => { throw new Error('transport lost'); }),
    });
    const owner = new OriginalExportTasks({ ...fakeClient(), originalExports: native });
    const requestId = owner.start(PROFILE, original());
    await waitFor(() => expect(owner.snapshot().find(task => task.requestId === requestId)?.phase).toBe('failed'));

    historyResult = [historyEntry({ request_id: requestId, phase: 'succeeded', partial_output: false })];
    await owner.refreshHistory(PROFILE);
    expect(owner.snapshot()).toContainEqual(expect.objectContaining({
      requestId,
      phase: 'succeeded',
      message: '原件已导出并完成校验',
    }));
  });

  it('offers a task-center check to resolve a local RPC error from Native history', async () => {
    let historyResult: BetaOriginalExportHistoryEntry[] = [];
    const history = vi.fn(async () => historyResult);
    const native = exportClient({
      history,
      save: vi.fn(async () => { throw new Error('transport lost'); }),
    });
    const client = { ...fakeClient(), originalExports: native };
    const owner = originalExportTasks(client);
    const requestId = owner.start(PROFILE, original());

    render(<BetaOriginalExportCenter client={client} profileId={PROFILE} />);
    await waitFor(() => expect(owner.snapshot()).toContainEqual(expect.objectContaining({
      requestId,
      phase: 'failed',
      statusSource: 'request_error',
      partialOutput: null,
    })));
    await waitFor(() => expect(history).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '附件导出任务' }));
    await waitFor(() => expect(history).toHaveBeenCalledTimes(2));
    expect(screen.getByText('结果待查证')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查证原生状态' })).toBeInTheDocument();

    historyResult = [historyEntry({ request_id: requestId, phase: 'succeeded', partial_output: false })];
    fireEvent.click(screen.getByRole('button', { name: '查证原生状态' }));
    await waitFor(() => expect(history).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('dialog')).toHaveTextContent('原件已导出并完成校验');
  });

  it('does not let a late local RPC error overwrite success already confirmed by history', async () => {
    const historyGate = deferred<BetaOriginalExportHistoryEntry[]>();
    const saveGate = deferred<BetaOriginalExportResult>();
    const native = exportClient({
      history: vi.fn(() => historyGate.promise),
      save: vi.fn(() => saveGate.promise),
    });
    const owner = new OriginalExportTasks({ ...fakeClient(), originalExports: native });
    const requestId = owner.start(PROFILE, original());
    const restoring = owner.restoreHistory(PROFILE);

    historyGate.resolve([historyEntry({ request_id: requestId, phase: 'succeeded', partial_output: false })]);
    await restoring;
    saveGate.reject(new Error('late transport error'));
    await waitFor(() => expect(owner.snapshot().find(task => task.requestId === requestId)?.phase).toBe('succeeded'));
    expect(owner.snapshot()).toContainEqual(expect.objectContaining({ requestId, phase: 'succeeded' }));
  });

  it('never falls back to Blob reads after a Native export failure', async () => {
    const blob = vi.spyOn(globalThis, 'Blob');
    const readOriginal = vi.fn(async () => new Uint8Array());
    const native = exportClient({ save: vi.fn(async () => { throw new Error('native export interrupted'); }) });
    const client = {
      ...fakeClient(),
      originalExports: native,
      originals: { readOriginal } as never,
    };
    await expect(exportOriginalDownload(client, PROFILE, original(), OLD_REQUEST))
      .rejects.toThrow('native export interrupted');
    expect(readOriginal).not.toHaveBeenCalled();
    expect(blob).not.toHaveBeenCalled();
  });

  it('polls active history serially only while observed', async () => {
    vi.useFakeTimers();
    const native = exportClient({ history: vi.fn(async () => [historyEntry({ phase: 'writing' })]) });
    const owner = new OriginalExportTasks({ ...fakeClient(), originalExports: native });
    await owner.restoreHistory(PROFILE);

    const stopObserving = owner.observe(PROFILE);
    await vi.advanceTimersByTimeAsync(0);
    expect(native.history).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(native.history).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(native.history).toHaveBeenCalledTimes(3);
    stopObserving();
    await vi.advanceTimersByTimeAsync(3000);
    expect(native.history).toHaveBeenCalledTimes(3);
  });

  it('follows a recovered Native-active task to terminal while visible without opening the center', async () => {
    vi.useFakeTimers();
    let complete = false;
    const native = exportClient({
      history: vi.fn(async () => [
        complete
          ? historyEntry({ phase: 'succeeded', partial_output: false })
          : historyEntry({ phase: 'writing' }),
      ]),
    });
    const client = { ...fakeClient(), originalExports: native };
    const owner = originalExportTasks(client);
    render(<BetaOriginalExportCenter client={client} profileId={PROFILE} visible />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(owner.snapshot()).toContainEqual(expect.objectContaining({
      requestId: OLD_REQUEST,
      phase: 'running',
      statusSource: 'history',
    }));
    expect(owner.historyStatus(PROFILE).phase).toBe('ready');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const readsBeforePoll = vi.mocked(native.history!).mock.calls.length;
    complete = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const readsAfterTerminal = vi.mocked(native.history!).mock.calls.length;
    expect(readsAfterTerminal).toBe(readsBeforePoll + 1);
    expect(owner.snapshot()).toContainEqual(expect.objectContaining({
      requestId: OLD_REQUEST,
      phase: 'succeeded',
      statusSource: 'history',
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(native.history).toHaveBeenCalledTimes(readsAfterTerminal);
    expect(native.save).not.toHaveBeenCalled();
    expect(native.cancel).not.toHaveBeenCalled();
  });

  it('does not poll restored idle history', async () => {
    vi.useFakeTimers();
    const native = exportClient({ history: vi.fn(async () => []) });
    const owner = new OriginalExportTasks({ ...fakeClient(), originalExports: native });
    await owner.restoreHistory(PROFILE);

    const stopObserving = owner.observe(PROFILE);
    await vi.advanceTimersByTimeAsync(0);
    expect(native.history).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(native.history).toHaveBeenCalledTimes(2);
    stopObserving();
  });

  it('waits for visibility before reading history and hides the entry after an empty result', async () => {
    const native = exportClient({ history: vi.fn(async () => []) });
    const client = { ...fakeClient(), originalExports: native };
    const owner = originalExportTasks(client);
    const view = render(<BetaOriginalExportCenter client={client} profileId={PROFILE} visible={false} />);
    expect(native.history).not.toHaveBeenCalled();

    view.rerender(<BetaOriginalExportCenter client={client} profileId={PROFILE} visible />);
    await waitFor(() => expect(owner.historyStatus(PROFILE).phase).toBe('ready'));
    expect(native.history).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '附件导出任务' })).not.toBeInTheDocument();
  });

  it('closes the dialog when the document is hidden and stops its history polling', async () => {
    vi.useFakeTimers();
    const previousHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    try {
      const native = exportClient({ history: vi.fn(async () => [historyEntry({ phase: 'writing' })]) });
      const client = { ...fakeClient(), originalExports: native };
      const owner = originalExportTasks(client);
      render(<BetaOriginalExportCenter client={client} profileId={PROFILE} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(owner.historyStatus(PROFILE).phase).toBe('ready');

      fireEvent.click(screen.getByRole('button', { name: '附件导出任务' }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const readsBeforeHide = vi.mocked(native.history!).mock.calls.length;
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(native.history).toHaveBeenCalledTimes(readsBeforeHide);
      expect(native.cancel).not.toHaveBeenCalled();
    } finally {
      if (previousHidden) Object.defineProperty(document, 'hidden', previousHidden);
      else Reflect.deleteProperty(document, 'hidden');
    }
  });

  it('stops polling when the center becomes hidden, including an active late history response', async () => {
    vi.useFakeTimers();
    const observationRead = deferred<BetaOriginalExportHistoryEntry[]>();
    let readCount = 0;
    const native = exportClient({
      history: vi.fn(() => {
        readCount += 1;
        return readCount === 1
          ? Promise.resolve([historyEntry({ phase: 'writing' })])
          : observationRead.promise;
      }),
    });
    const client = { ...fakeClient(), originalExports: native };
    const owner = originalExportTasks(client);
    const view = render(<BetaOriginalExportCenter client={client} profileId={PROFILE} visible />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(owner.historyStatus(PROFILE).phase).toBe('ready');

    fireEvent.click(screen.getByRole('button', { name: '附件导出任务' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(native.history).toHaveBeenCalledTimes(2);
    view.rerender(<BetaOriginalExportCenter client={client} profileId={PROFILE} visible={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => {
      observationRead.resolve([historyEntry({ phase: 'writing' })]);
      await observationRead.promise;
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(native.history).toHaveBeenCalledTimes(2);
    expect(native.cancel).not.toHaveBeenCalled();
    expect(owner.snapshot()).toContainEqual(expect.objectContaining({
      requestId: OLD_REQUEST,
      phase: 'running',
    }));
  });

  it('does not flash an empty task entry during the initial history read', async () => {
    const gate = deferred<BetaOriginalExportHistoryEntry[]>();
    const client = { ...fakeClient(), originalExports: exportClient({ history: vi.fn(() => gate.promise) }) };
    render(<BetaOriginalExportCenter client={client} profileId={PROFILE} visible />);
    expect(screen.queryByRole('button', { name: '附件导出任务' })).not.toBeInTheDocument();
    await act(async () => { gate.resolve([]); await gate.promise; });
    expect(screen.queryByRole('button', { name: '附件导出任务' })).not.toBeInTheDocument();
  });

  it('keeps the recovery dialog open while a read retry resolves to empty history', async () => {
    const gate = deferred<BetaOriginalExportHistoryEntry[]>();
    const history = vi.fn().mockRejectedValue(new Error('synthetic unavailable history'));
    const client = { ...fakeClient(), originalExports: exportClient({ history }) };
    const owner = originalExportTasks(client);
    render(<BetaOriginalExportCenter client={client} profileId={PROFILE} visible />);
    await waitFor(() => expect(owner.historyStatus(PROFILE).phase).toBe('failed'));
    fireEvent.click(screen.getByRole('button', { name: '附件导出任务' }));
    await screen.findByText(/导出历史读取失败/);
    await act(async () => { await Promise.resolve(); });
    history.mockImplementation(() => gate.promise);
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => { gate.resolve([]); await gate.promise; });
    expect(screen.getByRole('dialog')).toHaveTextContent('暂无导出任务');
  });
});
