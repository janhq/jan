import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Route as McpServersRoute } from '../mcp-servers'
import { useAppState } from '@/hooks/useAppState'

const activateMCPServer = vi.fn()
const deactivateMCPServer = vi.fn()
const getConnectedServers = vi.fn().mockResolvedValue([])

vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <div data-testid="settings-menu">Settings Menu</div>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/containers/Card', () => ({
  Card: ({ header, children }: { header?: React.ReactNode; children: React.ReactNode }) => (
    <div data-testid="card">
      {header}
      {children}
    </div>
  ),
  CardItem: ({
    title,
    description,
    actions,
  }: {
    title?: React.ReactNode
    description?: React.ReactNode
    actions?: React.ReactNode
  }) => (
    <div data-testid="card-item">
      <div>{title}</div>
      <div>{description}</div>
      <div>{actions}</div>
    </div>
  ),
}))

vi.mock('@/containers/dialogs/AddEditMCPServer', () => ({
  default: () => null,
}))

vi.mock('@/containers/dialogs/DeleteMCPServerConfirm', () => ({
  default: () => null,
}))

vi.mock('@/containers/dialogs/EditJsonMCPserver', () => ({
  default: () => null,
}))

vi.mock('@/containers/McpRouterModelPicker', () => ({
  McpRouterModelPicker: () => null,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => <button onClick={onClick}>{children}</button>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked?: boolean
    onCheckedChange?: (value: boolean) => void
    disabled?: boolean
  }) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={checked}
      onClick={() => onCheckedChange?.(!checked)}
    >
      toggle
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    mcp: () => ({
      activateMCPServer,
      deactivateMCPServer,
      getConnectedServers,
    }),
  }),
}))

vi.mock('@/hooks/useToolApproval', () => ({
  useToolApproval: () => ({
    allowAllMCPPermissions: true,
    setAllowAllMCPPermissions: vi.fn(),
  }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: (state: { providers: never[] }) => unknown) =>
    selector({ providers: [] }),
}))

vi.mock('@/hooks/useMCPServers', () => ({
  DEFAULT_MCP_SETTINGS: {
    toolCallTimeoutSeconds: 60,
    enableSmartToolRouting: false,
    useLightweightRouterModel: false,
    routerModelProvider: '',
    routerModelId: '',
  },
  useMCPServers: () => ({
    mcpServers: {
      NotesMCP: {
        command: 'npx',
        args: ['notes'],
        env: {},
        type: 'stdio',
        active: false,
      },
    },
    settings: {
      toolCallTimeoutSeconds: 60,
      enableSmartToolRouting: false,
      useLightweightRouterModel: false,
      routerModelProvider: '',
      routerModelId: '',
    },
    addServer: vi.fn(),
    editServer: vi.fn(),
    renameServer: vi.fn(),
    deleteServer: vi.fn(),
    syncServers: vi.fn(),
    syncServersAndRestart: vi.fn(),
    getServerConfig: () => ({
      command: 'npx',
      args: ['notes'],
      env: {},
      type: 'stdio',
      active: false,
    }),
    setSettings: vi.fn(),
    updateSettings: vi.fn(),
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.serverKey ? `${key}:${params.serverKey}` : key,
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('@/types/events', () => ({
  SystemEvent: {
    MCP_UPDATE: 'mcp-update',
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (config: { component: React.ComponentType }) => config,
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      mcp_servers: '/settings/mcp-servers',
    },
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('MCP servers route error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppState.setState({
      errorMessage: undefined,
    })
    getConnectedServers.mockResolvedValue([])
  })

  it('stores a normalized activation error when activation rejects with an Error', async () => {
    activateMCPServer.mockRejectedValueOnce(new Error('stdio startup failed'))

    const Component = McpServersRoute.component as React.ComponentType
    render(<Component />)

    const toggles = screen.getAllByRole('button', { name: 'toggle' })
    await act(async () => {
      fireEvent.click(toggles[toggles.length - 1])
    })

    await waitFor(() => {
      expect(useAppState.getState().errorMessage).toEqual({
        message: 'stdio startup failed',
        subtitle: 'mcp-servers:checkParams',
      })
    })
  })

  it('stores a normalized activation error when activation rejects with an object payload', async () => {
    activateMCPServer.mockRejectedValueOnce({ message: 'wrapped startup failed' })

    const Component = McpServersRoute.component as React.ComponentType
    render(<Component />)

    const toggles = screen.getAllByRole('button', { name: 'toggle' })
    await act(async () => {
      fireEvent.click(toggles[toggles.length - 1])
    })

    await waitFor(() => {
      expect(useAppState.getState().errorMessage?.message).toBe('wrapped startup failed')
    })
  })
})
