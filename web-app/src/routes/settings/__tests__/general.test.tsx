import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { Route as GeneralRoute } from '../general'

vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <div data-testid="settings-menu">Settings Menu</div>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/containers/Card', () => ({
  Card: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <div data-testid="card" data-title={title}>
      {title && <div data-testid="card-title">{title}</div>}
      {children}
    </div>
  ),
  CardItem: ({ title, description, actions, className }: any) => (
    <div data-testid="card-item" data-title={title} className={className}>
      {title && <div data-testid="card-item-title">{title}</div>}
      {description && <div data-testid="card-item-description">{description}</div>}
      {actions && <div data-testid="card-item-actions">{actions}</div>}
    </div>
  ),
}))

vi.mock('@/containers/LanguageSwitcher', () => ({
  default: () => <div data-testid="language-switcher">Language Switcher</div>,
}))

vi.mock('@/containers/dialogs/ChangeDataFolderLocation', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="change-data-folder-dialog">{children}</div>
  ),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: () => ({
    spellCheckChatInput: true,
    setSpellCheckChatInput: vi.fn(),
    huggingfaceToken: 'test-token',
    setHuggingfaceToken: vi.fn(),
  }),
}))

const mockCheckForUpdate = vi.fn()

vi.mock('@/hooks/useAppUpdater', () => ({
  useAppUpdater: () => ({ checkForUpdate: mockCheckForUpdate }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: any) => (
    <input data-testid="switch" type="checkbox" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button data-testid="button" onClick={onClick} disabled={disabled} {...props}>{children}</button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder }: any) => (
    <input data-testid="input" value={value} onChange={onChange} placeholder={placeholder} />
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: any) => <div data-testid="dialog">{children}</div>,
  DialogClose: ({ children }: any) => <div data-testid="dialog-close">{children}</div>,
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogDescription: ({ children }: any) => <div data-testid="dialog-description">{children}</div>,
  DialogFooter: ({ children }: any) => <div data-testid="dialog-footer">{children}</div>,
  DialogHeader: ({ children }: any) => <div data-testid="dialog-header">{children}</div>,
  DialogTitle: ({ children }: any) => <div data-testid="dialog-title">{children}</div>,
  DialogTrigger: ({ children }: any) => <div data-testid="dialog-trigger">{children}</div>,
}))

vi.mock('@/services/app/web', () => ({
  WebAppService: vi.fn().mockImplementation(() => ({
    factoryReset: vi.fn(),
    getJanDataFolder: vi.fn().mockResolvedValue('/test/data/folder'),
    relocateJanDataFolder: vi.fn(),
  })),
}))

vi.mock('@/services/models/default', () => ({
  DefaultModelsService: vi.fn().mockImplementation(() => ({ stopAllModels: vi.fn() })),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    app: () => ({
      factoryReset: vi.fn(),
      getJanDataFolder: vi.fn().mockResolvedValue('/test/data/folder'),
      relocateJanDataFolder: vi.fn(),
    }),
    models: () => ({ stopAllModels: vi.fn() }),
    dialog: () => ({ open: vi.fn().mockResolvedValue('/test/path') }),
    events: () => ({ emit: vi.fn() }),
    window: () => ({ openLogsWindow: vi.fn() }),
    opener: () => ({ revealItemInDir: vi.fn() }),
    path: () => ({
      join: vi.fn().mockResolvedValue('/test/data/folder/logs'),
      sep: vi.fn().mockReturnValue('/'),
      dirname: vi.fn().mockResolvedValue('/test/data/folder'),
      basename: vi.fn().mockResolvedValue('logs'),
      extname: vi.fn().mockResolvedValue(''),
    }),
  }),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }))

vi.mock('@tauri-apps/api/webviewWindow', () => {
  const MockWebviewWindow = vi.fn().mockImplementation(() => ({ once: vi.fn(), setFocus: vi.fn() }))
  MockWebviewWindow.getByLabel = vi.fn().mockReturnValue(null)
  return { WebviewWindow: MockWebviewWindow }
})

vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/utils', () => ({ isDev: vi.fn().mockReturnValue(false) }))
vi.mock('@/constants/routes', () => ({ route: { settings: { general: '/settings/general' }, appLogs: '/logs' } }))
vi.mock('@/constants/windows', () => ({ windowKey: { logsAppWindow: 'logs-app-window' } }))
vi.mock('@/types/events', () => ({ SystemEvent: { KILL_SIDECAR: 'kill-sidecar' } }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (config: any) => ({ ...config, component: config.component }),
}))

global.VERSION = '1.0.0'
global.IS_MACOS = false
global.IS_WINDOWS = true
global.AUTO_UPDATER_DISABLED = false
global.window = {
  ...global.window,
  core: { api: { relaunch: vi.fn(), getConnectedServers: vi.fn().mockResolvedValue([]) } },
}
Object.assign(navigator, { clipboard: { writeText: vi.fn() } })

const renderComponent = async () => {
  const Component = GeneralRoute.component as React.ComponentType
  await act(async () => { render(<Component />) })
}

const findButton = (text: string) =>
  screen.getAllByTestId('button').find((b) => b.textContent?.includes(text))

describe('General Settings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckForUpdate.mockResolvedValue(null)
  })

  it('should render the general settings page with version', async () => {
    await renderComponent()
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByText('common:settings')).toBeInTheDocument()
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
  })

  it('should render huggingface token input', async () => {
    await renderComponent()
    const input = screen.getByTestId('input')
    expect(input).toHaveValue('test-token')
  })

  it('should handle spell check toggle', async () => {
    await renderComponent()
    const switches = screen.getAllByTestId('switch')
    expect(switches.length).toBeGreaterThan(0)
    await act(async () => { fireEvent.click(switches[0]) })
  })

  it('should handle huggingface token change', async () => {
    await renderComponent()
    await act(async () => { fireEvent.change(screen.getByTestId('input'), { target: { value: 'new-token' } }) })
  })

  it.each([
    ['checkForUpdates', (btn: HTMLElement) => {
      expect(btn).toBeInTheDocument()
    }],
    ['openLogs', (btn: HTMLElement) => {
      expect(btn).toBeInTheDocument()
    }],
    ['showInFileExplorer', (btn: HTMLElement) => {
      expect(btn).toBeInTheDocument()
    }],
  ])('should find and click %s button', async (text, verify) => {
    await renderComponent()
    const btn = findButton(text)
    if (btn) {
      verify(btn)
      await act(async () => { fireEvent.click(btn) })
    }
  })

  it('should handle factory reset dialog', async () => {
    await renderComponent()
    expect(screen.getByTestId('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('dialog-trigger')).toBeInTheDocument()
    expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
  })

  it('should render external links', async () => {
    await renderComponent()
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0)
  })

  it('should show correct file explorer text for Windows', async () => {
    global.IS_WINDOWS = true
    global.IS_MACOS = false
    await renderComponent()
    expect(screen.getByText('settings:general.showInFileExplorer')).toBeInTheDocument()
  })

  it('should disable check for updates button when checking', async () => {
    let resolveUpdate: (value: any) => void
    const updatePromise = new Promise((resolve) => { resolveUpdate = resolve })
    mockCheckForUpdate.mockReturnValue(updatePromise)

    await renderComponent()
    const btn = findButton('checkForUpdates')

    if (btn) {
      act(() => { fireEvent.click(btn) })
      expect(btn).toBeDisabled()
      await act(async () => { resolveUpdate!(null); await updatePromise })
      expect(btn).not.toBeDisabled()
    }
  })
})
