import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Route as McpServersRoute } from '../mcp-servers'
import { useMCPServers, DEFAULT_MCP_SETTINGS } from '@/hooks/useMCPServers'
import { useAppState } from '@/hooks/useAppState'
import { toast } from 'sonner'

let formProps: { onSave: (name: string, config: import('@/hooks/useMCPServers').MCPServerConfig) => Promise<void> }
let jsonProps: { onSave: (data: unknown) => Promise<void> }
let deleteProps: { onConfirm: () => Promise<void> }

const activateMCPServer = vi.fn()
const deactivateMCPServer = vi.fn()
const getConnectedServers = vi.fn().mockResolvedValue([])
const getMCPAuthStatus = vi.fn().mockResolvedValue(null)
const authorizeMCPServer = vi.fn().mockResolvedValue(undefined)
const updateMCPConfig = vi.fn().mockResolvedValue(undefined)

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
  default: (props: typeof formProps) => { formProps = props; return null },
}))

vi.mock('@/containers/dialogs/DeleteMCPServerConfirm', () => ({
  default: (props: typeof deleteProps) => { deleteProps = props; return null },
}))

vi.mock('@/containers/dialogs/EditJsonMCPserver', () => ({
  default: (props: typeof jsonProps) => { jsonProps = props; return null },
}))

vi.mock('@/containers/McpRouterModelPicker', () => ({
  McpRouterModelPicker: () => null,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    title,
  }: {
    title?: string
    children: React.ReactNode
    onClick?: () => void
  }) => <button title={title} onClick={onClick}>{children}</button>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    loading,
  }: {
    checked?: boolean
    onCheckedChange?: (value: boolean) => void
    disabled?: boolean
    loading?: boolean
  }) => (
    <button
      type="button"
      disabled={disabled || loading}
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

vi.mock('@/hooks/useServiceHub', () => {
  const hub = { mcp: () => ({ activateMCPServer, deactivateMCPServer, getConnectedServers, updateMCPConfig, getMCPAuthStatus, authorizeMCPServer }) }
  return { useServiceHub: () => hub, getServiceHub: () => hub }
})

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
    info: vi.fn(),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  useAppState.setState({ errorMessage: undefined })
  getMCPAuthStatus.mockResolvedValue(null)
  activateMCPServer.mockReset().mockResolvedValue(undefined)
  updateMCPConfig.mockReset().mockResolvedValue(undefined)
  deactivateMCPServer.mockReset().mockResolvedValue(undefined)
  useMCPServers.setState({
    mcpServers: { NotesMCP: { command: 'npx', args: ['notes'], env: {}, type: 'stdio', active: false } },
    settings: { ...DEFAULT_MCP_SETTINGS, toolCallTimeoutSeconds: 60, enableSmartToolRouting: false },
  })
})

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

// #8557: users had no way to bound an MCP result before it filled the context.
describe('max tool output characters control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getConnectedServers.mockResolvedValue([])
  })

  const capInput = (): HTMLInputElement => {
    const inputs = screen.getAllByRole<HTMLInputElement>('spinbutton')
    const found = inputs.find((i) => i.value === '40000')
    if (!found) throw new Error('cap input not rendered')
    return found
  }

  it('shows the configured cap and saves an edited one', async () => {
    const Component = McpServersRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    fireEvent.change(capInput(), { target: { value: '12000' } })

    fireEvent.blur(screen.getAllByRole('spinbutton')[1])
    await waitFor(() => expect(useMCPServers.getState().settings.maxToolOutputChars).toBe(12000))
  })

  it('accepts 0 as an explicit opt-out rather than rejecting it', async () => {
    const Component = McpServersRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    fireEvent.change(capInput(), { target: { value: '0' } })

    fireEvent.blur(screen.getAllByRole('spinbutton')[1])
    await waitFor(() => expect(useMCPServers.getState().settings.maxToolOutputChars).toBe(0))
  })

  it('restores the default when the field is cleared', async () => {
    // An empty box must not persist as "0 characters of tool output".
    const Component = McpServersRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    fireEvent.change(capInput(), { target: { value: '' } })

    fireEvent.blur(screen.getAllByRole('spinbutton')[1])
    await waitFor(() => expect(updateMCPConfig).toHaveBeenCalled())
    expect(useMCPServers.getState().settings.maxToolOutputChars).toBe(40000)
  })
})


