import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { ModelSetting } from '../ModelSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { act } from '@testing-library/react'
import '@testing-library/jest-dom'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: vi.fn(() => ({
    models: () => ({
      stopModel: vi.fn(() => Promise.resolve()),
      getActiveModels: vi.fn(() => Promise.resolve([])),
    }),
  })),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: vi.fn(() => ({ t: (k: string) => k })),
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: vi.fn((selector: any) =>
    selector({ setActiveModels: vi.fn() })
  ),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
  getModelDisplayName: (m: any) => m.displayName ?? m.id,
}))

vi.mock('lodash.debounce', () => ({
  default: (fn: any) => fn,
}))

// Minimal Sheet implementation — renders children directly
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: any) => <div data-testid="sheet">{children}</div>,
  SheetTrigger: ({ children }: any) => <div data-testid="sheet-trigger">{children}</div>,
  SheetContent: ({ children }: any) => <div data-testid="sheet-content">{children}</div>,
  SheetHeader: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
  SheetDescription: ({ children }: any) => <p>{children}</p>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}))

vi.mock('@tabler/icons-react', () => ({
  IconSettings: () => <span data-testid="settings-icon" />,
}))

vi.mock('@/containers/dynamicControllerSetting', () => ({
  DynamicControllerSetting: ({ controllerProps, onChange, title }: any) => (
    <div data-testid={`controller-${title}`}>
      <span data-testid={`options-count-${title}`}>
        {controllerProps?.options ? controllerProps.options.length : 0}
      </span>
      <button
        data-testid={`change-${title}`}
        onClick={() => onChange('new-value')}
      >
        change
      </button>
    </div>
  ),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeDraftModelIdSetting = (value = 'none') => ({
  key: 'draft_model_id',
  title: 'Draft Model',
  description: 'A smaller draft model',
  controller_type: 'dropdown',
  controller_props: {
    value,
    options: [{ value: 'none', name: 'None' }],
  },
})

const makeSpecTypeSetting = (value = 'none') => ({
  key: 'spec_type',
  title: 'Speculative type',
  description: 'Model-free speculative decoding',
  controller_type: 'dropdown',
  controller_props: { value, options: [] },
})

const makeDraftMaxSetting = (value = 16) => ({
  key: 'draft_max',
  title: 'Max draft tokens per step',
  description: 'Number of tokens to draft',
  controller_type: 'input',
  controller_props: { value, type: 'number' },
})

const makeDraftMinSetting = (value = 0) => ({
  key: 'draft_min',
  title: 'Min draft tokens per step',
  description: 'Minimum draft tokens',
  controller_type: 'input',
  controller_props: { value, type: 'number' },
})

const makeLlamacppModel = (id: string, settings: Record<string, any> = {}) =>
  ({ id, capabilities: ['completion'], settings }) as any

const makeLlamacppProvider = (models: any[]) =>
  ({ provider: 'llamacpp', active: true, models, settings: [] }) as any

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ModelSetting - speculative decoding', () => {
  const updateProvider = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getControllerProps - draft_model_id dropdown enrichment', () => {
    it('appends draft model candidates to the draft_model_id options', () => {
      const model = makeLlamacppModel('main-model.gguf', {
        draft_model_id: makeDraftModelIdSetting(),
      })

      const otherModel = makeLlamacppModel('draft-candidate.gguf')
      const provider = makeLlamacppProvider([model, otherModel])

      vi.mocked(useModelProvider).mockReturnValue({
        updateProvider,
        providers: [provider],
      } as any)

      render(<ModelSetting model={model} provider={provider} />)

      // The Draft Model controller should have 2 options: the static 'None' + 1 candidate
      const optionsCount = screen.getByTestId('options-count-Draft Model')
      expect(optionsCount.textContent).toBe('2')
    })

    it('does not include the current model as a draft candidate', () => {
      const model = makeLlamacppModel('current-model.gguf', {
        draft_model_id: makeDraftModelIdSetting(),
      })
      const provider = makeLlamacppProvider([model])

      vi.mocked(useModelProvider).mockReturnValue({
        updateProvider,
        providers: [provider],
      } as any)

      render(<ModelSetting model={model} provider={provider} />)

      // Only the static 'None' option remains — current model is excluded
      const optionsCount = screen.getByTestId('options-count-Draft Model')
      expect(optionsCount.textContent).toBe('1')
    })

    it('excludes embedding models from draft candidates', () => {
      const model = makeLlamacppModel('main-model.gguf', {
        draft_model_id: makeDraftModelIdSetting(),
      })
      const embeddingModel = makeLlamacppModel('embed.gguf', {
        embedding: { controller_props: { value: true } },
      })
      const provider = makeLlamacppProvider([model, embeddingModel])

      vi.mocked(useModelProvider).mockReturnValue({
        updateProvider,
        providers: [provider],
      } as any)

      render(<ModelSetting model={model} provider={provider} />)

      // Still only 'None' — embedding model is excluded
      const optionsCount = screen.getByTestId('options-count-Draft Model')
      expect(optionsCount.textContent).toBe('1')
    })

    it('includes multiple non-embedding candidates', () => {
      const model = makeLlamacppModel('main-7b.gguf', {
        draft_model_id: makeDraftModelIdSetting(),
      })
      const draft1 = makeLlamacppModel('draft-3b.gguf')
      const draft2 = makeLlamacppModel('draft-1b.gguf')
      const provider = makeLlamacppProvider([model, draft1, draft2])

      vi.mocked(useModelProvider).mockReturnValue({
        updateProvider,
        providers: [provider],
      } as any)

      render(<ModelSetting model={model} provider={provider} />)

      // 1 static 'None' + 2 candidates = 3
      const optionsCount = screen.getByTestId('options-count-Draft Model')
      expect(optionsCount.textContent).toBe('3')
    })
  })

  describe('getControllerProps - non-draft_model_id passthrough', () => {
    it('returns plain controller props for spec_type setting', () => {
      const model = makeLlamacppModel('model.gguf', {
        spec_type: makeSpecTypeSetting('ngram-mod'),
      })
      const provider = makeLlamacppProvider([model])

      vi.mocked(useModelProvider).mockReturnValue({
        updateProvider,
        providers: [provider],
      } as any)

      render(<ModelSetting model={model} provider={provider} />)

      // spec_type has no dynamic options injection, so 0 options
      const optionsCount = screen.getByTestId('options-count-Speculative type')
      expect(optionsCount.textContent).toBe('0')
    })
  })

  describe('handleSettingChange - speculative keys trigger model restart', () => {
    const renderWithSetting = (key: string, settingObj: any) => {
      const model = makeLlamacppModel('running-model.gguf', {
        [key]: settingObj,
      })
      const provider = makeLlamacppProvider([model])

      vi.mocked(useModelProvider).mockReturnValue({
        updateProvider,
        providers: [provider],
      } as any)

      return { model, provider }
    }

    it('calls updateProvider when draft_model_id changes', () => {
      const { model, provider } = renderWithSetting(
        'draft_model_id',
        makeDraftModelIdSetting()
      )
      render(<ModelSetting model={model} provider={provider} />)

      fireEvent.click(screen.getByTestId('change-Draft Model'))

      expect(updateProvider).toHaveBeenCalledWith(
        'llamacpp',
        expect.objectContaining({ models: expect.any(Array) })
      )
    })

    it('calls updateProvider when spec_type changes', () => {
      const { model, provider } = renderWithSetting(
        'spec_type',
        makeSpecTypeSetting()
      )
      render(<ModelSetting model={model} provider={provider} />)

      fireEvent.click(screen.getByTestId('change-Speculative type'))

      expect(updateProvider).toHaveBeenCalledWith(
        'llamacpp',
        expect.objectContaining({ models: expect.any(Array) })
      )
    })

    it('calls updateProvider when draft_max changes', () => {
      const { model, provider } = renderWithSetting(
        'draft_max',
        makeDraftMaxSetting()
      )
      render(<ModelSetting model={model} provider={provider} />)

      fireEvent.click(screen.getByTestId('change-Max draft tokens per step'))

      expect(updateProvider).toHaveBeenCalledWith(
        'llamacpp',
        expect.objectContaining({ models: expect.any(Array) })
      )
    })

    it('calls updateProvider when draft_min changes', () => {
      const { model, provider } = renderWithSetting(
        'draft_min',
        makeDraftMinSetting()
      )
      render(<ModelSetting model={model} provider={provider} />)

      fireEvent.click(screen.getByTestId('change-Min draft tokens per step'))

      expect(updateProvider).toHaveBeenCalledWith(
        'llamacpp',
        expect.objectContaining({ models: expect.any(Array) })
      )
    })
  })

  describe('rendering', () => {
    it('renders the settings trigger button', () => {
      const model = makeLlamacppModel('model.gguf', {})
      const provider = makeLlamacppProvider([model])

      vi.mocked(useModelProvider).mockReturnValue({
        updateProvider,
        providers: [provider],
      } as any)

      render(<ModelSetting model={model} provider={provider} />)

      expect(screen.getByTestId('settings-icon')).toBeInTheDocument()
    })
  })
})
