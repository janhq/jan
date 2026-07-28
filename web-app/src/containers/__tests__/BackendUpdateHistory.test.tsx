import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendUpdateHistory } from '../BackendUpdateHistory'

const hoisted = vi.hoisted(() => ({
  extension: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      getByName: () => hoisted.extension,
    }),
  },
}))

vi.mock('@/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('BackendUpdateHistory', () => {
  beforeEach(() => {
    hoisted.extension = null
  })

  it('only loads the history once expanded', async () => {
    const getBackendUpdateHistory = vi.fn().mockResolvedValue([])
    hoisted.extension = { getBackendUpdateHistory }

    render(<BackendUpdateHistory />)
    expect(getBackendUpdateHistory).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(getBackendUpdateHistory).toHaveBeenCalledTimes(1))
    expect(
      screen.getByText('providers:backendHistoryEmpty')
    ).toBeInTheDocument()
  })

  it('renders each record with its outcome and error', async () => {
    hoisted.extension = {
      getBackendUpdateHistory: vi.fn().mockResolvedValue([
        {
          timestamp: '2026-07-28T10:00:00.000Z',
          from: 'b1000/cpu',
          to: 'b1100/cpu',
          outcome: 'rolled-back',
          durationMs: 4000,
          error: 'Router failed its health check',
        },
      ]),
    }

    render(<BackendUpdateHistory />)
    await userEvent.click(screen.getByRole('button'))

    await waitFor(() =>
      expect(screen.getByText(/b1000\/cpu/)).toBeInTheDocument()
    )
    expect(
      screen.getByText('providers:backendHistoryRolledBack')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Router failed its health check')
    ).toBeInTheDocument()
  })

  it('degrades to an empty list when the extension is unavailable', async () => {
    hoisted.extension = null

    render(<BackendUpdateHistory />)
    await userEvent.click(screen.getByRole('button'))

    await waitFor(() =>
      expect(
        screen.getByText('providers:backendHistoryEmpty')
      ).toBeInTheDocument()
    )
  })
})
