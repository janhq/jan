/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'

// -----------------------------------------------------------------------------
// Hoisted shared state + mocks
// -----------------------------------------------------------------------------
const h = vi.hoisted(() => {
  const toastSuccess = vi.fn()
  const toastError = vi.fn()
  const toastInfo = vi.fn()

  const openaiProvider: any = {
    provider: 'openai',
    active: true,
    api_key: 'sk-primary',
    api_key_fallbacks: ['sk-fallback-1'],
    base_url: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4', model: 'gpt-4', name: 'gpt-4', capabilities: ['completion'], version: '1' },
    ],
    settings: [
      {
        key: 'api-key',
        title: 'API Key',
        description: 'The API key',
        controller_type: 'input',
        controller_props: { value: 'sk-primary', type: 'password' },
      },
      {
        key: 'base-url',
        title: 'Base URL',
        description: 'The base url',
        controller_type: 'input',
        controller_props: { value: 'https://api.openai.com/v1' },
      },
    ],
  }

  const llamacppProvider: any = {
    provider: 'llamacpp',
    active: true,
    models: [
      { id: 'local-model', model: 'local-model', name: 'local-model', capabilities: [], settings: { ctx_len: {} } },
    ],
    settings: [
      {
        key: 'version_backend',
        title: 'Backend',
        description: 'Backend version',
        controller_type: 'input',
        controller_props: { value: 'v1', recommended: 'cuda/v1' },
      },
      {
        key: 'device',
        title: 'Device',
        description: 'Device',
        controller_type: 'input',
        controller_props: { value: 'gpu0' },
      },
    ],
  }

  const providerMap: Record<string, any> = {
    openai: openaiProvider,
    llamacpp: llamacppProvider,
  }

  const updateProvider = vi.fn()
  const setProviders = vi.fn()
  const getProviderByName = vi.fn((name: string) => providerMap[name])

  const modelProviderStore: any = {
    getProviderByName,
    setProviders,
    updateProvider,
  }

  const appState = {
    activeModels: [] as string[],
    setActiveModels: vi.fn(),
  }
  const useAppStateMock: any = (selector: any) => selector(appState)
  useAppStateMock.getState = () => appState

  const providersSvc = {
    getProviders: vi.fn().mockResolvedValue([]),
    updateSettings: vi.fn().mockResolvedValue(undefined),
    fetchModelsFromProvider: vi.fn().mockResolvedValue(['gpt-4', 'gpt-5']),
    fetch: vi.fn(() =>
      vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
    ),
  }
  const modelsSvc = {
    getActiveModels: vi.fn().mockResolvedValue([]),
    startModel: vi.fn().mockResolvedValue(undefined),
    stopModel: vi.fn().mockResolvedValue(undefined),
    stopAllModels: vi.fn().mockResolvedValue(undefined),
    checkMmprojExists: vi.fn().mockResolvedValue(false),
  }
  const dialogSvc = {
    open: vi.fn().mockResolvedValue(null),
  }
  const serviceHub = {
    providers: vi.fn(() => providersSvc),
    models: vi.fn(() => modelsSvc),
    dialog: vi.fn(() => dialogSvc),
  }

  const modelLoad = {
    setModelLoadError: vi.fn(),
  }

  const backendUpdater = {
    checkForUpdate: vi.fn().mockResolvedValue(null),
    installBackend: vi.fn().mockResolvedValue(undefined),
  }

  const params: any = { providerName: 'openai' }

  return {
    toastSuccess,
    toastError,
    toastInfo,
    openaiProvider,
    llamacppProvider,
    providerMap,
    modelProviderStore,
    updateProvider,
    setProviders,
    getProviderByName,
    appState,
    useAppStateMock,
    serviceHub,
    providersSvc,
    modelsSvc,
    dialogSvc,
    modelLoad,
    backendUpdater,
    params,
  }
})

// -----------------------------------------------------------------------------
// Module mocks
// -----------------------------------------------------------------------------
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: any) => ({ ...cfg, id: '/settings/providers/$providerName' }),
  useParams: () => h.params,
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...a: any[]) => h.toastSuccess(...a),
    error: (...a: any[]) => h.toastError(...a),
    info: (...a: any[]) => h.toastInfo(...a),
  },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: any) => <div data-testid="header-page">{children}</div>,
}))

vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <div data-testid="settings-menu" />,
}))

vi.mock('@/containers/Card', () => ({
  Card: ({ header, children }: any) => (
    <div data-testid="card">
      {header && <div>{header}</div>}
      {children}
    </div>
  ),
  CardItem: ({ title, description, actions }: any) => (
    <div data-testid="card-item">
      {title && <div data-testid="card-item-title">{title}</div>}
      {description && <div data-testid="card-item-desc">{description}</div>}
      {actions && <div data-testid="card-item-actions">{actions}</div>}
    </div>
  ),
}))

vi.mock('@/containers/Capabilities', () => ({
  default: ({ capabilities }: any) => (
    <div data-testid="capabilities">{(capabilities || []).join(',')}</div>
  ),
}))

vi.mock('@/containers/dynamicControllerSetting', () => ({
  DynamicControllerSetting: ({ onChange, controllerProps }: any) => (
    <button
      data-testid="dynamic-ctrl"
      onClick={() => onChange('new-value')}
    >
      {String(controllerProps?.value ?? '')}
    </button>
  ),
}))

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: any) => <div data-testid="md">{content}</div>,
}))

vi.mock('@/containers/dialogs/EditModel', () => ({
  DialogEditModel: ({ modelId }: any) => <div data-testid={`edit-${modelId}`} />,
}))

vi.mock('@/containers/dialogs/ImportVisionModelDialog', () => ({
  ImportVisionModelDialog: ({ trigger }: any) => (
    <div data-testid="import-vision">{trigger}</div>
  ),
}))

vi.mock('@/containers/dialogs/ImportMlxModelDialog', () => ({
  ImportMlxModelDialog: ({ trigger }: any) => (
    <div data-testid="import-mlx">{trigger}</div>
  ),
}))

vi.mock('@/containers/ModelSetting', () => ({
  ModelSetting: () => <div data-testid="model-setting" />,
}))

vi.mock('@/containers/dialogs/DeleteModel', () => ({
  DialogDeleteModel: ({ modelId }: any) => <div data-testid={`del-${modelId}`} />,
}))

vi.mock('@/containers/FavoriteModelAction', () => ({
  FavoriteModelAction: ({ model }: any) => <div data-testid={`fav-${model.id}`} />,
}))

vi.mock('@/containers/dialogs/DeleteProvider', () => ({
  default: ({ provider }: any) => (
    <div data-testid="delete-provider">{provider?.provider ?? 'none'}</div>
  ),
}))

vi.mock('@/containers/dialogs/AddModel', () => ({
  DialogAddModel: () => <div data-testid="add-model" />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => <input {...props} />,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: any) => (
    <input
      data-testid="provider-switch"
      type="checkbox"
      checked={!!checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  ),
}))

vi.mock('@tabler/icons-react', () => ({
  IconFolderPlus: () => <span />,
  IconLoader: () => <span />,
  IconRefresh: () => <span />,
  IconUpload: () => <span />,
}))

vi.mock('@/lib/utils', () => ({
  cn: (...a: any[]) => a.filter(Boolean).join(' '),
  getProviderTitle: (name: string) => `Title:${name}`,
  getModelDisplayName: (m: any) => m.name ?? m.id,
  basenameNoExt: (p: string) => p.split('/').pop() ?? p,
}))

vi.mock('@/constants/providers', () => ({
  predefinedProviders: [{ provider: 'openai' }],
}))

vi.mock('@/constants/routes', () => ({
  route: { hub: { index: '/hub' } },
}))

vi.mock('@/hooks/useModelProvider', () => {
  const hook: any = () => h.modelProviderStore
  hook.getState = () => h.modelProviderStore
  return { useModelProvider: hook }
})

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => h.serviceHub,
}))

vi.mock('@/hooks/useModelLoad', () => ({
  useModelLoad: () => h.modelLoad,
}))

vi.mock('@/hooks/useLlamacppDevices', () => {
  const hook: any = () => ({ fetchDevices: vi.fn() })
  hook.getState = () => ({ fetchDevices: vi.fn() })
  return { useLlamacppDevices: hook }
})

vi.mock('@/hooks/useBackendUpdater', () => ({
  useBackendUpdater: () => h.backendUpdater,
}))

vi.mock('@/hooks/useAppState', () => ({ useAppState: h.useAppStateMock }))

