import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaApp } from '../../../src/beta/BetaApp';
import { asyncDraftLocks, deferred, fakeClient } from './fixtures';
import { memoryIntentJournal } from './timeblock-ui-fixtures';
import type { ProfileArchiveTask } from '../../../src/beta/profile-archive-client';

const PROFILE = '22222222-2222-4222-8222-222222222222';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: asyncDraftLocks() });
});
afterEach(() => {
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});
function importApi() {
  let row: ProfileArchiveTask = {
    request_id: REQUEST, profile_id: PROFILE, direction: 'import', phase: 'preview_ready',
    bytes_processed: 256, facts_processed: 1, original_bytes_processed: 0, partial_output: false,
    preview: {
      request_id: REQUEST, profile_id: PROFILE, source_display_name: '导入的旅行', archive_sha256: 'a'.repeat(64),
      fact_count: 1, original_count: 0, conflict_count: 0, missing_original_count: 0,
      unverified_origin_count: 0, facts_complete: true, proofs_complete: true,
      bytes_complete: true, target_bytes_complete: true, can_import: true,
    },
  };
  return {
    capabilities: vi.fn(async () => ({ schema: 1 as const, supports_import: true, supports_export: true })),
    history: vi.fn(async () => [row]),
    previewImport: vi.fn(async (id: string) => ({ request_id: id, accepted: true as const })),
    confirmImport: vi.fn(async (id: string) => {
      row = { ...row, phase: 'succeeded', preview: undefined, archive_complete: true };
      return { request_id: id, accepted: true as const };
    }),
    exportProfile: vi.fn(async (_profile: string, id: string) => ({ request_id: id, accepted: true as const })),
    cancel: vi.fn(async () => true),
  };
}

describe('profile archive workspace integration', () => {
  it('keeps a newly created profile when an earlier archive refresh arrives late', async () => {
    const archive = importApi();
    const client = Object.assign(fakeClient(), { profileArchives: archive });
    const originalList = await client.profiles();
    const refresh = deferred<typeof originalList>();
    client.profiles.mockClear();
    client.profiles.mockResolvedValueOnce(originalList).mockReturnValueOnce(refresh.promise);
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);
    await screen.findByRole('textbox', { name: '记录当下' });
    fireEvent.click(screen.getByRole('button', { name: '管理档案' }));
    fireEvent.click(await screen.findByRole('button', { name: '档案备份与导入' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认导入' }));
    await screen.findByText('导入完成');
    await waitFor(() => expect(client.profiles).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '关闭档案备份与导入' }));
    fireEvent.change(screen.getByRole('textbox', { name: '新档案名称' }), { target: { value: '并行新建' } });
    const create = screen.getByRole('button', { name: '创建档案' });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(client.provisionProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '管理档案' }));
    await screen.findByRole('button', { name: /^并行新建/ });
    await act(async () => refresh.resolve([...originalList, { profile_id: PROFILE, display_name: '导入的旅行' }]));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /^并行新建/ }).querySelector('[aria-label="当前档案"]')).not.toBeNull();
    expect(within(dialog).getByRole('button', { name: '导入的旅行' })).toBeInTheDocument();
  });

  it('offers import on an empty device and lists the result without switching before the user opens it', async () => {
    const archive = importApi();
    const client = Object.assign(fakeClient(), { profileArchives: archive });
    client.profiles.mockResolvedValueOnce([]).mockResolvedValue([{ profile_id: PROFILE, display_name: '导入的旅行' }]);
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);
    await waitFor(() => expect(screen.queryByText('正在连接…')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '管理档案' }));
    fireEvent.click(await screen.findByRole('button', { name: '档案备份与导入' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认导入' }));
    await screen.findByText('导入完成');
    await waitFor(() => expect(client.profiles).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '关闭档案备份与导入' }));
    const profileDialog = screen.getByRole('dialog');
    const option = await within(profileDialog).findByRole('button', { name: '导入的旅行' });
    expect(option.querySelector('[aria-label="当前档案"]')).toBeNull();
    await waitFor(() => expect(option).toBeEnabled());
    fireEvent.click(option);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.provisionProfile).not.toHaveBeenCalled();
    expect(client.capture).not.toHaveBeenCalled();
  });

  it('keeps the current profile and unsent draft while refreshing newly imported profiles', async () => {
    const archive = importApi();
    const client = Object.assign(fakeClient(), { profileArchives: archive });
    const originalList = await client.profiles();
    client.profiles.mockClear();
    client.profiles.mockResolvedValueOnce(originalList).mockResolvedValue([...originalList, { profile_id: PROFILE, display_name: '导入的旅行' }]);
    render(<BetaApp client={client} intentJournal={memoryIntentJournal()} />);
    const input = await screen.findByRole('textbox', { name: '记录当下' });
    fireEvent.change(input, { target: { value: '导入期间保留的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '管理档案' }));
    fireEvent.click(await screen.findByRole('button', { name: '档案备份与导入' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认导入' }));
    await screen.findByText('导入完成');
    await waitFor(() => expect(client.profiles).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '关闭档案备份与导入' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('textbox', { name: '记录当下' })).toBe(input);
    expect(input).toHaveValue('导入期间保留的草稿');
    expect(client.capture).not.toHaveBeenCalled();
    expect(client.provisionProfile).not.toHaveBeenCalled();
  });
});
