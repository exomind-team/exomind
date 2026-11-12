import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiAgentTabView } from '@/ui/app/pages/agents/ApiAgentTabView';
import { AgentDetailPage } from '@/ui/app/pages/agents/AgentDetailPage';

const mocks = vi.hoisted(() => ({
  listProviderProfiles: vi.fn(),
  resolveProviderProfile: vi.fn(),
  createAdapter: vi.fn(),
  runSession: vi.fn(),
  getSession: vi.fn(),
  getAgentDetail: vi.fn(),
  refreshSnapshot: vi.fn(),
}));

vi.mock('@/lib/agent-provider/provider-profile-storage', () => ({
  listProviderProfiles: mocks.listProviderProfiles,
  resolveProviderProfile: mocks.resolveProviderProfile,
}));
vi.mock('@/lib/adapters/agent-session-rt-adapter', () => ({
  AgentSessionRtAdapter: class {
    constructor() { mocks.createAdapter(); }
    runSession = mocks.runSession;
    getSession = mocks.getSession;
  },
}));
vi.mock('@/lib/services', () => ({
  getAgentHubService: () => ({ getAgentDetail: mocks.getAgentDetail }),
}));
vi.mock('@/services/runtime-manager', () => ({
  getRuntimeManager: () => ({ refreshSnapshot: mocks.refreshSnapshot }),
  findPreferredRuntimeHostForAgent: () => null,
}));

describe('Alpha disabled agent management surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('exomind:apiAgentTabEnabled', 'true');
    localStorage.setItem('exomind:developerMode', 'true');
  });

  it('mounts no API tester or proposal controls and constructs no broker adapter', () => {
    const { container } = render(<ApiAgentTabView />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'proposal_tools' })).not.toBeInTheDocument();
    expect(mocks.createAdapter).not.toHaveBeenCalled();
    expect(mocks.listProviderProfiles).not.toHaveBeenCalled();
    expect(mocks.runSession).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('mounts no Agent detail, workspace or chat and starts no loading work', () => {
    const { container } = render(<AgentDetailPage agentId="synthetic-agent" />);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.getAgentDetail).not.toHaveBeenCalled();
    expect(mocks.refreshSnapshot).not.toHaveBeenCalled();
  });
});
