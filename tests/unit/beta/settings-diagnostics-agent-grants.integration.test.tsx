import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaSettingsPage } from '@/beta/BetaSettingsPage';
import type { BetaDiagnosticsClient, BetaDiagnosticsSample } from '@/beta/diagnostics-client';
import type { SummaryModelConfiguration, SummaryModelConfigurationCommand, SummaryModelConfigurationService } from '@/beta/summary-model-config';
import { deferred } from './fixtures';

const native = vi.hoisted(() => ({ active: true, invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', async importOriginal => ({
  ...await importOriginal<typeof import('@tauri-apps/api/core')>(),
  isTauri: () => native.active,
  invoke: native.invoke,
}));

const PROFILE_P = '11111111-1111-4111-8111-111111111111';
const PROFILE_Q = '22222222-2222-4222-8222-222222222222';
const DEVICE = '33333333-3333-4333-8333-333333333333';
const RUNTIME = '44444444-4444-4444-8444-444444444444';
const GRANT = '77777777-7777-4777-8777-777777777777';

function nativeCalls(command: string) {
  return native.invoke.mock.calls.filter(([name]) => name === command);
}

function grant(profileId: string) {
  return {
    grant_id: GRANT,
    profile_id: profileId,
    kind: 'observer',
    agent_id: null,
    revoked: true,
  };
}

function sample(): BetaDiagnosticsSample {
  return {
    schemaVersion: 1,
    deviceId: DEVICE,
    runtimeId: RUNTIME,
    process: {
      schemaVersion: 1,
      scope: 'native_host_process',
      identity: { pid: 421, collectorLifecycle: 'settings-integration' },
      sampledAtUnixMs: 1_800_000_000_000,
      monotonicElapsedNs: '1',
      cpu: {
        cumulativeTime: { value: null, unit: 'nanoseconds', availability: 'unknown', reason: 'initial_sample' },
        usageCores: { value: null, unit: 'cpu_cores', availability: 'unknown', reason: 'initial_sample' },
        measurementWindow: { value: null, unit: 'nanoseconds', availability: 'unknown', reason: 'initial_sample' },
      },
      memory: {
        workingSetBytes: { value: null, unit: 'bytes', availability: 'unknown', reason: 'initial_sample' },
        privateBytes: { value: null, unit: 'bytes', availability: 'unknown', reason: 'initial_sample' },
      },
    },
  };
}

function modelConfiguration(): SummaryModelConfiguration {
  return {
    profile_id: PROFILE_P,
    revision: '55555555-5555-4555-8555-555555555555',
    enabled: false,
    include_suggestions: false,
    base_url: 'http://127.0.0.1:4000/v1',
    model: 'P model',
    has_api_key: true,
    max_output_tokens: 2048,
    timeout_ms: 60000,
  };
}

function modelService() {
  return {
    read: vi.fn(async () => modelConfiguration()),
    save: vi.fn(async (_profileId: string, command: SummaryModelConfigurationCommand) => ({
      ...modelConfiguration(),
      revision: command.command_id,
      enabled: command.enabled,
      include_suggestions: command.include_suggestions,
      base_url: command.base_url,
      model: command.model,
      max_output_tokens: command.max_output_tokens,
      timeout_ms: command.timeout_ms,
      has_api_key: command.api_key.kind !== 'clear',
    })),
  } satisfies SummaryModelConfigurationService;
}

function diagnosticsClient(sampleResult = Promise.resolve(sample())): BetaDiagnosticsClient {
  return {
    sample: vi.fn(() => sampleResult),
    scanStorage: vi.fn(async (_scanId: string) => { throw new Error('unused storage scan'); }),
    cancelStorage: vi.fn(async (scanId: string) => ({ scanId, cancellationRequested: false })),
  };
}

