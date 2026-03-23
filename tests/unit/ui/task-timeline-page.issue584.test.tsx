import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TaskTimelinePage } from '@/ui/app/pages/TaskTimelinePage'
import { SYSTEM_TAGS, type Event, type TimeBlock } from '@/lib/types/event'
import type { TaskNode } from '@/lib/types/task'

const listTasksMock = vi.fn<() => Promise<TaskNode[]>>()
const loadEventsMock = vi.fn<() => Promise<Event[]>>()
const loadTimeBlocksMock = vi.fn<() => Promise<TimeBlock[]>>()

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
    useNavigate: () => vi.fn(),
  }
})

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => true,
}))

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    listTasks: listTasksMock,
    onTaskChange: vi.fn(() => () => {}),
  }),
  getEventLogService: () => ({
    loadEvents: loadEventsMock,
    onEvent: vi.fn(() => () => {}),
  }),
  getTimeBlockService: () => ({
    loadTimeBlocks: loadTimeBlocksMock,
    onBlockChange: vi.fn(() => () => {}),
  }),
}))

function makeTask(overrides: Partial<TaskNode> & { id: string; title: string }): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    status: 'in_progress',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: new Date('2026-03-19T09:00:00.000+08:00').getTime(),
    updatedAt: new Date('2026-03-19T10:00:00.000+08:00').getTime(),
    ...overrides,
  }
}

function makeEvent(input: {
  id: string
  timestamp: number
  tags: string[]
  taskId: string
  taskTitle: string
  fromStatus?: string
  toStatus?: string
}): Event {
  return {
    id: input.id,
    timestamp: input.timestamp,
    content: input.id,
    tags: new Set(input.tags),
    metadata: {
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
    },
  }
}

function dispatchWheel(
  element: HTMLElement,
  input: { deltaY: number; ctrlKey?: boolean },
): void {
  const event = new Event('wheel', { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    deltaY: { value: input.deltaY },
    ctrlKey: { value: input.ctrlKey ?? false },
    metaKey: { value: false },
  })
  fireEvent(element, event)
}

