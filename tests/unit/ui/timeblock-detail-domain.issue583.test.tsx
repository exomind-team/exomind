import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TimeBlockDetailPage } from '@/ui/app/pages/TimeBlockDetailPage'
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event'

const loadTimeBlocksMock = vi.fn<() => Promise<TimeBlock[]>>()
const loadActiveBlockMock = vi.fn<() => Promise<ActiveBlockData | null>>()
const loadEventsMock = vi.fn<() => Promise<Array<{ id: string; timestamp: number; content: string; tags: Set<string> }>>>()
const getTaskMock = vi.fn()
const navigateMock = vi.fn()

function resolveHref(to?: string, params?: Record<string, string>): string {
  return appendSearchParams(resolvePath(to, params))
}

function resolvePath(to?: string, params?: Record<string, string>): string {
  let href = to ?? ''
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      href = href.replace(`$${key}`, value)
    }
  }
  return href
}

function appendSearchParams(href: string, search?: Record<string, unknown>): string {
  if (!search || Object.keys(search).length === 0) return href
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value == null) continue
    searchParams.set(key, String(value))
  }
  const query = searchParams.toString()
  return query ? `${href}?${query}` : href
}

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    ...props
  }: {
    children: ReactNode
    to?: string
    params?: Record<string, string>
    search?: Record<string, unknown>
  }) => <a href={appendSearchParams(resolvePath(to, params), search)} {...props}>{children}</a>,
  useNavigate: () => navigateMock,
  useParams: () => ({ blockId: 'block-1' }),
  useLocation: () => ({ pathname: window.location.pathname, searchStr: window.location.search }),
}))

vi.mock('@/lib/services', () => ({
  getTimeBlockService: () => ({
    loadTimeBlocks: loadTimeBlocksMock,
    loadActiveBlock: loadActiveBlockMock,
  }),
  getEventLogService: () => ({
    loadEvents: loadEventsMock,
  }),
  getTaskService: () => ({
    getTask: getTaskMock,
  }),
}))

function makeBlock(overrides: Partial<TimeBlock> = {}): TimeBlock {
  const start = new Date('2026-03-19T09:00:00+08:00').getTime()
  const end = new Date('2026-03-19T10:00:00+08:00').getTime()
  return {
    id: 'block-1',
    startId: 'block-1',
    endId: 'block-1-end',
    name: '时间块详情域测试',
    note: '验证路由域',
    tags: new Set(['block_feedback']),
    startTime: start,
    endTime: end,
    taskIds: [],
    taskAssociationLog: [],
    ...overrides,
  }
}

describe('TimeBlockDetailPage issue #583 domain routing', () => {
  beforeEach(() => {
    loadTimeBlocksMock.mockReset()
    loadActiveBlockMock.mockReset()
    getTaskMock.mockReset()
    navigateMock.mockReset()

    loadTimeBlocksMock.mockResolvedValue([makeBlock()])
    loadActiveBlockMock.mockResolvedValue(null)
    loadEventsMock.mockResolvedValue([])
    getTaskMock.mockResolvedValue(null)
  })

  it('uses 当下 breadcrumb when entered from eventlog domain', async () => {
    window.history.replaceState({}, '', '/eventlog/timeblocks/block-1')

    render(<TimeBlockDetailPage />)

    await waitFor(() => {
      expect(loadTimeBlocksMock).toHaveBeenCalled()
    })

    expect(screen.getByText('当下').closest('a')).toHaveAttribute('href', '/eventlog')
    expect(screen.getByText('时间块详情')).toBeInTheDocument()
  })

  it('keeps 任务 breadcrumb when entered from tasks domain', async () => {
    window.history.replaceState({}, '', '/tasks/block/block-1')

    render(<TimeBlockDetailPage />)

    await waitFor(() => {
      expect(loadTimeBlocksMock).toHaveBeenCalled()
    })

    expect(screen.getByText('任务').closest('a')).toHaveAttribute('href', '/tasks?main=1')
    expect(screen.getByText('时间块详情')).toBeInTheDocument()
  })

  it('builds related-task detail and dag links with timeblock return context', async () => {
    loadTimeBlocksMock.mockResolvedValue([
      makeBlock({
        taskIds: ['task-1'],
        taskAssociationLog: [{
          blockId: 'block-1',
          taskId: 'task-1',
          action: 'associated',
          timestamp: new Date('2026-03-19T09:00:00+08:00').getTime(),
          source: 'manual',
        }],
      }),
    ])
    loadEventsMock.mockResolvedValue([
      {
        id: 'event-1',
        timestamp: new Date('2026-03-19T09:20:00+08:00').getTime(),
        content: '## 联调记录\n\n**结果** 已完成主链路验证',
        tags: new Set(['note']),
      },
    ])
    getTaskMock.mockResolvedValue({
      id: 'task-1',
      title: '2026-03-22 洗澡',
      status: 'completed',
    })
    window.history.replaceState({}, '', '/tasks/block/block-1')

    render(<TimeBlockDetailPage />)

    const detailLink = await screen.findByRole('link', { name: '打开任务详情：2026-03-22 洗澡' })
    const dagLink = screen.getByRole('link', { name: '在任务依赖图中定位：2026-03-22 洗澡' })

    fireEvent.click(detailLink)
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/tasks/$taskId',
      params: { taskId: 'task-1' },
      search: {
        blockId: 'block-1',
        returnTo: '/tasks/block/block-1',
        returnLabel: '时间块详情',
      },
    })

    const dagUrl = new URL(dagLink.getAttribute('href') ?? '', 'http://localhost')
    expect(dagUrl.pathname).toBe('/tasks/dag')
    expect(dagUrl.searchParams.get('focus')).toBe('task-1')
    expect(dagUrl.searchParams.get('locate')).toBe('1')

    expect(screen.getByText('关联日志')).toBeInTheDocument()
    expect(screen.getByText('联调记录')).toBeInTheDocument()
    expect(screen.getByText('结果')).toBeInTheDocument()
    expect(screen.getByText('已完成主链路验证')).toBeInTheDocument()
    expect(screen.queryByText('事件记录')).toBeNull()
  })

  it('loads historically related tasks from association log instead of only the final taskIds snapshot', async () => {
    loadTimeBlocksMock.mockResolvedValue([
      makeBlock({
        taskIds: ['task-1'],
        taskAssociationLog: [
          {
            blockId: 'block-1',
            taskId: 'task-1',
            action: 'associated',
            timestamp: new Date('2026-03-19T09:00:00+08:00').getTime(),
            source: 'block_start',
          },
          {
            blockId: 'block-1',
            taskId: 'task-2',
            action: 'associated',
            timestamp: new Date('2026-03-19T09:10:00+08:00').getTime(),
            source: 'manual',
          },
          {
            blockId: 'block-1',
            taskId: 'task-2',
            action: 'disassociated',
            timestamp: new Date('2026-03-19T09:20:00+08:00').getTime(),
            source: 'manual',
          },
        ],
      }),
    ])
    getTaskMock.mockImplementation(async (id: string) => {
      if (id === 'task-1') {
        return { id: 'task-1', title: '主任务', status: 'completed' }
      }
      if (id === 'task-2') {
        return { id: 'task-2', title: '临时任务', status: 'pending' }
      }
      return null
    })
    window.history.replaceState({}, '', '/tasks/block/block-1')

    render(<TimeBlockDetailPage />)

    expect(await screen.findByRole('link', { name: '打开任务详情：主任务' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: '打开任务详情：临时任务' })).toBeInTheDocument()
  })
})
