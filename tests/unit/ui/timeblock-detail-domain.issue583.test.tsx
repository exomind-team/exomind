import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TimeBlockDetailPage } from '@/ui/app/pages/TimeBlockDetailPage'
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event'

const loadTimeBlocksMock = vi.fn<() => Promise<TimeBlock[]>>()
const loadActiveBlockMock = vi.fn<() => Promise<ActiveBlockData | null>>()
const getTaskMock = vi.fn()

function resolveHref(to?: string, params?: Record<string, string>): string {
  let href = to ?? ''
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      href = href.replace(`$${key}`, value)
    }
  }
  return href
}

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    ...props
  }: {
    children: ReactNode
    to?: string
    params?: Record<string, string>
  }) => <a href={resolveHref(to, params)} {...props}>{children}</a>,
  useParams: () => ({ blockId: 'block-1' }),
  useLocation: () => ({ pathname: window.location.pathname, searchStr: window.location.search }),
}))

vi.mock('@/lib/services', () => ({
  getTimeBlockService: () => ({
    loadTimeBlocks: loadTimeBlocksMock,
    loadActiveBlock: loadActiveBlockMock,
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

    loadTimeBlocksMock.mockResolvedValue([makeBlock()])
    loadActiveBlockMock.mockResolvedValue(null)
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

    expect(screen.getByText('任务').closest('a')).toHaveAttribute('href', '/tasks')
    expect(screen.getByText('时间块详情')).toBeInTheDocument()
  })
})