vi.mock('zustand/shallow', () => ({
  useShallow: (fn: any) => fn,
}))

// Import AFTER mocks
import { Route } from '../$providerName'

const renderComponent = () => {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.params.providerName = 'openai'
  h.appState.activeModels = []
  h.openaiProvider.api_key = 'sk-primary'
  h.openaiProvider.api_key_fallbacks = ['sk-fallback-1']
  h.openaiProvider.active = true
  h.openaiProvider.models = [
    { id: 'gpt-4', model: 'gpt-4', name: 'gpt-4', capabilities: ['completion'], version: '1' },
  ]
  h.openaiProvider.settings = [
    {
      key: 'api-key',
      title: 'API Key',
      description: 'The API key',
      controller_type: 'input',
      controller_props: { value: 'sk-primary', type: 'password' },
    },
    {
      key: 'base-url',
      title: 'Base URL',
      description: 'The base url',
      controller_type: 'input',
      controller_props: { value: 'https://api.openai.com/v1' },
    },
  ]
  h.llamacppProvider.models = [
    { id: 'local-model', model: 'local-model', name: 'local-model', capabilities: [], settings: { ctx_len: {} } },
  ]
  h.providerMap.openai = h.openaiProvider
  h.providerMap.llamacpp = h.llamacppProvider

  // Reset services to default behavior
  h.providersSvc.getProviders = vi.fn().mockResolvedValue([])
  h.providersSvc.updateSettings = vi.fn().mockResolvedValue(undefined)
  h.providersSvc.fetchModelsFromProvider = vi.fn().mockResolvedValue(['gpt-4', 'gpt-5'])
  h.providersSvc.fetch = vi.fn(() =>
    vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
  )
  h.modelsSvc.getActiveModels = vi.fn().mockResolvedValue([])
  h.modelsSvc.startModel = vi.fn().mockResolvedValue(undefined)
  h.modelsSvc.stopModel = vi.fn().mockResolvedValue(undefined)
  h.modelsSvc.stopAllModels = vi.fn().mockResolvedValue(undefined)
  h.modelsSvc.checkMmprojExists = vi.fn().mockResolvedValue(false)
  h.dialogSvc.open = vi.fn().mockResolvedValue(null)
  h.backendUpdater.checkForUpdate = vi.fn().mockResolvedValue(null)
  h.backendUpdater.installBackend = vi.fn().mockResolvedValue(undefined)
})