describe('TaskTimelinePage scale controls（任务时间线比例尺控件）', () => {
  const scrollToMock = vi.fn()

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-19T14:30:00.000+08:00').getTime())
    listTasksMock.mockReset()
    loadEventsMock.mockReset()
    loadTimeBlocksMock.mockReset()
    localStorage.clear()
    sessionStorage.clear()

    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-1', title: '时间线任务' }),
    ])
    loadEventsMock.mockResolvedValue([
      makeEvent({
        id: 'task-created',
        timestamp: new Date('2026-03-19T09:00:00.000+08:00').getTime(),
        tags: [SYSTEM_TAGS.TASK_CREATED],
        taskId: 'task-1',
        taskTitle: '时间线任务',
      }),
      makeEvent({
        id: 'task-started',
        timestamp: new Date('2026-03-19T10:00:00.000+08:00').getTime(),
        tags: [SYSTEM_TAGS.TASK_STARTED],
        taskId: 'task-1',
        taskTitle: '时间线任务',
        fromStatus: 'pending',
        toStatus: 'in_progress',
      }),
    ])
    loadTimeBlocksMock.mockResolvedValue([])

    scrollToMock.mockReset()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollToMock,
    })
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps showPending stable when switching presets and selecting a task', async () => {
    localStorage.setItem('task-timeline-show-pending', '1')

    render(<TaskTimelinePage />)

    await screen.findByTestId('task-timeline-page')
    await screen.findByTestId('timeline-segment-task-1-1')
    expect(screen.getByRole('button', { name: '1d' })).toBeInTheDocument()

    expect(screen.getByRole('button', { name: '显示待办段' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '3d' }))

    await waitFor(() => {
      expect(localStorage.getItem('task-timeline-range')).toBe('3d')
    })
    expect(localStorage.getItem('task-timeline-show-pending')).toBe('1')
    expect(screen.getByRole('button', { name: '显示待办段' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByTestId('timeline-segment-task-1-1'))

    await waitFor(() => {
      expect(localStorage.getItem('task-timeline-selected-task')).toBe('task-1')
    })
    expect(localStorage.getItem('task-timeline-show-pending')).toBe('1')

    fireEvent.click(screen.getByTestId('task-timeline-scroll-viewport'))

    await waitFor(() => {
      expect(localStorage.getItem('task-timeline-selected-task')).toBeNull()
    })
  })

  it('uses active style to mean pending segments are shown while keeping a stable label', async () => {
    render(<TaskTimelinePage />)

    await screen.findByTestId('task-timeline-page')

    const toggle = screen.getByRole('button', { name: '显示待办段' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(toggle)

    await waitFor(() => {
      expect(localStorage.getItem('task-timeline-show-pending')).toBe('1')
    })
    expect(screen.getByRole('button', { name: '显示待办段' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('supports 1h as the smallest preset scale', async () => {
    render(<TaskTimelinePage />)

    await screen.findByTestId('task-timeline-page')

    fireEvent.click(screen.getByRole('button', { name: '1h' }))

    await waitFor(() => {
      expect(localStorage.getItem('task-timeline-range')).toBe('1h')
    })
    expect(screen.getByText('比例尺：1小时')).toBeInTheDocument()
  })

  it('scrolls back to now without changing scale state', async () => {
    render(<TaskTimelinePage />)

    await screen.findByTestId('task-timeline-page')

    fireEvent.click(screen.getByRole('button', { name: '回到当下' }))

    expect(scrollToMock).toHaveBeenCalled()
    expect(localStorage.getItem('task-timeline-range')).toBeNull()
  })

  it('zooms timeline scale with wheel in day units and hour units', async () => {
    render(<TaskTimelinePage />)

    const viewport = await screen.findByTestId('task-timeline-scroll-viewport')

    dispatchWheel(viewport, { deltaY: -120 })
    expect(localStorage.getItem('task-timeline-range')).toBeNull()

    dispatchWheel(viewport, { deltaY: -120, ctrlKey: true })
    await waitFor(() => {
      expect(localStorage.getItem('task-timeline-range')).toBe('custom:23h')
    })

    dispatchWheel(viewport, { deltaY: 120, ctrlKey: true })
    await waitFor(() => {
      expect(localStorage.getItem('task-timeline-range')).toBe('1d')
    })

    dispatchWheel(viewport, { deltaY: 120, ctrlKey: true })
    await waitFor(() => {
      expect(localStorage.getItem('task-timeline-range')).toBe('custom:2d')
    })
  })

  it('stores custom scale as duration instead of legacy date range', async () => {
    render(<TaskTimelinePage />)

    await screen.findByTestId('task-timeline-page')

    fireEvent.click(screen.getByRole('button', { name: '自定义比例尺（Custom timeline scale）' }))

    const valueInput = screen.getByTestId('task-timeline-custom-scale-input')
    fireEvent.change(valueInput, { target: { value: '12h' } })
    fireEvent.keyDown(valueInput, { key: 'Enter' })

    await waitFor(() => {
      expect(localStorage.getItem('task-timeline-range')).toBe('custom:12h')
    })
    expect(screen.getByText('比例尺：12小时')).toBeInTheDocument()
  })

  it('persists timeline layout mode independently from scale state', async () => {
    render(<TaskTimelinePage />)

    await screen.findByTestId('task-timeline-page')

    fireEvent.click(screen.getByTestId('task-timeline-layout-vertical'))

    await waitFor(() => {
      expect(localStorage.getItem('task-timeline-layout-mode')).toBe('vertical')
    })
    expect(localStorage.getItem('task-timeline-range')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '7d' }))

    await waitFor(() => {
      expect(localStorage.getItem('task-timeline-range')).toBe('7d')
    })
    expect(localStorage.getItem('task-timeline-layout-mode')).toBe('vertical')
  })

  it('uses month tick labels when the scale is larger than 1m', async () => {
    localStorage.setItem('task-timeline-range', '3m')

    render(<TaskTimelinePage />)

    await screen.findByTestId('task-timeline-page')

    expect(screen.getByText('2026/2')).toBeInTheDocument()
    expect(screen.getByText('2026/3')).toBeInTheDocument()
  })
})