describe('MCP disconnect and settings persistence reliability', () => {
  const serverToggle = () => screen.getAllByRole('button', { name: 'toggle' }).at(-1)!
  const renderActive = async () => {
    const config = useMCPServers.getState().mcpServers.NotesMCP
    useMCPServers.getState().editServer('NotesMCP', { ...config, active: true })
    getConnectedServers.mockResolvedValue(['NotesMCP'])
    const Component = McpServersRoute.component as React.ComponentType
    render(<Component />)
    await waitFor(() => expect(getConnectedServers).toHaveBeenCalled())
  }

  it('preserves enabled state when deactivation fails, clears loading and allows retry', async () => {
    deactivateMCPServer.mockRejectedValueOnce(new Error('disconnect failed'))
    await renderActive()
    fireEvent.click(serverToggle())
    await waitFor(() => expect(useAppState.getState().errorMessage?.message).toBe('disconnect failed'))
    expect(useMCPServers.getState().mcpServers.NotesMCP.active).toBe(true)
    expect(updateMCPConfig).not.toHaveBeenCalled()
    expect(serverToggle()).not.toBeDisabled()
    expect(serverToggle()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(serverToggle())
    await waitFor(() => expect(serverToggle()).toHaveAttribute('aria-pressed', 'false'))
    expect(deactivateMCPServer).toHaveBeenCalledTimes(2)
  })

  it('rolls back the enabled preference and refreshes live state when disconnect config save fails', async () => {
    await renderActive()
    getConnectedServers.mockResolvedValue([])
    updateMCPConfig.mockRejectedValueOnce(new Error('config write failed'))
    const refreshCount = getConnectedServers.mock.calls.length
    fireEvent.click(serverToggle())
    await waitFor(() => expect(useAppState.getState().errorMessage?.message).toBe('config write failed'))
    expect(useMCPServers.getState().mcpServers.NotesMCP.active).toBe(true)
    expect(activateMCPServer).not.toHaveBeenCalled()
    expect(getConnectedServers.mock.calls.length).toBeGreaterThan(refreshCount)
    expect(serverToggle()).not.toBeDisabled()
    fireEvent.click(serverToggle())
    await waitFor(() => expect(serverToggle()).toHaveAttribute('aria-pressed', 'false'))
  })

  it('keeps the prior enabled preference and refreshes live state after failed activation', async () => {
    activateMCPServer.mockRejectedValueOnce(new Error('handshake failed'))
    // A failed handshake may leave backend enabled state; it is not a live
    // connection, and the UI must not infer connectivity from config.active.
    getConnectedServers.mockResolvedValue([])
    const Component = McpServersRoute.component as React.ComponentType
    render(<Component />)
    await waitFor(() => expect(getConnectedServers).toHaveBeenCalled())
    const count = getConnectedServers.mock.calls.length
    fireEvent.click(serverToggle())
    await waitFor(() => expect(useAppState.getState().errorMessage?.message).toBe('handshake failed'))
    expect(useMCPServers.getState().mcpServers.NotesMCP.active).toBe(false)
    expect(updateMCPConfig).not.toHaveBeenCalled()
    expect(getConnectedServers.mock.calls.length).toBeGreaterThan(count)
    expect(serverToggle()).not.toBeDisabled()
  })

  it('rolls back config after activation persistence fails without guessing connectivity', async () => {
    activateMCPServer.mockResolvedValueOnce(undefined)
    getConnectedServers.mockResolvedValue(['NotesMCP'])
    updateMCPConfig.mockRejectedValueOnce(new Error('activation save failed'))
    const Component = McpServersRoute.component as React.ComponentType
    render(<Component />)
    fireEvent.click(serverToggle())
    await waitFor(() => expect(useAppState.getState().errorMessage?.message).toBe('activation save failed'))
    expect(useMCPServers.getState().mcpServers.NotesMCP.active).toBe(false)
    expect(deactivateMCPServer).not.toHaveBeenCalled()
    expect(serverToggle()).not.toBeDisabled()
  })

  it('keeps a settings switch unchanged on save failure and allows retry', async () => {
    updateMCPConfig.mockRejectedValueOnce(new Error('routing save failed'))
    const Component = McpServersRoute.component as React.ComponentType
    render(<Component />)
    const routing = screen.getAllByRole('button', { name: 'toggle' })[1]
    fireEvent.click(routing)
    await waitFor(() => expect(useAppState.getState().errorMessage?.message).toBe('routing save failed'))
    expect(routing).toHaveAttribute('aria-pressed', 'false')
    expect(routing).not.toBeDisabled()
    fireEvent.click(routing)
    await waitFor(() => expect(routing).toHaveAttribute('aria-pressed', 'true'))
  })

  it('does not show failed settings as saved and permits retry', async () => {
    updateMCPConfig.mockRejectedValueOnce(new Error('settings write failed'))
    const Component = McpServersRoute.component as React.ComponentType
    render(<Component />)
    const input = screen.getAllByRole('spinbutton')[1]
    fireEvent.change(input, { target: { value: '12000' } })
    fireEvent.blur(input)
    await waitFor(() => expect(useAppState.getState().errorMessage?.message).toBe('settings write failed'))
    expect(useMCPServers.getState().settings.maxToolOutputChars).toBe(40000)
    expect(input).toHaveValue(40000)
    expect(input).not.toBeDisabled()
    fireEvent.change(input, { target: { value: '12000' } })
    fireEvent.blur(input)
    await waitFor(() => expect(useMCPServers.getState().settings.maxToolOutputChars).toBe(12000))
  })
})


describe('MCP reconfiguration transactions', () => {
  const config = { command: 'new-command', args: ['new-args'], env: { TOKEN: 'new-token' }, active: true }
  const start = (live = true) => {
    getConnectedServers.mockResolvedValue(live ? ['NotesMCP'] : [])
    const Component = McpServersRoute.component as React.ComponentType
    render(<Component />)
  }

  it.each(['form', 'json'])('saves a confirmed OAuth challenge inactive via %s, with explicit Sign In', async (mode) => {
    const oauth = { ...config, type: 'http' as const, url: 'https://oauth.example/mcp' }
    getMCPAuthStatus.mockResolvedValue({
      state: 'unauthenticated', canAuthenticate: true, hasCredentials: false,
      renewable: false, expiresAt: null,
    })
    activateMCPServer.mockRejectedValueOnce(new Error('NEEDS_AUTH: no credentials are stored (rmcp private detail)'))
    start(false)
    if (mode === 'form') {
      await act(async () => formProps.onSave('OAuth', oauth))
    } else {
      fireEvent.click(screen.getByTitle('mcp-servers:editAllJson'))
      await act(async () => jsonProps.onSave({ mcpServers: { OAuth: oauth } }))
    }
    expect(useMCPServers.getState().mcpServers.OAuth).toEqual({ ...oauth, active: false })
    expect(JSON.parse(updateMCPConfig.mock.calls[0][0]).mcpServers.OAuth.active).toBe(false)
    expect(useAppState.getState().errorMessage).toBeUndefined()
    expect(toast.info).toHaveBeenCalledWith('mcp-servers:auth.needsAuth', {
      description: 'mcp-servers:auth.needsAuthHint',
    })
    expect(authorizeMCPServer).not.toHaveBeenCalled()
    await waitFor(() => expect(getMCPAuthStatus).toHaveBeenCalledWith('OAuth'))
    getMCPAuthStatus.mockResolvedValue(null)
  })

  it('still rejects persistence failure after a recoverable OAuth challenge', async () => {
    const previous = useMCPServers.getState().mcpServers
    activateMCPServer.mockRejectedValueOnce('NEEDS_AUTH: no credentials')
    updateMCPConfig.mockRejectedValueOnce(new Error('write failed'))
    start(false)
    await act(async () => { await expect(formProps.onSave('OAuth', config)).rejects.toThrow('write failed') })
    expect(useMCPServers.getState().mcpServers).toEqual(previous)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it.each(['Failed to connect to server: protocol mismatch', 'transport: NEEDS_AUTH: not a backend marker', 'HTTP 401 unauthorized'])('rejects untagged activation failure: %s', async (message) => {
    const previous = useMCPServers.getState().mcpServers
    activateMCPServer.mockRejectedValueOnce(new Error(message))
    start(false)
    await act(async () => { await expect(formProps.onSave('OAuth', config)).rejects.toThrow(message) })
    expect(useMCPServers.getState().mcpServers).toEqual(previous)
    expect(updateMCPConfig).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('awaits disconnect before committing and activating edited form config', async () => {
    let finish!: () => void
    deactivateMCPServer.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    start()
    fireEvent.click(screen.getByTitle('mcp-servers:editServer'))
    let save!: Promise<void>
    act(() => { save = formProps.onSave('NotesMCP', config) })
    await waitFor(() => expect(deactivateMCPServer).toHaveBeenCalled())
    expect(activateMCPServer).not.toHaveBeenCalled()
    expect(useMCPServers.getState().mcpServers.NotesMCP.command).toBe('npx')
    await act(async () => { finish(); await save })
    expect(activateMCPServer).toHaveBeenCalledExactlyOnceWith('NotesMCP', config)
    expect(JSON.parse(updateMCPConfig.mock.calls[0][0]).mcpServers.NotesMCP).toEqual(config)
  })

  it('preserves disabled form edits and handles rename without a guarded toggle', async () => {
    start()
    fireEvent.click(screen.getByTitle('mcp-servers:editServer'))
    await act(async () => formProps.onSave('Renamed', { ...config, active: false }))
    expect(deactivateMCPServer).toHaveBeenCalledExactlyOnceWith('NotesMCP')
    expect(activateMCPServer).not.toHaveBeenCalled()
    expect(useMCPServers.getState().mcpServers).toEqual({ Renamed: { ...config, active: false } })
  })

  it('awaits single JSON reconfiguration and persists new credentials', async () => {
    start()
    fireEvent.click(screen.getAllByTitle('mcp-servers:editJson.title')[0])
    await act(async () => jsonProps.onSave(config))
    expect(activateMCPServer).toHaveBeenCalledWith('NotesMCP', config)
    expect(JSON.parse(updateMCPConfig.mock.calls[0][0]).mcpServers.NotesMCP).toEqual(config)
  })

  it('replaces all JSON servers only after disconnects and persists settings once', async () => {
    start()
    fireEvent.click(screen.getByTitle('mcp-servers:editAllJson'))
    await act(async () => jsonProps.onSave({ mcpServers: { Other: config }, mcpSettings: { ...DEFAULT_MCP_SETTINGS, maxToolOutputChars: 123 } }))
    expect(deactivateMCPServer).toHaveBeenCalledWith('NotesMCP')
    expect(activateMCPServer).toHaveBeenCalledExactlyOnceWith('Other', config)
    expect(updateMCPConfig).toHaveBeenCalledTimes(1)
    expect(useMCPServers.getState().settings.maxToolOutputChars).toBe(123)
  })

  it.each(['disconnect', 'activate', 'persist'])('rejects %s failure and rolls back preference without reconnecting old credentials', async (stage) => {
    const previous = useMCPServers.getState().mcpServers
    if (stage === 'disconnect') deactivateMCPServer.mockRejectedValueOnce(new Error('failed'))
    if (stage === 'activate') activateMCPServer.mockRejectedValueOnce(new Error('failed'))
    if (stage === 'persist') updateMCPConfig.mockRejectedValueOnce(new Error('failed'))
    start()
    fireEvent.click(screen.getByTitle('mcp-servers:editServer'))
    await act(async () => { await expect(formProps.onSave('NotesMCP', config)).rejects.toThrow('failed') })
    expect(useMCPServers.getState().mcpServers).toEqual(previous)
    expect(useAppState.getState().errorMessage?.message).toBe('failed')
    expect(activateMCPServer.mock.calls.every(([, value]) => value.command === 'new-command')).toBe(true)
    await act(async () => formProps.onSave('NotesMCP', config))
    expect(useMCPServers.getState().mcpServers.NotesMCP).toEqual(config)
  })

  it('keeps a deletion retryable after disconnect failure', async () => {
    deactivateMCPServer.mockRejectedValueOnce(new Error('delete failed'))
    start()
    fireEvent.click(screen.getByTitle('mcp-servers:deleteServer.title'))
    await act(async () => { await expect(deleteProps.onConfirm()).rejects.toThrow('delete failed') })
    expect(useMCPServers.getState().mcpServers.NotesMCP).toBeDefined()
    await act(async () => deleteProps.onConfirm())
    expect(useMCPServers.getState().mcpServers.NotesMCP).toBeUndefined()
  })
  it('edits and deletes a disabled offline server without attempting deactivation', async () => {
    deactivateMCPServer.mockRejectedValue(new Error('Server not found'))
    start(false)
    fireEvent.click(screen.getByTitle('mcp-servers:editServer'))
    await act(async () => formProps.onSave('NotesMCP', { ...config, active: false }))
    expect(useMCPServers.getState().mcpServers.NotesMCP.command).toBe('new-command')
    fireEvent.click(screen.getByTitle('mcp-servers:deleteServer.title'))
    await act(async () => deleteProps.onConfirm())
    expect(deactivateMCPServer).not.toHaveBeenCalled()
    expect(useMCPServers.getState().mcpServers).toEqual({})
  })

  it('replaces offline/auth-failed JSON servers without deactivating missing transports', async () => {
    deactivateMCPServer.mockRejectedValue(new Error('Server not found'))
    start(false)
    fireEvent.click(screen.getByTitle('mcp-servers:editAllJson'))
    await act(async () => jsonProps.onSave({ mcpServers: { Other: config } }))
    expect(deactivateMCPServer).not.toHaveBeenCalled()
    expect(activateMCPServer).toHaveBeenCalledExactlyOnceWith('Other', config)
    expect(useMCPServers.getState().mcpServers).toEqual({ Other: config })
  })

})
