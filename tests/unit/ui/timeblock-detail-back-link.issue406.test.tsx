import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TaskDetailPage } from '@/ui/app/pages/TaskDetailPage';
import { buildTaskTimeblockDetailViewModel } from '@/ui/app/pages/task-timeblock-detail-view';
import type { TaskNode } from '@/lib/types/task';
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event';

const navigateMock = vi.fn();

const listTasksMock = vi.fn<(includeCancelled?: boolean) => Promise<TaskNode[]>>();
const loadTimeBlocksMock = vi.fn<() => Promise<TimeBlock[]>>();
const loadActiveBlockMock = vi.fn<() => Promise<ActiveBlockData | null>>();
const onBlockChangeMock = vi.fn(() => () => {});
const onTaskChangeMock = vi.fn(() => () => {});
const getEventsMock = vi.fn<
  () => Promise<Array<{ id: string; content: string; createdAt: string; type?: string }>>
>();

function resolveHref(
  to: string | undefined,
  params?: Record<string, string>,
  search?: Record<string, unknown>,
): string {
  let href = to ?? '';
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      href = href.replace(`$${key}`, encodeURIComponent(value));
    }
  }
  if (search) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (value == null) continue;
      query.set(key, String(value));
    }
    const queryText = query.toString();
    if (queryText) {
      href = `${href}?${queryText}`;
    }
  }
  return href;
}

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    ...props
  }: {
    children: ReactNode;
    to?: string;
    params?: Record<string, string>;
    search?: Record<string, unknown>;
  }) => (
    <a href={resolveHref(to, params, search)} {...props}>
      {children}
    </a>
  ),
  useParams: () => ({ blockId: 'block-1' }),
  useNavigate: () => navigateMock,
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    getTask: vi.fn(async () => null),
    listTasks: listTasksMock,
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
    getAvailableTransitions: vi.fn(async () => ['in_progress']),
    getChildTasks: vi.fn(async () => []),
    checkDependenciesMet: vi.fn(async () => ({ met: true, blocking: [] })),
    onTaskChange: onTaskChangeMock,
    transitionTask: vi.fn(),
    updateTask: vi.fn(),
    cancelTask: vi.fn(),
  }),
  getTimeBlockService: () => ({
    loadTimeBlocks: loadTimeBlocksMock,
    loadActiveBlock: loadActiveBlockMock,
    onBlockChange: onBlockChangeMock,
    pauseBlock: vi.fn(async () => {}),
  }),
  getTaskTimerService: () => ({
    calculateSpentMinutes: vi.fn(async () => 90),
    startBlockForTask: vi.fn(),
  }),
}));

vi.mock('@/lib/storage/event-storage', () => ({
  getEventStorage: () => ({
    getEvents: getEventsMock,
  }),
}));

function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(min-width: 768px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'task-1',
    title: '深度工作：返回来源上下文',
    description: '验证时间块详情返回链接',
    status: 'completed',
    priority: 'high',
    dependsOn: [],
    tags: ['frontend'],
    estimatedMinutes: 90,
    timeBlockIds: ['block-1'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeBlock(overrides: Partial<TimeBlock> = {}): TimeBlock {
  const start = new Date('2026-03-06T09:00:00+08:00').getTime();
  const end = new Date('2026-03-06T10:30:00+08:00').getTime();
  return {
    id: 'block-1',
    startId: 'block-1',
    endId: 'block-1-end',
    name: '深度工作：返回来源上下文',
    note: '补上返回入口',
    tags: new Set(['block_feedback']),
    startTime: start,
    endTime: end,
    ...overrides,
  };
}

function renderDetail(search = '', isDesktop = false): void {
  window.history.replaceState({}, '', `/tasks/block/block-1${search}`);
  mockMatchMedia(isDesktop);
  render(<TaskDetailPage />);
}

describe('timeblock detail back link issue #406', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    listTasksMock.mockResolvedValue([makeTask()]);
    loadTimeBlocksMock.mockResolvedValue([makeBlock()]);
    loadActiveBlockMock.mockResolvedValue(null);
    getEventsMock.mockResolvedValue([]);
  });

  it.each([
    ['today', '今日'],
    ['now', '当下'],
    ['week', '一周'],
    ['month', '本月'],
  ])('renders mobile back link for from=%s', async (from, label) => {
    renderDetail(`?from=${from}`, false);

    await waitFor(() => {
      expect(loadTimeBlocksMock).toHaveBeenCalled();
    });

    const backLink = await screen.findByTestId('timeblock-back-link-mobile');
    expect(backLink).toHaveAttribute('aria-label', `返回${label}`);
    expect(backLink).toHaveAttribute('href', `/tasks?tab=${from}`);
  });

  it('falls back to generic tasks link when source is missing', async () => {
    renderDetail('', false);

    await waitFor(() => {
      expect(loadTimeBlocksMock).toHaveBeenCalled();
    });

    const backLink = await screen.findByTestId('timeblock-back-link-mobile');
    expect(backLink).toHaveAttribute('aria-label', '返回任务');
    expect(backLink).toHaveAttribute('href', '/tasks');
  });

  it.each(['toString', 'constructor'])('falls back to generic tasks link for prototype key source=%s', async (from) => {
    renderDetail(`?from=${from}`, false);

    await waitFor(() => {
      expect(loadTimeBlocksMock).toHaveBeenCalled();
    });

    const backLink = await screen.findByTestId('timeblock-back-link-mobile');
    expect(backLink).toHaveAttribute('aria-label', '返回任务');
    expect(backLink).toHaveAttribute('href', '/tasks');
  });

  it('renders desktop back link and contextual breadcrumb', async () => {
    renderDetail('?from=today', true);

    await waitFor(() => {
      expect(loadTimeBlocksMock).toHaveBeenCalled();
    });

    const breadcrumb = await screen.findByText((_content, element) =>
      element?.tagName === 'P' && element.textContent === '任务 > 今日 > 任务详情',
    );
    expect(breadcrumb).toBeInTheDocument();
    const backLink = screen.getByTestId('timeblock-back-link-desktop');
    expect(backLink).toHaveTextContent('← 返回今日');
    expect(backLink).toHaveAttribute('href', '/tasks?tab=today');
  });

  it('does not include a back-source action in the view model (navigation via breadcrumb)', () => {
    const model = buildTaskTimeblockDetailViewModel({
      task: makeTask(),
      blocks: [makeBlock()],
      useMockData: true,
    });

    expect(model.actions.every((a) => a.id !== 'back-source')).toBe(true);
  });
});
