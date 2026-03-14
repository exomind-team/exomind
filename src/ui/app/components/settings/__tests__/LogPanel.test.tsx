/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { LogPanel } from '../LogPanel'
import * as logger from '@/lib/logger'

vi.mock('@/lib/logger', () => ({
  startLogStream: vi.fn().mockResolvedValue(vi.fn()),
  addLogListener: vi.fn().mockReturnValue(vi.fn()),
}))

function emitLog(level: logger.LogLevel, message: string) {
  const listener = vi.mocked(logger.addLogListener).mock.calls[0]?.[0]
  if (listener) {
    act(() => {
      listener({ level, message, timestamp: new Date('2026-03-14T10:00:00') })
    })
  }
}

describe('LogPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty state', () => {
    render(<LogPanel />)
    expect(screen.getByText('暂无日志')).toBeInTheDocument()
  })

  it('displays log entries from stream', () => {
    render(<LogPanel />)
    emitLog('INFO', 'application started')
    expect(screen.getByText(/application started/)).toBeInTheDocument()
  })

  it('shows level badge for each entry', () => {
    render(<LogPanel />)
    emitLog('WARN', 'low memory')
    expect(screen.getByText('WARN')).toBeInTheDocument()
  })

  it('filters by log level — hides lower levels', () => {
    render(<LogPanel />)
    emitLog('DEBUG', 'debug message')
    emitLog('ERROR', 'error message')

    // Default level is INFO, so DEBUG should be hidden
    expect(screen.queryByText(/debug message/)).not.toBeInTheDocument()
    expect(screen.getByText(/error message/)).toBeInTheDocument()
  })

  it('changes filter level via buttons', () => {
    render(<LogPanel />)

    // Click DEBUG filter button to lower threshold
    fireEvent.click(screen.getByRole('button', { name: /DEBUG/ }))
    emitLog('DEBUG', 'now visible debug')
    expect(screen.getByText(/now visible debug/)).toBeInTheDocument()
  })

  it('clears log entries', () => {
    render(<LogPanel />)
    emitLog('INFO', 'some log')
    expect(screen.getByText(/some log/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /清除/ }))
    expect(screen.queryByText(/some log/)).not.toBeInTheDocument()
  })

  it('cleans up listener on unmount', () => {
    const removeFn = vi.fn()
    vi.mocked(logger.addLogListener).mockReturnValue(removeFn)

    const { unmount } = render(<LogPanel />)
    unmount()
    expect(removeFn).toHaveBeenCalled()
  })
})
