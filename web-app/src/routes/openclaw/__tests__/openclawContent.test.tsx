import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockInstallOpenClaw,
  mockLaunchOpenClaw,
  mockOpenDashboard,
  mockRefreshOpenClaw,
  mockRestartOpenClaw,
  mockSaveConfig,
  mockStopOpenClaw,
  mockUseOpenClaw,
  mockUseOllamaStatus,
  mockToastError,
} = vi.hoisted(() => ({
  mockInstallOpenClaw: vi.fn(),
  mockLaunchOpenClaw: vi.fn(),
  mockOpenDashboard: vi.fn(),
  mockRefreshOpenClaw: vi.fn(),
  mockRestartOpenClaw: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockStopOpenClaw: vi.fn(),
  mockUseOpenClaw: vi.fn(),
  mockUseOllamaStatus: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/hooks/useOllamaStatus', () => ({
  useOllamaStatus: mockUseOllamaStatus,
}))

vi.mock('@/hooks/useOpenClaw', () => ({
  useOpenClaw: mockUseOpenClaw,
}))

vi.mock('sonner', () => ({
  toast: {
    error: mockToastError,
  },
}))

import { Route } from '../index'

function buildUseOpenClawState(overrides: Record<string, unknown> = {}) {
  return {
    status: 'installed',
    gatewayUrl: undefined,
    version: 'OpenClaw 2026.4.24',
    isLoading: false,
    installProgress: 0,
    installMessage: '',
    errorMessage: undefined,
    runtimeSummary: {
      gatewayPort: 18789,
      launchMode: 'existing-config',
      selectedModel: undefined,
    },
    diagnostics: {
      serviceLoaded: false,
      serviceLabel: 'Scheduled Task',
      serviceRuntimeStatus: 'stopped',
      serviceRuntimeDetail: 'Gateway service missing.',
      rpcOk: false,
      rpcError: 'connect ECONNREFUSED 127.0.0.1:18789',
      portStatus: 'free',
      cliConfigExists: false,
      daemonConfigExists: false,
      configValid: true,
      health: 'stopped',
    },
    install: mockInstallOpenClaw,
    launch: mockLaunchOpenClaw,
    stop: mockStopOpenClaw,
    restart: mockRestartOpenClaw,
    openDashboard: mockOpenDashboard,
    saveConfig: mockSaveConfig,
    refresh: mockRefreshOpenClaw,
    ...overrides,
  }
}

describe('OpenClawContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_MACOS', false)

    mockUseOllamaStatus.mockReturnValue({
      isRunning: false,
      models: [],
    })

    mockUseOpenClaw.mockReturnValue(buildUseOpenClawState())
  })

  it('still opens the launch dialog when there is no local Ollama model available', async () => {
    const user = userEvent.setup()
    const Component = Route.component as React.ComponentType

    render(<Component />)

    await user.click(screen.getByRole('button', { name: '启动' }))

    await waitFor(() => {
      expect(screen.getByText('启动 OpenClaw Gateway')).toBeInTheDocument()
    })
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('renders a single config entry while keeping the runtime summary visible', () => {
    mockUseOpenClaw.mockReturnValue(
      buildUseOpenClawState({
        status: 'running',
        gatewayUrl: 'http://127.0.0.1:18789/',
        diagnostics: {
          serviceLoaded: true,
          serviceLabel: 'Scheduled Task',
          serviceRuntimeStatus: 'running',
          serviceRuntimeDetail: 'Task is currently running.',
          rpcOk: true,
          rpcError: undefined,
          portStatus: 'in-use',
          cliConfigExists: true,
          daemonConfigExists: true,
          configValid: true,
          health: 'running',
        },
      })
    )

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(screen.getAllByText('OpenClaw 实例')).toHaveLength(1)
    expect(screen.getByText('配置摘要')).toBeInTheDocument()
    expect(screen.getByText('Gateway 运行正常')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '编辑配置' })).toHaveLength(1)
  })

  it('surfaces degraded runtime state when gateway service is up but rpc is down', () => {
    mockUseOpenClaw.mockReturnValue(
      buildUseOpenClawState({
        status: 'degraded',
        gatewayUrl: 'http://127.0.0.1:18789/',
        errorMessage: 'Gateway listener is up, but rpc is not ready yet.',
        diagnostics: {
          serviceLoaded: true,
          serviceLabel: 'Scheduled Task',
          serviceRuntimeStatus: 'running',
          serviceRuntimeDetail: 'Task is currently running.',
          rpcOk: false,
          rpcError: 'handshake timeout',
          portStatus: 'in-use',
          cliConfigExists: true,
          daemonConfigExists: true,
          configValid: true,
          health: 'degraded',
        },
      })
    )

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('Gateway 部分可用，但状态异常')).toBeInTheDocument()
    expect(screen.getByText('down: handshake timeout')).toBeInTheDocument()
    expect(screen.getByText('Gateway listener is up, but rpc is not ready yet.')).toBeInTheDocument()
  })

  it('disables the remaining config entry while OpenClaw is starting', () => {
    mockUseOpenClaw.mockReturnValue(
      buildUseOpenClawState({
        status: 'starting',
        isLoading: true,
        installMessage: 'Starting gateway...',
      })
    )

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('正在启动 Gateway')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑配置' })).toBeDisabled()
  })
})
