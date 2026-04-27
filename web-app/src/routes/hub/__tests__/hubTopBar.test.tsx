import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRefresh,
  mockInstallOllama,
  mockSetDesiredRunning,
  mockUseOllamaLifecycleController,
  mockUseOllamaStatus,
} = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
  mockInstallOllama: vi.fn(),
  mockSetDesiredRunning: vi.fn(),
  mockUseOllamaLifecycleController: vi.fn(),
  mockUseOllamaStatus: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode
    [key: string]: unknown
  }) => <a {...props}>{children}</a>,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/hooks/useOllamaStatus', () => ({
  useOllamaStatus: mockUseOllamaStatus,
}))

vi.mock('@/hooks/useOllamaLifecycleController', () => ({
  useOllamaLifecycleController: mockUseOllamaLifecycleController,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === 'ollama_ps') return []
    return undefined
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { Route } from '../index'

describe('Hub top bar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_MACOS', false)

    mockUseOllamaStatus.mockReturnValue({
      isRunning: true,
      isInstalled: true,
      version: '0.11.4',
      models: [],
      installPath: undefined,
      refresh: mockRefresh,
      isLoading: false,
      isInstalling: false,
      installProgress: 0,
      installStatus: null,
      installMessage: '',
      installOllama: mockInstallOllama,
    })

    mockUseOllamaLifecycleController.mockReturnValue({
      phase: 'running',
      desiredRunning: true,
      errorMessage: undefined,
      isReconciling: false,
      switchChecked: true,
      switchDisabled: false,
      setDesiredRunning: mockSetDesiredRunning,
    })
  })

  it('does not render a top settings gear button anymore', async () => {
    const Component = Route.component as React.ComponentType
    const { container } = render(<Component />)

    await waitFor(() => {
      expect(screen.getByText('common:inferenceCenter')).toBeInTheDocument()
    })

    expect(container.querySelector('.tabler-icon-settings')).toBeNull()
  })
})
