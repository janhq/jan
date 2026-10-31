import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Route as LocalApiServerRoute } from '../local-api-server'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { toast } from 'sonner'

const ensureModelForServer = vi.hoisted(() => vi.fn())
const startServer = vi.hoisted(() => vi.fn())
// One stable object: the page re-runs an effect whenever the hub identity changes.
const hub = vi.hoisted(() => ({
  models: () => ({ getActiveModels: () => Promise.resolve([]) }),
  app: () => ({ getServerStatus: () => Promise.resolve(false) }),
  window: () => ({ openLocalApiServerLogsWindow: () => Promise.resolve() }),
}))

vi.mock('@/utils/ensureModelForServer', () => ({ ensureModelForServer }))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => hub,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/containers/SettingsMenu', () => ({ default: () => null }))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/containers/ServerHostSwitcher', () => ({ ServerHostSwitcher: () => null }))
vi.mock('@/containers/PortInput', () => ({ PortInput: () => null }))
vi.mock('@/containers/ProxyTimeoutInput', () => ({ ProxyTimeoutInput: () => null }))
vi.mock('@/containers/ApiPrefixInput', () => ({ ApiPrefixInput: () => null }))
vi.mock('@/containers/TrustedHostsInput', () => ({ TrustedHostsInput: () => null }))
vi.mock('@/components/LogViewer', () => ({ LogViewer: () => null }))
vi.mock('@/containers/ApiKeyInput', () => ({ ApiKeyInput: () => null }))
vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}))

const Page = LocalApiServerRoute.options.component as React.ComponentType

function clickStart() {
  fireEvent.click(screen.getByText('settings:localApiServer.startServer'))
}

describe('Local API server page: starting on a public address', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureModelForServer.mockResolvedValue({ status: 'loaded' })
    startServer.mockResolvedValue(1337)
    ;(window as unknown as { core: unknown }).core = { api: { startServer } }
    useAppState.setState({ serverStatus: 'stopped' })
  })

  it.each(['', '   '])(
    'asks for an API key instead of loading a model when the host is 0.0.0.0 and the key is %j',
    (apiKey) => {
      useLocalApiServer.setState({ serverHost: '0.0.0.0', apiKey })
      render(<Page />)

      clickStart()

      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(vi.mocked(toast.error).mock.calls[0][1]?.description).toContain('0.0.0.0')
      expect(ensureModelForServer).not.toHaveBeenCalled()
      expect(startServer).not.toHaveBeenCalled()
      expect(useAppState.getState().serverStatus).toBe('stopped')
    }
  )

  it('starts on 0.0.0.0 once a key is set', async () => {
    useLocalApiServer.setState({ serverHost: '0.0.0.0', apiKey: 'secret' })
    render(<Page />)

    clickStart()

    await waitFor(() => expect(startServer).toHaveBeenCalledTimes(1))
    expect(startServer.mock.calls[0][0]).toMatchObject({
      host: '0.0.0.0',
      apiKey: 'secret',
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('still starts on 127.0.0.1 with no key', async () => {
    useLocalApiServer.setState({ serverHost: '127.0.0.1', apiKey: '' })
    render(<Page />)

    clickStart()

    await waitFor(() => expect(startServer).toHaveBeenCalledTimes(1))
    expect(startServer.mock.calls[0][0]).toMatchObject({ host: '127.0.0.1' })
    expect(toast.error).not.toHaveBeenCalled()
  })
})
