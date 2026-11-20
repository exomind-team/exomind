import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BetaProfileArchiveEntry } from '../../../src/beta/BetaProfileArchives';
import type { ProfileArchiveClient, ProfileArchiveTask } from '../../../src/beta/profile-archive-client';

const PROFILE = '22222222-2222-4222-8222-222222222222';
const REQUEST = '11111111-1111-4111-8111-111111111111';
function preview(): ProfileArchiveTask {
  return {
    request_id: REQUEST, profile_id: PROFILE, direction: 'import', phase: 'preview_ready',
    bytes_processed: 1024, facts_processed: 105, original_bytes_processed: 0, partial_output: false,
    preview: {
      request_id: REQUEST, profile_id: PROFILE, source_display_name: '旅行档案', archive_sha256: 'a'.repeat(64),
      fact_count: 105, original_count: 2, conflict_count: 0, missing_original_count: 1,
      unverified_origin_count: 1, facts_complete: true, proofs_complete: false,
      bytes_complete: false, target_bytes_complete: false, can_import: true,
    },
  };
}
function client(rows: ProfileArchiveTask[] = []) {
  return {
    capabilities: vi.fn(async () => ({ schema: 1 as const, supports_import: true, supports_export: true })),
    history: vi.fn(async () => rows),
    previewImport: vi.fn(async (id: string) => ({ request_id: id, accepted: true as const })),
    confirmImport: vi.fn(async (id: string) => ({ request_id: id, accepted: true as const })),
    exportProfile: vi.fn(async (_profile: string, id: string) => ({ request_id: id, accepted: true as const })),
    cancel: vi.fn(async () => true),
  } satisfies ProfileArchiveClient;
}

describe('profile archive user controls', () => {
  it('loads only on explicit opening and allows an empty device to choose an import source', async () => {
    const api = client();
    render(<BetaProfileArchiveEntry client={api} profileId="" profileName="" />);
    expect(api.capabilities).not.toHaveBeenCalled();
    expect(api.history).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '档案备份与导入' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择备份文件' }));
    await waitFor(() => expect(api.previewImport).toHaveBeenCalledTimes(1));
    expect(api.previewImport).toHaveBeenCalledWith(expect.any(String));
    expect(api.confirmImport).not.toHaveBeenCalled();
    expect(api.exportProfile).not.toHaveBeenCalled();
  });

  it('shows incomplete coverage before a separate explicit import confirmation', async () => {
    const api = client([preview()]);
    render(<BetaProfileArchiveEntry client={api} profileId="" profileName="" />);
    fireEvent.click(screen.getByRole('button', { name: '档案备份与导入' }));
    expect(await screen.findByText('旅行档案')).toBeVisible();
    expect(screen.getByText(/^105 条记录 · 2 个原件$/)).toBeVisible();
    expect(screen.getByText(/缺失.*1.*原件/)).toBeVisible();
    expect(api.confirmImport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(api.confirmImport).toHaveBeenCalledWith(REQUEST));
  });

  it('keeps conflicting previews readable and refuses the confirm action', async () => {
    const row = preview();
    row.preview = { ...row.preview!, conflict_count: 2, can_import: false };
    const api = client([row]);
    render(<BetaProfileArchiveEntry client={api} profileId={PROFILE} profileName="已有档案" />);
    fireEvent.click(screen.getByRole('button', { name: '档案备份与导入' }));
    expect(await screen.findByText(/2.*处冲突/)).toBeVisible();
    expect(screen.queryByRole('button', { name: '确认导入' })).toBeNull();
    expect(api.confirmImport).not.toHaveBeenCalled();
  });

  it('closing or unmounting only stops observation and does not cancel a Native task', async () => {
    const api = client([{ ...preview(), phase: 'awaiting_source', preview: undefined }]);
    const mounted = render(<BetaProfileArchiveEntry client={api} profileId="" profileName="" />);
    fireEvent.click(screen.getByRole('button', { name: '档案备份与导入' }));
    await screen.findByText('等待选择备份文件');
    fireEvent.click(screen.getByRole('button', { name: '关闭档案备份与导入' }));
    mounted.unmount();
    await act(async () => {});
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it('refreshes the profile list after confirmed import without selecting a profile or repeating import', async () => {
    const api = client([{ ...preview(), phase: 'succeeded', preview: undefined, archive_complete: true }]);
    const changed = vi.fn();
    render(<BetaProfileArchiveEntry client={api} profileId="" profileName="" onImported={changed} />);
    fireEvent.click(screen.getByRole('button', { name: '档案备份与导入' }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith(PROFILE));
    fireEvent.click(screen.getByRole('button', { name: '刷新操作历史' }));
    await waitFor(() => expect(api.history).toHaveBeenCalledTimes(2));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(api.confirmImport).not.toHaveBeenCalled();
    expect(screen.getByText('导入完成')).toBeVisible();
  });

  it('exports only the chosen profile and treats acknowledgement as ongoing work', async () => {
    const api = client();
    render(<BetaProfileArchiveEntry client={api} profileId={PROFILE} profileName="本机旅行" />);
    fireEvent.click(screen.getByRole('button', { name: '档案备份与导入' }));
    fireEvent.click(await screen.findByRole('button', { name: '备份当前档案' }));
    await waitFor(() => expect(api.exportProfile).toHaveBeenCalledWith(PROFILE, expect.any(String)));
    expect(screen.queryByText('备份已保存')).toBeNull();
  });

  it('explains absent Native support without trying import or export', async () => {
    render(<BetaProfileArchiveEntry client={undefined} profileId="" profileName="" />);
    fireEvent.click(screen.getByRole('button', { name: '档案备份与导入' }));
    expect(await screen.findByText(/桌面或安卓客户端/)).toBeVisible();
    expect(screen.queryByRole('button', { name: '选择备份文件' })).toBeNull();
  });

  it('keeps an unknown confirmation result visible even when its history read succeeds', async () => {
    const api = client([preview()]);
    api.confirmImport.mockRejectedValue(new Error('导入结果未确认，请核对操作历史。'));
    render(<BetaProfileArchiveEntry client={api} profileId="" profileName="" />);
    fireEvent.click(screen.getByRole('button', { name: '档案备份与导入' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认导入' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('导入结果未确认');
    expect(api.confirmImport).toHaveBeenCalledTimes(1);
  });

  it('does not describe a rejected cancellation as accepted work', async () => {
    const api = client([{ ...preview(), phase: 'awaiting_source', preview: undefined }]);
    api.cancel.mockResolvedValue(false);
    render(<BetaProfileArchiveEntry client={api} profileId="" profileName="" />);
    fireEvent.click(screen.getByRole('button', { name: '档案备份与导入' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消此操作' }));
    expect(await screen.findByText('取消请求未被受理，已刷新操作历史。')).toBeVisible();
    expect(screen.queryByText('操作已受理，具体进度与结果见下方。')).toBeNull();
  });
});