beforeEach(() => {
  native.active = true;
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string) => {
    if (command === 'beta_grant_metadata_list') return [];
    return null;
  });
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android Settings integration fixture');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Beta Settings diagnostics and Agent grants integration', () => {
  it('loads grant metadata only after opening its dialog and keeps diagnostics independent', async () => {
    const diagnostics = diagnosticsClient();
    render(
      <BetaSettingsPage
        profileName="Profile P"
        profileId={PROFILE_P}
        diagnosticsClient={diagnostics}
        deadlineAlerts={null}
      />,
    );

    expect(await screen.findByRole('button', { name: '查看运行诊断' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '管理 Agent 授权' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Agent 授权' })).not.toBeInTheDocument();
    expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(0);
    expect(nativeCalls('beta_grant_issue')).toHaveLength(0);
    expect(nativeCalls('beta_grant_revoke')).toHaveLength(0);
    expect(nativeCalls('beta_grant_copy_access_info')).toHaveLength(0);
    expect(diagnostics.sample).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '查看运行诊断' }));
    expect(await screen.findByRole('dialog', { name: '运行诊断' })).toBeInTheDocument();
    await waitFor(() => expect(diagnostics.sample).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '关闭运行诊断' }));
    expect(screen.queryByRole('dialog', { name: '运行诊断' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '管理 Agent 授权' }));
    const agentDialog = await screen.findByRole('dialog', { name: 'Agent 授权' });
    await waitFor(() => expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(1));
    expect(nativeCalls('beta_grant_metadata_list')[0][1]).toEqual({ profileId: PROFILE_P });
    expect(within(agentDialog).getByText('此档案目前没有 Agent 授权。')).toBeInTheDocument();
    expect(nativeCalls('beta_grant_issue')).toHaveLength(0);
    expect(nativeCalls('beta_grant_revoke')).toHaveLength(0);
    expect(nativeCalls('beta_grant_copy_access_info')).toHaveLength(0);
    expect(diagnostics.sample).toHaveBeenCalledTimes(1);

    fireEvent.click(within(agentDialog).getByRole('button', { name: '关闭 Agent 授权' }));
    expect(screen.queryByRole('dialog', { name: 'Agent 授权' })).not.toBeInTheDocument();
    expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(1);
  });

  it('resets diagnostics on Settings visibility and closes Agent grants without revoking them', async () => {
    const diagnostics = diagnosticsClient();
    const props = {
      profileName: 'Profile P',
      profileId: PROFILE_P,
      diagnosticsClient: diagnostics,
      deadlineAlerts: null,
    };
    const view = render(<BetaSettingsPage {...props} visible={false} />);

    expect(screen.queryByRole('heading', { name: '运行诊断' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '管理 Agent 授权' })).not.toBeInTheDocument();
    expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(0);
    expect(nativeCalls('beta_grant_revoke')).toHaveLength(0);
    expect(diagnostics.sample).not.toHaveBeenCalled();

    view.rerender(<BetaSettingsPage {...props} visible />);
    expect(await screen.findByRole('button', { name: '查看运行诊断' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '管理 Agent 授权' })).toBeInTheDocument();
    expect(diagnostics.sample).not.toHaveBeenCalled();
    expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '查看运行诊断' }));
    expect(await screen.findByRole('dialog', { name: '运行诊断' })).toBeInTheDocument();
    await waitFor(() => expect(diagnostics.sample).toHaveBeenCalledTimes(1));
    expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '开始观察' }));
    expect(screen.getByRole('button', { name: '暂停观测' })).toBeInTheDocument();
    view.rerender(<BetaSettingsPage {...props} visible={false} />);
    expect(screen.queryByRole('dialog', { name: '运行诊断' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '管理 Agent 授权' })).not.toBeInTheDocument();
    expect(nativeCalls('beta_grant_revoke')).toHaveLength(0);
    expect(diagnostics.sample).toHaveBeenCalledTimes(1);

    view.rerender(<BetaSettingsPage {...props} visible />);
    expect(screen.queryByRole('dialog', { name: '运行诊断' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Agent 授权' })).not.toBeInTheDocument();
    expect(diagnostics.sample).toHaveBeenCalledTimes(1);
    expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '查看运行诊断' }));
    expect(await screen.findByRole('button', { name: '开始观察' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '暂停观测' })).not.toBeInTheDocument();
    await waitFor(() => expect(diagnostics.sample).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: '关闭运行诊断' }));
    expect(screen.queryByRole('dialog', { name: '运行诊断' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '管理 Agent 授权' }));
    expect(await screen.findByRole('dialog', { name: 'Agent 授权' })).toBeInTheDocument();
    await waitFor(() => expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(1));

    view.rerender(<BetaSettingsPage {...props} visible={false} />);
    expect(screen.queryByRole('dialog', { name: 'Agent 授权' })).not.toBeInTheDocument();
    expect(nativeCalls('beta_grant_revoke')).toHaveLength(0);

    view.rerender(<BetaSettingsPage {...props} visible />);
    expect(await screen.findByRole('button', { name: '管理 Agent 授权' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Agent 授权' })).not.toBeInTheDocument();
    expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(1);
    expect(nativeCalls('beta_grant_revoke')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '管理 Agent 授权' }));
    expect(await screen.findByRole('dialog', { name: 'Agent 授权' })).toBeInTheDocument();
    await waitFor(() => expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(2));
    expect(nativeCalls('beta_grant_revoke')).toHaveLength(0);
  });

  it('closes P grant entry on profile switch and ignores its late list after Q is reopened', async () => {
    const pList = deferred<unknown>();
    native.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'beta_grant_metadata_list') {
        return args?.profileId === PROFILE_P ? pList.promise : [];
      }
      return null;
    });
    const props = { profileName: 'Profile P', profileId: PROFILE_P, diagnosticsClient: null, deadlineAlerts: null };
    const view = render(<BetaSettingsPage {...props} />);

    expect(await screen.findByRole('button', { name: '管理 Agent 授权' })).toBeInTheDocument();
    expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '管理 Agent 授权' }));
    expect(await screen.findByRole('dialog', { name: 'Agent 授权' })).toBeInTheDocument();
    await waitFor(() => expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(1));
    expect(nativeCalls('beta_grant_metadata_list')[0][1]).toEqual({ profileId: PROFILE_P });

    view.rerender(<BetaSettingsPage {...props} profileId={PROFILE_Q} profileName="Profile Q" />);
    expect(screen.queryByRole('dialog', { name: 'Agent 授权' })).not.toBeInTheDocument();
    expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(1);
    expect(nativeCalls('beta_grant_revoke')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '管理 Agent 授权' }));
    const agentDialog = await screen.findByRole('dialog', { name: 'Agent 授权' });
    await waitFor(() => expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(2));
    expect(nativeCalls('beta_grant_metadata_list').map(([, args]) => args)).toEqual([
      { profileId: PROFILE_P },
      { profileId: PROFILE_Q },
    ]);
    expect(within(agentDialog).getByText('此档案目前没有 Agent 授权。')).toBeInTheDocument();

    await act(async () => { pList.resolve([grant(PROFILE_P)]); });
    expect(within(agentDialog).getByText('此档案目前没有 Agent 授权。')).toBeInTheDocument();
    expect(within(agentDialog).queryByText('已撤销')).not.toBeInTheDocument();
    expect(within(agentDialog).getByText('Profile Q')).toBeInTheDocument();
    expect(nativeCalls('beta_grant_revoke')).toHaveLength(0);
  });

  it('keeps Agent grant drafts and the summary-model editor across unrelated Settings rerenders', async () => {
    const model = modelService();
    const props = {
      profileName: 'Profile P',
      profileId: PROFILE_P,
      deviceId: DEVICE,
      summaryModel: model,
      diagnosticsClient: null,
      deadlineAlerts: null,
    };
    const view = render(<BetaSettingsPage {...props} />);
    const modelField = await screen.findByRole('textbox', { name: '模型名称' });
    await waitFor(() => expect(model.read).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(modelField).toBeEnabled());
    expect(modelField).toHaveValue('P model');
    fireEvent.change(modelField, { target: { value: 'Unsubmitted model draft' } });
    expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(0);

    fireEvent.click(await screen.findByRole('button', { name: '管理 Agent 授权' }));
    const agentDialog = await screen.findByRole('dialog', { name: 'Agent 授权' });
    await waitFor(() => expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(1));
    expect(within(agentDialog).getByText('此档案目前没有 Agent 授权。')).toBeInTheDocument();
    const createButton = within(agentDialog).getByRole('button', { name: '新建 Agent 授权' });
    await waitFor(() => expect(createButton).toBeEnabled());
    fireEvent.click(createButton);
    expect(await screen.findByRole('heading', { name: '确认签发 Agent 授权' })).toBeInTheDocument();

    view.rerender(<BetaSettingsPage {...props} onDisconnect={() => {}} />);

    expect(screen.getByRole('heading', { name: '确认签发 Agent 授权' })).toBeInTheDocument();
    expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(1);
    expect(model.read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    const reopenedAgentDialog = screen.getByRole('dialog', { name: 'Agent 授权' });
    fireEvent.click(within(reopenedAgentDialog).getByRole('button', { name: '关闭 Agent 授权' }));

    expect(screen.queryByRole('dialog', { name: 'Agent 授权' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '模型名称' })).toBe(modelField);
    expect(screen.getByRole('textbox', { name: '模型名称' })).toHaveValue('Unsubmitted model draft');
    expect(model.save).not.toHaveBeenCalled();
  });

  it('passes a null Native client on Web and explains why grant management is unavailable after entry', async () => {
    native.active = false;
    render(<BetaSettingsPage profileName="Profile P" profileId={PROFILE_P} deadlineAlerts={null} />);

    expect(await screen.findByRole('button', { name: '管理 Agent 授权' })).toBeInTheDocument();
    expect(screen.queryByText(/当前环境无法使用本机 Agent 授权管理/)).not.toBeInTheDocument();
    expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '管理 Agent 授权' }));
    const agentDialog = await screen.findByRole('dialog', { name: 'Agent 授权' });
    expect(within(agentDialog).getByText(/当前环境无法使用本机 Agent 授权管理/)).toBeInTheDocument();
    expect(nativeCalls('beta_grant_metadata_list')).toHaveLength(0);
    expect(nativeCalls('beta_grant_issue')).toHaveLength(0);
    expect(nativeCalls('beta_grant_revoke')).toHaveLength(0);
  });
});
