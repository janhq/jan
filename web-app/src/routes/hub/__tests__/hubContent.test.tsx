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

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

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
      if (command === 'ollama_unload_model') return undefined
      return undefined
    })
  })

  it('renders the run panel, removes the redirect card, updates empty-state copy, and wires run submit', async () => {
    const user = userEvent.setup()
    const Component = Route.component as React.ComponentType

    render(<Component />)

    expect(mockUseOllamaStatus.mock.calls.length).toBeLessThanOrEqual(2)
    expect(screen.getByText('RUN_PANEL')).toBeInTheDocument()
    expect(screen.getByText('qwen2.5:7b')).toBeInTheDocument()
    expect(screen.queryByText('管理本地模型')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('暂无运行实例')).toBeInTheDocument()
    })

    expect(screen.getByText('使用上方运行面板选择模型并启动')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'RUN_SUBMIT' }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('ollama_run_model', {
        request: { model: 'qwen2.5:7b' },
      })
    })
  })

  it('renders a compact ollama process status bar with a management entry instead of the old large card', async () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByText('Ollama 进程')).toBeInTheDocument()
    })
    expect(screen.getByText('版本 0.11.4')).toBeInTheDocument()
    expect(screen.getByText('端口 11434')).toBeInTheDocument()
    expect(screen.getByText('实例 0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '管理' })).toBeInTheDocument()
    expect(screen.queryByText('点击“启动 Ollama”即可运行')).not.toBeInTheDocument()
  })

  it('opens lifecycle dialog from manage entry and disables install action when already installed', async () => {
    const user = userEvent.setup()
    const Component = Route.component as React.ComponentType
    render(<Component />)

    await user.click(screen.getByRole('button', { name: /绠＄悊|管理/ }))

    await waitFor(() => {
      expect(screen.getByText(/Ollama.*绠＄悊|Ollama.*管理/)).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /瀹夎|安装/ })).toBeDisabled()
  })

  it('triggers both status refresh and running instance fetch when clicking top refresh', async () => {
    const user = userEvent.setup()
    const Component = Route.component as React.ComponentType
    render(<Component />)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('ollama_ps')
    })
    const psCallsBeforeRefresh = mockInvoke.mock.calls.filter(
      ([command]) => command === 'ollama_ps'
    ).length

    await user.click(screen.getByRole('button', { name: /鍒锋柊|刷新/ }))

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      const psCallsAfterRefresh = mockInvoke.mock.calls.filter(
        ([command]) => command === 'ollama_ps'
      ).length
      expect(psCallsAfterRefresh).toBeGreaterThan(psCallsBeforeRefresh)
    })
  })

  it('keeps the newest running-model response when older requests resolve later', async () => {
    const user = userEvent.setup()
    const firstPs = createDeferred<
      Array<{
        name: string
        model: string
        size: number
        size_vram: number
        digest: string
        expires_at: string
      }>
    >()
    let psCalls = 0

    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'ollama_run_model') return undefined
      if (command === 'ollama_ps') {
        psCalls += 1
        if (psCalls === 1) return firstPs.promise
        return [
          {
            name: 'run-loaded',
            model: 'run-loaded',
            size: 10,
            size_vram: 5,
            digest: 'digest-run',
            expires_at: '2099-01-01T00:00:00Z',
          },
        ]
      }
      return undefined
    })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    await user.click(screen.getByRole('button', { name: 'RUN_SUBMIT' }))

    await waitFor(() => {
      expect(screen.getByText('run-loaded')).toBeInTheDocument()
    })

    firstPs.resolve([])

    await waitFor(() => {
      expect(screen.getByText('run-loaded')).toBeInTheDocument()
    })
    expect(screen.queryByText('暂无运行实例')).not.toBeInTheDocument()
  })

  it('clears the loading state when ollama stops while a running-model request is still pending', async () => {
    const firstPs = createDeferred<
      Array<{
        name: string
        model: string
        size: number
        size_vram: number
        digest: string
        expires_at: string
      }>
    >()
    const statusState = {
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
    }

    mockUseOllamaStatus.mockImplementation(() => statusState)
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'ollama_ps') return firstPs.promise
      return undefined
    })

    const Component = Route.component as React.ComponentType
    const { rerender } = render(<Component />)

    await waitFor(() => {
      expect(screen.getByText('正在获取运行实例...')).toBeInTheDocument()
    })

    statusState.isRunning = false
    statusState.models = []
    rerender(<Component />)

    await waitFor(() => {
      expect(screen.queryByText('正在获取运行实例...')).not.toBeInTheDocument()
    })
    expect(screen.getByText('暂无运行实例')).toBeInTheDocument()

    firstPs.resolve([
      {
        name: 'late-model',
        model: 'late-model',
        size: 10,
        size_vram: 5,
        digest: 'digest-late',
        expires_at: '2099-01-01T00:00:00Z',
      },
    ])

    await waitFor(() => {
      expect(screen.queryByText('late-model')).not.toBeInTheDocument()
    })
  })

  it('renders the running instances section with port 11434 and detail and unload actions when ollama_ps returns items', async () => {
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
    expect(screen.getByRole('button', { name: '卸载' })).toBeInTheDocument()
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

  it('invokes ollama_unload_model from the running instances list and refreshes items', async () => {
    const user = userEvent.setup()

    mockInvoke.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
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
      if (command === 'ollama_unload_model') {
        expect(payload).toEqual({ model: 'qwen2.5:7b' })
        return undefined
      }
      return undefined
    })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    await user.click(await screen.findByRole('button', { name: '卸载' }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('ollama_unload_model', {
        model: 'qwen2.5:7b',
      })
    })

    expect(mockToastSuccess).toHaveBeenCalledWith('模型 qwen2.5:7b 已卸载')
    const psCalls = mockInvoke.mock.calls.filter(
      ([command]) => command === 'ollama_ps'
    ).length
    expect(psCalls).toBeGreaterThan(1)
  })

  it('clears the selected instance when the opened item disappears from the running list', async () => {
    const user = userEvent.setup()
    let includeInstance = true

    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'ollama_ps') {
        return includeInstance
          ? [
              {
                name: 'qwen2.5:7b',
                model: 'qwen2.5:7b',
                size: 8 * 1024 * 1024 * 1024,
                size_vram: 4 * 1024 * 1024 * 1024,
                digest: 'digest-1',
                expires_at: '2099-01-01T00:00:00Z',
              },
            ]
          : []
      }
      return undefined
    })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    await user.click(await screen.findByRole('button', { name: '查看详情' }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    includeInstance = false
    await user.click(screen.getByRole('button', { name: /鍒锋柊|刷新/ }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByText('暂无运行实例')).toBeInTheDocument()
  })
})