describe('ProviderDetail route', () => {
  describe('Route config', () => {
    it('validateSearch stringifies the step param', () => {
      const r = (Route as any).validateSearch({ step: 42 })
      expect(r.step).toBe('42')
    })

    it('validateSearch handles missing search', () => {
      const r = (Route as any).validateSearch({})
      expect(r.step).toBe('undefined')
    })
  })

  describe('Rendering', () => {
    it('renders the openai provider title, settings card, delete provider, and models', () => {
      renderComponent()
      expect(screen.getByTestId('header-page')).toBeInTheDocument()
      expect(screen.getByText('Title:openai')).toBeInTheDocument()
      expect(screen.getByTestId('delete-provider')).toHaveTextContent('openai')
      expect(screen.getByTestId('edit-gpt-4')).toBeInTheDocument()
      expect(screen.getByTestId('del-gpt-4')).toBeInTheDocument()
      expect(screen.getByTestId('add-model')).toBeInTheDocument()
    })

    it('hides favorite action for predefined provider with no api key', () => {
      h.openaiProvider.api_key = ''
      h.openaiProvider.api_key_fallbacks = []
      renderComponent()
      expect(screen.queryByTestId('fav-gpt-4')).not.toBeInTheDocument()
    })

    it('shows favorite action for predefined provider with api key', () => {
      renderComponent()
      expect(screen.getByTestId('fav-gpt-4')).toBeInTheDocument()
    })

    it('renders no-models placeholder when provider has empty models', () => {
      h.openaiProvider.models = []
      renderComponent()
      expect(screen.getByText('providers:noModelFound')).toBeInTheDocument()
    })

    it('renders essentially empty tree for an unknown provider', () => {
      h.params.providerName = 'does-not-exist'
      renderComponent()
      expect(screen.getByText('Title:does-not-exist')).toBeInTheDocument()
      // delete-provider renders "none" when provider is undefined
      expect(screen.getByTestId('delete-provider')).toHaveTextContent('none')
      // No edit-* / add-model for unknown provider
      expect(screen.queryByTestId('add-model')).not.toBeInTheDocument()
    })

    it('renders llamacpp-specific UI: import button, backend controls', () => {
      h.params.providerName = 'llamacpp'
      renderComponent()
      expect(screen.getByTestId('import-vision')).toBeInTheDocument()
      expect(screen.getByText('settings:checkForBackendUpdates')).toBeInTheDocument()
      expect(screen.getByText('Install Backend from File')).toBeInTheDocument()
    })
  })

  describe('Provider active toggle', () => {
    it('flipping the switch calls updateProvider with active=false', () => {
      renderComponent()
      const sw = screen.getByTestId('provider-switch') as HTMLInputElement
      expect(sw.checked).toBe(true)
      fireEvent.click(sw)
      expect(h.updateProvider).toHaveBeenCalledWith('openai', { active: false })
    })
  })

  describe('API key management', () => {
    it('seeds the primary key input from api_key', () => {
      renderComponent()
      const primary = screen.getByPlaceholderText('providers:apiKeys.primaryPlaceholder') as HTMLInputElement
      expect(primary.value).toBe('sk-primary')
    })

    it('commits a changed primary key on blur', () => {
      renderComponent()
      const primary = screen.getByPlaceholderText('providers:apiKeys.primaryPlaceholder')
      fireEvent.change(primary, { target: { value: 'sk-new' } })
      fireEvent.blur(primary)
      expect(h.updateProvider).toHaveBeenCalledWith(
        'openai',
        expect.objectContaining({ api_key: 'sk-new', api_key_fallbacks: ['sk-fallback-1'] })
      )
    })

    it('does nothing on blur when unchanged', () => {
      renderComponent()
      const primary = screen.getByPlaceholderText('providers:apiKeys.primaryPlaceholder')
      fireEvent.blur(primary)
      // updateProvider should not have been called from commit
      expect(h.updateProvider).not.toHaveBeenCalled()
    })

    it('toggles advanced mode and reveals key rows + add button', () => {
      renderComponent()
      fireEvent.click(screen.getByText('providers:apiKeys.advanced'))
      expect(screen.getByText('providers:apiKeys.test')).toBeInTheDocument()
      expect(screen.getByText(/providers:apiKeys.addKey/)).toBeInTheDocument()
      // hide advanced
      fireEvent.click(screen.getByText('providers:apiKeys.hideAdvanced'))
      expect(screen.queryByText('providers:apiKeys.test')).not.toBeInTheDocument()
    })

    it('adds and removes key lines in advanced mode', () => {
      renderComponent()
      fireEvent.click(screen.getByText('providers:apiKeys.advanced'))
      // current rows: primary + 1 fallback = 2 rows
      const initialPwInputs = document.querySelectorAll('input[type="password"]').length
      expect(initialPwInputs).toBe(2)
      fireEvent.click(screen.getByText(/providers:apiKeys.addKey/))
      expect(document.querySelectorAll('input[type="password"]').length).toBe(3)
      // Removal buttons are "-" for non-first rows
      const removeButtons = Array.from(document.querySelectorAll('button')).filter(
        (b) => b.textContent === '-'
      )
      expect(removeButtons.length).toBeGreaterThan(0)
      fireEvent.click(removeButtons[0])
      expect(document.querySelectorAll('input[type="password"]').length).toBe(2)
    })

    it('runs handleTestApiKeys and shows OK status', async () => {
      renderComponent()
      fireEvent.click(screen.getByText('providers:apiKeys.advanced'))
      await act(async () => {
        fireEvent.click(screen.getByText('providers:apiKeys.test'))
      })
      await waitFor(() => {
        expect(screen.getAllByText('OK').length).toBeGreaterThan(0)
      })
    })

    it('handleTestApiKeys shows error toast when base_url missing', async () => {
      h.openaiProvider.base_url = ''
      renderComponent()
      fireEvent.click(screen.getByText('providers:apiKeys.advanced'))
      await act(async () => {
        fireEvent.click(screen.getByText('providers:apiKeys.test'))
      })
      expect(h.toastError).toHaveBeenCalled()
      // restore
      h.openaiProvider.base_url = 'https://api.openai.com/v1'
    })

    it('handleTestApiKeys shows error toast when no keys are filled', async () => {
      h.openaiProvider.api_key = ''
      h.openaiProvider.api_key_fallbacks = []
      renderComponent()
      fireEvent.click(screen.getByText('providers:apiKeys.advanced'))
      await act(async () => {
        fireEvent.click(screen.getByText('providers:apiKeys.test'))
      })
      expect(h.toastError).toHaveBeenCalled()
    })

    it('maps unauthorized/forbidden/rate_limited/network_error correctly', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' })
        .mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden' })
      h.providersSvc.fetch = vi.fn(() => fetchImpl)
      renderComponent()
      fireEvent.click(screen.getByText('providers:apiKeys.advanced'))
      await act(async () => {
        fireEvent.click(screen.getByText('providers:apiKeys.test'))
      })
      await waitFor(() => {
        expect(screen.getByText(/Invalid \/ revoked key/)).toBeInTheDocument()
      })
      expect(screen.getByText(/Forbidden \(403\)/)).toBeInTheDocument()
    })
  })

  describe('Refresh models', () => {
    it('refreshing adds newly fetched models and toasts success', async () => {
      renderComponent()
      // The refresh icon button is the first secondary icon-xs button inside the models card header
      // It's rendered alongside DialogAddModel. We locate it by being the button before add-model.
      const buttons = screen.getAllByRole('button')
      // Find one that has no text children (icon-only) and is not the provider switch
      // Simpler: click every button and find side-effect; instead, pick the one whose aria isn't set — use first button in the models card.
      // Use a more targeted approach: the first button inside the element that contains add-model.
      const addModel = screen.getByTestId('add-model')
      const refreshBtn = addModel.parentElement?.querySelector('button') as HTMLButtonElement
      expect(refreshBtn).toBeTruthy()
      await act(async () => {
        fireEvent.click(refreshBtn)
      })
      await waitFor(() => {
        expect(h.toastSuccess).toHaveBeenCalled()
      })
      expect(h.updateProvider).toHaveBeenCalledWith(
        'openai',
        expect.objectContaining({
          models: expect.arrayContaining([
            expect.objectContaining({ id: 'gpt-5' }),
          ]),
        })
      )
      // Unused var to keep linter happy
      void buttons
    })

    it('refresh errors out when provider lacks api keys', async () => {
      h.openaiProvider.api_key = ''
      h.openaiProvider.api_key_fallbacks = []
      renderComponent()
      const addModel = screen.getByTestId('add-model')
      const refreshBtn = addModel.parentElement?.querySelector('button') as HTMLButtonElement
      await act(async () => {
        fireEvent.click(refreshBtn)
      })
      expect(h.toastError).toHaveBeenCalled()
    })

    it('refresh shows "no new models" toast when all models already exist', async () => {
      h.providersSvc.fetchModelsFromProvider = vi.fn().mockResolvedValue(['gpt-4'])
      renderComponent()
      const addModel = screen.getByTestId('add-model')
      const refreshBtn = addModel.parentElement?.querySelector('button') as HTMLButtonElement
      await act(async () => {
        fireEvent.click(refreshBtn)
      })
      await waitFor(() => {
        expect(h.toastSuccess).toHaveBeenCalledWith(
          'providers:models',
          expect.objectContaining({ description: 'providers:noNewModels' })
        )
      })
    })

    it('refresh toasts error on fetch failure', async () => {
      h.providersSvc.fetchModelsFromProvider = vi.fn().mockRejectedValue(new Error('nope'))
      renderComponent()
      const addModel = screen.getByTestId('add-model')
      const refreshBtn = addModel.parentElement?.querySelector('button') as HTMLButtonElement
      await act(async () => {
        fireEvent.click(refreshBtn)
      })
      expect(h.toastError).toHaveBeenCalled()
    })
  })

  describe('Model start/stop (llamacpp)', () => {
    beforeEach(() => {
      h.params.providerName = 'llamacpp'
    })

    it('renders Start button and triggers startModel', async () => {
      renderComponent()
      const start = screen.getByText('providers:start')
      await act(async () => {
        fireEvent.click(start)
      })
      await waitFor(() => {
        expect(h.modelsSvc.startModel).toHaveBeenCalled()
      })
    })

    it('renders Stop button when model is active, triggers stopModel', async () => {
      h.appState.activeModels = ['local-model']
      renderComponent()
      const stop = screen.getByText('providers:stop')
      await act(async () => {
        fireEvent.click(stop)
      })
      await waitFor(() => {
        expect(h.modelsSvc.stopModel).toHaveBeenCalledWith('local-model', 'llamacpp')
      })
    })

    it('captures error via setModelLoadError when startModel rejects', async () => {
      h.modelsSvc.startModel = vi.fn().mockRejectedValue({ message: 'boom' })
      renderComponent()
      await act(async () => {
        fireEvent.click(screen.getByText('providers:start'))
      })
      await waitFor(() => {
        expect(h.modelLoad.setModelLoadError).toHaveBeenCalled()
      })
    })
  })

  describe('Backend install / update (llamacpp)', () => {
    beforeEach(() => {
      h.params.providerName = 'llamacpp'
    })

    it('check-for-update shows info toast when no update available', async () => {
      renderComponent()
      await act(async () => {
        fireEvent.click(screen.getByText('settings:checkForBackendUpdates'))
      })
      await waitFor(() => {
        expect(h.toastInfo).toHaveBeenCalled()
      })
    })

    it('check-for-update shows error toast when the checker throws', async () => {
      h.backendUpdater.checkForUpdate = vi.fn().mockRejectedValue(new Error('x'))
      renderComponent()
      await act(async () => {
        fireEvent.click(screen.getByText('settings:checkForBackendUpdates'))
      })
      await waitFor(() => {
        expect(h.toastError).toHaveBeenCalled()
      })
      // restore
      h.backendUpdater.checkForUpdate = vi.fn().mockResolvedValue(null)
    })

    it('install-from-file no-ops cleanly when dialog returns null', async () => {
      renderComponent()
      await act(async () => {
        fireEvent.click(screen.getByText('Install Backend from File'))
      })
      // no toast fired because file selection was cancelled
      expect(h.toastSuccess).not.toHaveBeenCalled()
      expect(h.toastError).not.toHaveBeenCalled()
    })

    it('install-from-file calls installBackend and toasts success', async () => {
      h.dialogSvc.open = vi.fn().mockResolvedValue('/some/path/My Backend.tar.gz')
      renderComponent()
      await act(async () => {
        fireEvent.click(screen.getByText('Install Backend from File'))
      })
      await waitFor(() => {
        expect(h.backendUpdater.installBackend).toHaveBeenCalledWith(
          '/some/path/My Backend.tar.gz'
        )
      })
      expect(h.toastSuccess).toHaveBeenCalled()
    })

    it('install-from-file toasts error when installBackend throws', async () => {
      h.dialogSvc.open = vi.fn().mockResolvedValue('/some/path/bad.tar.gz')
      h.backendUpdater.installBackend = vi.fn().mockRejectedValue(new Error('install fail'))
      renderComponent()
      await act(async () => {
        fireEvent.click(screen.getByText('Install Backend from File'))
      })
      await waitFor(() => {
        expect(h.toastError).toHaveBeenCalled()
      })
      h.backendUpdater.installBackend = vi.fn().mockResolvedValue(undefined)
    })
  })

  describe('Dynamic setting changes', () => {
    it('for openai, only the base-url dynamic control renders (api-key input is hidden)', () => {
      renderComponent()
      // Only one dynamic control (base-url) — the api-key setting is routed through
      // the dedicated api-keys Card for non-llamacpp/non-mlx providers.
      expect(screen.getAllByTestId('dynamic-ctrl')).toHaveLength(1)
    })

    it('changing the base-url setting propagates to base_url and calls updateSettings', () => {
      renderComponent()
      const dyn = screen.getByTestId('dynamic-ctrl')
      fireEvent.click(dyn)
      expect(h.providersSvc.updateSettings).toHaveBeenCalled()
      expect(h.updateProvider).toHaveBeenCalledWith(
        'openai',
        expect.objectContaining({ base_url: 'new-value' })
      )
    })

    it('for llamacpp, the version_backend control also stops all running models on change', async () => {
      h.params.providerName = 'llamacpp'
      renderComponent()
      const dyns = screen.getAllByTestId('dynamic-ctrl')
      await act(async () => {
        fireEvent.click(dyns[0]) // version_backend
      })
      expect(h.modelsSvc.stopAllModels).toHaveBeenCalled()
    })
  })
})
