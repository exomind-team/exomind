import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceTabs } from '@/ui/app/pages/agents/WorkspaceTabs';

const runtimeHostServiceMocks = vi.hoisted(() => ({
  listHosts: vi.fn(),
}));

vi.mock('@/components/ui/tabs', async () => {
  const React = await import('react');
  const TabsContext = React.createContext<{
    value: string;
    setValue: (value: string) => void;
  } | null>(null);

  return {
    Tabs: ({
      defaultValue,
      className,
      children,
    }: {
      defaultValue: string;
      className?: string;
      children: any;
    }) => {
      const [value, setValue] = React.useState(defaultValue);
      return (
        <div className={className} data-orientation="horizontal" dir="ltr">
          <TabsContext.Provider value={{ value, setValue }}>
            {children}
          </TabsContext.Provider>
        </div>
      );
    },
    TabsList: ({
      className,
      children,
    }: {
      className?: string;
      children: any;
    }) => <div role="tablist" className={className}>{children}</div>,
    TabsTrigger: ({
      value,
      className,
      children,
    }: {
      value: string;
      className?: string;
      children: any;
    }) => {
      const context = React.useContext(TabsContext);
      if (!context) return null;
      const active = context.value === value;
      return (
        <button
          type="button"
          role="tab"
          aria-selected={active}
          data-state={active ? 'active' : 'inactive'}
          className={className}
          onClick={() => context.setValue(value)}
        >
          {children}
        </button>
      );
    },
    TabsContent: ({
      value,
      className,
      children,
    }: {
      value: string;
      className?: string;
      children: any;
    }) => {
      const context = React.useContext(TabsContext);
      if (!context || context.value !== value) return null;
      return <div role="tabpanel" data-state="active" className={className}>{children}</div>;
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

vi.mock('@/lib/services/runtime-host.service', () => ({
  getRuntimeHostService: () => runtimeHostServiceMocks,
}));

describe('workspace tabs ui（工作区标签页样式）', () => {
  beforeEach(() => {
    runtimeHostServiceMocks.listHosts.mockResolvedValue([
      { host: '127.0.0.1', port: 1949 },
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/workspace/knowledge')) {
        return {
          ok: true,
          json: async () => ({
            files: [
              { name: 'memory.md', sizeBytes: 2048 },
            ],
            usageBytes: 4096,
            maxBytes: 8192,
            usageRatio: 0.5,
          }),
        } as Response;
      }

      if (url.endsWith('/workspace/knowledge/memory.md')) {
        return {
          ok: true,
          text: async () => '# memory',
        } as Response;
      }

      if (url.includes('/workspace/actions?limit=50')) {
        return {
          ok: true,
          json: async () => ({
            total: 2,
            actions: [
              {
                timestamp: '2026-03-10T08:00:00.000Z',
                tick: 11,
                actionType: 'think',
                description: '思考下一步',
                energyBefore: 90,
                energyAfter: 84,
              },
              {
                timestamp: '2026-03-10T08:00:03.000Z',
                tick: 12,
                actionType: 'knowledge_write',
                description: '写入记忆',
                energyBefore: 84,
                energyAfter: 88,
              },
            ],
          }),
        } as Response;
      }

      if (url.endsWith('/workspace/soul')) {
        return {
          ok: true,
          text: async () => '# SOUL',
        } as Response;
      }

      if (url.endsWith('/workspace/status')) {
        return {
          ok: true,
          json: async () => ({
            knowledgeUsageRatio: 0.5,
            totalActions: 22,
            uptimeTicks: 314,
            currentStrategy: 'exploring',
            energyLevel: 84,
            energyMax: 100,
          }),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
      } as Response;
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  it('uses card-aligned tabs chrome and semantic energy colors（标签容器与能量增减应使用设计系统 token）', async () => {
    render(<WorkspaceTabs agentId="life-alpha" />);

    const tabsList = await screen.findByRole('tablist');
    expect(tabsList.className).toContain('rounded-xl');
    expect(tabsList.className).toContain('border-border-card');
    expect(tabsList.className).toContain('bg-card');

    fireEvent.click(screen.getByRole('tab', { name: '行动日志' }));

    await waitFor(() => {
      expect(screen.getByText('最近 2 条记录')).toBeInTheDocument();
    });

    expect(screen.getByText('+4').className).toContain('text-success');
    expect(screen.getByText('-6').className).toContain('text-destructive');
  });
});
