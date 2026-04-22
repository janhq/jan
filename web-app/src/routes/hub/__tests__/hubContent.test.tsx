import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const {
  mockInvoke,
  mockRefresh,
  mockInstallOllama,
  mockStartOllama,
  mockToastSuccess,
  mockToastError,
  mockUseOllamaStatus,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockRefresh: vi.fn(),
  mockInstallOllama: vi.fn(),
  mockStartOllama: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
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

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

vi.mock('@/components/hub/OllamaRunPanel', () => ({
  OllamaRunPanel: ({
    models,
    isSubmitting,
    onSubmit,
  }: {
    models: string[]
    isSubmitting: boolean
    onSubmit: (payload: Record<string, unknown>) => void
  }) => (
    <div>
      <div>RUN_PANEL</div>
      <div>{models.join(',')}</div>
      <div>{isSubmitting ? 'SUBMITTING' : 'IDLE'}</div>
      <button onClick={() => onSubmit({ model: 'qwen2.5:7b' })}>RUN_SUBMIT</button>
    </div>
  ),
}))

import { Route } from '../index'

describe('HubContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_MACOS', false)
    mockUseOllamaStatus.mockReturnValue({
      isRunning: true,
      isInstalled: true,
      version: '0.11.4',
      models: [
        {
          name: 'qwen2.5:7b',
          model: 'qwen2.5:7b',
          modified_at: '2026-04-21T00:00:00Z',
          size: 1,
          digest: 'digest-1',
        },
      ],
      refresh: mockRefresh,
      isLoading: false,
      isInstalling: false,
      installProgress: 0,
      installStatus: null,
      installMessage: '',
      installOllama: mockInstallOllama,
      startOllama: mockStartOllama,
    })
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'ollama_ps') return []
      if (command === 'ollama_run_model') return undefined
      return undefined
    })
  })

  it('renders the running instances section with port 11434 and detail actions when ollama_ps returns items', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'ollama_ps') {
        return [
          {
            name: 'qwen2.5:7b',
            model: 'qwen2.5:7b',
            size: 8 * 1024 * 1024 * 1024,
            size_vram: 4 * 1024 * 1024 * 1024,
            digest: 'digest-1',
            expires_at: '2099-01-01T00:00:00Z',
            details: {
              parameter_size: '7B',
              quantization_level: 'Q4_K_M',
            },
          },
        ]
      }
      if (command === 'ollama_run_model') return undefined
      return undefined
    })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByText(/运行实例/)).toBeInTheDocument()
    })

    expect(screen.getAllByText('qwen2.5:7b').length).toBeGreaterThan(0)
    expect(screen.getAllByText('端口 11434').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '查看详情' })).toBeInTheDocument()
  })

  it('opens the instance detail dialog when clicking 查看详情', async () => {
    const user = userEvent.setup()

    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'ollama_ps') {
        return [
          {
            name: 'qwen2.5:7b',
            model: 'qwen2.5:7b',
            size: 8 * 1024 * 1024 * 1024,
            size_vram: 4 * 1024 * 1024 * 1024,
            digest: 'digest-1',
            expires_at: '2099-01-01T00:00:00Z',
          },
        ]
      }
      return undefined
    })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    await user.click(await screen.findByRole('button', { name: '查看详情' }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    expect(screen.getByText('运行实例详情')).toBeInTheDocument()
    expect(screen.getByText('保存并自动重启')).toBeInTheDocument()
  })

  it('renders 暂无运行实例 when ollama_ps returns no items', async () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByText('暂无运行实例')).toBeInTheDocument()
    })

    expect(screen.queryByText('暂无运行中的模型')).not.toBeInTheDocument()
  })
})
