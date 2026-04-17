import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mockUpdateBackend = vi.fn().mockResolvedValue(undefined)
const mockCheckForUpdate = vi.fn()
const mockSetRemindMeLater = vi.fn()

vi.mock('@/hooks/useBackendUpdater', () => ({
  useBackendUpdater: () => ({
    updateState: {
      remindMeLater: false,
      isUpdateAvailable: true,
      isUpdating: false,
      updateInfo: { newVersion: '2.0.0' },
    },
    updateBackend: mockUpdateBackend,
    checkForUpdate: mockCheckForUpdate,
    setRemindMeLater: mockSetRemindMeLater,
  }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: (s: unknown) => unknown) => {
    // Simulate llamacpp provider being active
    const state = {
      getProviderByName: (name: string) =>
        name === 'llamacpp' ? { active: true } : undefined,
    }
    return selector(state)
  },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import BackendUpdater from '../BackendUpdater'

describe('BackendUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders update notification when update is available and llamacpp active', () => {
    render(<BackendUpdater />)
    expect(
      screen.getByText('settings:backendUpdater.updateNow')
    ).toBeInTheDocument()
  })

  it('calls setRemindMeLater when remind me later clicked', () => {
    render(<BackendUpdater />)
    screen.getByText('settings:backendUpdater.remindMeLater').click()
    expect(mockSetRemindMeLater).toHaveBeenCalledWith(true)
  })

  it('calls updateBackend when update now clicked', () => {
    render(<BackendUpdater />)
    screen.getByText('settings:backendUpdater.updateNow').click()
    expect(mockUpdateBackend).toHaveBeenCalled()
  })
})
