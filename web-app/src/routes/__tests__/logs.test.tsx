/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

const h = vi.hoisted(() => ({
  readLogs: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({ ...config, id: '/logs' }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    app: () => ({ readLogs: h.readLogs }),
  }),
}))

vi.mock('@/constants/routes', () => ({
  route: { appLogs: '/logs' },
}))

import { Route } from '../logs'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

describe('LogsViewer route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.readLogs.mockResolvedValue([])
  })

  it('renders empty state when no logs', async () => {
    h.readLogs.mockResolvedValue([])
    renderComponent()
    await waitFor(() => {
      expect(screen.getByText('logs:noLogs')).toBeInTheDocument()
    })
  })

  it('calls readLogs on mount', async () => {
    renderComponent()
    await waitFor(() => {
      expect(h.readLogs).toHaveBeenCalled()
    })
  })

  it('renders log entries with level labels and messages', async () => {
    h.readLogs.mockResolvedValue([
      { timestamp: '2024-01-01T00:00:00Z', level: 'error', message: 'boom' },
      { timestamp: '2024-01-01T00:00:01Z', level: 'info', message: 'hello' },
      { timestamp: '2024-01-01T00:00:02Z', level: 'warn', message: 'careful' },
      { timestamp: '2024-01-01T00:00:03Z', level: 'debug', message: 'trace' },
      { timestamp: '2024-01-01T00:00:04Z', level: 'verbose', message: 'misc' },
    ])
    renderComponent()
    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument()
    })
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('ERROR')).toBeInTheDocument()
    expect(screen.getByText('INFO')).toBeInTheDocument()
    expect(screen.getByText('WARN')).toBeInTheDocument()
    expect(screen.getByText('DEBUG')).toBeInTheDocument()
    // default branch (unknown level) still renders uppercased
    expect(screen.getByText('VERBOSE')).toBeInTheDocument()
  })

  it('filters out falsy log entries before rendering', async () => {
    h.readLogs.mockResolvedValue([
      null,
      undefined,
      { timestamp: '2024-01-01T00:00:00Z', level: 'info', message: 'kept' },
      false,
    ])
    renderComponent()
    await waitFor(() => {
      expect(screen.getByText('kept')).toBeInTheDocument()
    })
    expect(screen.queryByText('logs:noLogs')).not.toBeInTheDocument()
  })

  it('clears interval on unmount', async () => {
    const clearSpy = vi.spyOn(global, 'clearInterval')
    const { unmount } = renderComponent()
    await waitFor(() => {
      expect(h.readLogs).toHaveBeenCalled()
    })
    unmount()
    expect(clearSpy).toHaveBeenCalled()
  })
})
