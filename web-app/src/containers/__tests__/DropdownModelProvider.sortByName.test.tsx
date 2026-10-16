import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import DropdownModelProvider from '../DropdownModelProvider'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'

type TestModel = { id: string; displayName?: string; capabilities: string[] }

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn(() => ({ updateCurrentThreadModel: vi.fn() })),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: vi.fn(() => ({
    models: () => ({
      checkMmprojExists: vi.fn(() => Promise.resolve(false)),
      checkMmprojExistsAndUpdateOffloadMMprojSetting: vi.fn(() =>
        Promise.resolve()
      ),
    }),
  })),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: vi.fn(() => ({ t: (key: string) => key })),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
}))

vi.mock('@/hooks/useFavoriteModel', () => ({
  useFavoriteModel: vi.fn(() => ({ favoriteModels: [] })),
}))

vi.mock('@/lib/platform/const', () => ({
  PlatformFeatures: {
    WEB_AUTO_MODEL_SELECTION: false,
    MODEL_PROVIDER_SETTINGS: true,
    projects: true,
  },
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-trigger">{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}))

vi.mock('../ProvidersAvatar', () => ({
  default: ({ provider }: { provider: { provider: string } }) => (
    <div data-testid={`provider-avatar-${provider.provider}`} />
  ),
}))

vi.mock('../Capabilities', () => ({
  default: () => <div data-testid="capabilities" />,
}))

vi.mock('../ModelSetting', () => ({
  ModelSetting: () => <div data-testid="model-setting" />,
}))

vi.mock('../ModelSupportStatus', () => ({
  ModelSupportStatus: () => <div data-testid="model-support-status" />,
}))

// Stored in the order a provider's catalog returned them, not by name.
const storedModels: TestModel[] = [
  { id: 'phi-4', capabilities: ['completion'] },
  { id: 'Llama-3.3-70B-Instruct', capabilities: ['completion'] },
  { id: 'gpt-4o', capabilities: ['completion'] },
  { id: 'DeepSeek-R1', capabilities: ['completion'] },
]

const providers = [
  { provider: 'my-gateway', active: true, models: storedModels, settings: [] },
]

const listedIds = () =>
  screen
    .getAllByTestId(/^model-option-/)
    .map((el) => el.getAttribute('data-testid')!.replace('model-option-', ''))

describe('DropdownModelProvider - sort by name', () => {
  beforeEach(() => {
    act(() => useInterfaceSettings.setState({ sortModelsByName: true }))
    vi.mocked(useModelProvider).mockReturnValue({
      providers,
      selectedProvider: 'my-gateway',
      selectedModel: storedModels[0],
      getProviderByName: vi.fn((name: string) =>
        providers.find((p) => p.provider === name)
      ),
      selectModelProvider: vi.fn(),
      getModelBy: vi.fn((id: string) => storedModels.find((m) => m.id === id)),
      updateProvider: vi.fn(),
    } as unknown as ReturnType<typeof useModelProvider>)
  })

  afterEach(() => cleanup())

  it('lists each provider’s models by name by default', () => {
    render(<DropdownModelProvider />)

    expect(listedIds()).toEqual([
      'DeepSeek-R1',
      'gpt-4o',
      'Llama-3.3-70B-Instruct',
      'phi-4',
    ])
  })

  it('keeps the stored order once the user turns sorting off', () => {
    render(<DropdownModelProvider />)

    fireEvent.click(screen.getByRole('button', { name: 'common:sortModelsByName' }))

    expect(listedIds()).toEqual(storedModels.map((m) => m.id))
    expect(useInterfaceSettings.getState().sortModelsByName).toBe(false)
  })

  it('keeps search results in name order', () => {
    render(<DropdownModelProvider />)

    // Every stored id contains "-", so all four match.
    fireEvent.change(screen.getByPlaceholderText('common:searchModels'), {
      target: { value: '-' },
    })

    expect(listedIds()).toEqual([
      'DeepSeek-R1',
      'gpt-4o',
      'Llama-3.3-70B-Instruct',
      'phi-4',
    ])
  })
})
