import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { localStorageKey } from '@/constants/localStorage'
import ComposerModelPicker, { getComposerEffortChoices } from '../ComposerModelPicker'

const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), thread: vi.fn(), navigate: vi.fn(), state: {} as Record<string, unknown> }))
vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: () => mocks.state }))
vi.mock('@/hooks/useThreads', () => ({ useThreads: (selector: (state: { updateCurrentThreadModel: typeof mocks.thread }) => unknown) => selector({ updateCurrentThreadModel: mocks.thread }) }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => ({ models: () => ({ checkMmprojExists: async () => false, checkMmprojExistsAndUpdateOffloadMMprojSetting: async () => undefined }) }) }))
vi.mock('../ProvidersAvatar', () => ({ default: () => null }))
vi.mock('../ModelSetting', () => ({ ModelSettingSheet: ({ open, onOpenChange, onCloseAutoFocus }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus: (event: { preventDefault: () => void }) => void
}) => open ? <div>Model settings overlay<button onClick={() => {
  onOpenChange(false)
  onCloseAutoFocus({ preventDefault: () => undefined })
}}>Close settings</button></div> : null }))

function renderPicker(ui: ReactElement) {
  const result = render(ui)
  fireEvent.click(screen.getByTestId('model-selector-trigger'))
  return result
}
function openChoices(name: string) {
  fireEvent.keyDown(screen.getByRole('menuitem', { name }), { key: 'ArrowRight' })
}
function choose(name: string, value: string) {
  if (!screen.queryByRole('menu', { name })) openChoices(name)
  fireEvent.click(screen.getByRole('menuitemradio', { name: value || 'Default', exact: true }))
}

const model = (id: string): Model => ({ id })
const provider = (name: string, models: Model[]): ModelProvider => ({ provider: name, active: true, models, settings: [], api_key: 'test' })
function setup(selected: Model = model('gpt-5.2'), name = 'openai') {
  const p = provider(name, [selected, { id: 'other', displayName: 'Other model' }, { id: 'embedding', embedding: true }])
  mocks.state = {
    providers: [p], selectedProvider: name, selectedModel: selected,
    selectModelProvider: mocks.select, updateProvider: mocks.update,
    getProviderByName: (id: string) => id === name ? p : undefined,
  }
  return p
}
beforeEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); setup() })

describe('getComposerEffortChoices', () => {
  it('does not expose effort on non-reasoning or unknown families', () => {
    expect(getComposerEffortChoices('openai', model('gpt-4o'))).toBeUndefined()
    expect(getComposerEffortChoices('openai', model('o1-mini'))).toBeUndefined()
    expect(getComposerEffortChoices('custom', model('gpt-5.2'))).toBeUndefined()
    expect(getComposerEffortChoices('llamacpp', model('ordinary'))).toBeUndefined()
  })
  it('limits xhigh to known supporting OpenAI families', () => {
    expect(getComposerEffortChoices('openai', model('o3'))?.choices.map((c) => c.value)).toEqual(['low', 'medium', 'high'])
    expect(getComposerEffortChoices('openai', model('gpt-5.2'))?.choices.map((c) => c.value)).toContain('xhigh')
    expect(getComposerEffortChoices('openai', model('gpt-5-pro'))?.choices.map((c) => c.value)).toEqual(['high'])
  })
  it('honors explicit model option metadata', () => {
    const m: Model = { id: 'gpt-5.2', settings: { thinking_budget_tokens: { key: 'thinking_budget_tokens', title: '', description: '', controller_type: 'dropdown', controller_props: { options: [{ name: 'High', value: 'high' }] } } } }
    expect(getComposerEffortChoices('openai', m)?.choices.map((c) => c.value)).toEqual(['high'])
  })
  it('offers context-relative budgets only for reasoning-capable local models', () => {
    expect(getComposerEffortChoices('llamacpp', { id: 'local', capabilities: ['reasoning'] })?.choices.map((c) => c.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'unlimited'])
  })
})

describe('ComposerModelPicker', () => {
  it('uses a named dialog popup for search/listbox, with a separate footer menu', () => {
    render(<ComposerModelPicker />)
    const trigger = screen.getByTestId('model-selector-trigger')
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Choose a model' })
    const search = screen.getByRole('combobox', { name: 'Search models or providers' })
    expect(dialog.contains(search)).toBe(true)
    expect(dialog.contains(screen.getByRole('listbox', { name: 'Models' }))).toBe(true)
    expect(search.closest('[role="menu"]')).toBeNull()
    expect(screen.getByRole('menu', { name: 'Model options' }).contains(search)).toBe(false)
  })
  // JSDOM cannot measure Popper collisions; native QA must also assert viewport
  // bounds and that only the model list scrolls with the footer fully visible.
  it('bounds the popup while allowing only model results to shrink and scroll', () => {
    renderPicker(<ComposerModelPicker />)
    const dialog = screen.getByRole('dialog', { name: 'Choose a model' })
    expect(dialog).toHaveClass('flex', 'flex-col', 'overflow-hidden',
      'max-h-[min(var(--radix-popover-content-available-height,calc(100dvh-24px)),calc(100dvh-24px))]')
    const list = screen.getByRole('listbox', { name: 'Models' })
    expect(list).toHaveClass('min-h-0', 'max-h-56', 'shrink', 'overflow-y-auto')
    expect(screen.getByRole('combobox').parentElement?.parentElement).toHaveClass('shrink-0')
    const footer = screen.getByRole('menu', { name: 'Model options' })
    expect(footer.parentElement?.parentElement).toHaveClass('shrink-0')
    expect(dialog).not.toHaveClass('overflow-y-auto')
    expect(screen.getAllByRole('option')[0]).toHaveClass('py-1')
    expect(screen.getByRole('menuitem', { name: /Manage models/ })).toHaveClass('min-h-8', 'py-1.5')
  })
  it('links the combobox to instance-scoped result IDs', () => {
    const first = renderPicker(<ComposerModelPicker />)
    const search = screen.getByRole('combobox')
    const resultsId = search.getAttribute('aria-controls')!
    expect(document.getElementById(resultsId)).toHaveAttribute('role', 'listbox')
    expect(document.getElementById(search.getAttribute('aria-activedescendant')!)).toHaveAttribute('role', 'option')
    expect(search).toHaveAttribute('aria-autocomplete', 'list')
    first.unmount()
    renderPicker(<ComposerModelPicker />)
    expect(screen.getByRole('combobox').getAttribute('aria-controls')).not.toBe(resultsId)
  })
  it('hides effort overrides before narrowing the model label', () => {
    setup({ id: 'gpt-5.2', settings: { thinking_budget_tokens: { key: 'thinking_budget_tokens', title: '', description: '', controller_type: 'dropdown', controller_props: { value: 'high' } } } })
    render(<ComposerModelPicker />)
    expect(screen.getByText('· High').className).toContain('@max-[520px]/composer:hidden')
  })
  it('shows selected summary and excludes embedding models', () => {
    renderPicker(<ComposerModelPicker />)
    expect(screen.getByTestId('model-selector-trigger').textContent).toContain('gpt-5.2')
    expect(screen.queryByTestId('model-option-embedding')).toBeNull()
  })
  it('selects a model and updates the current thread by default', () => {
    renderPicker(<ComposerModelPicker />)
    fireEvent.click(screen.getByTestId('model-option-other'))
    expect(mocks.select).toHaveBeenCalledWith('openai', 'other')
    expect(mocks.thread).toHaveBeenCalledWith({ provider: 'openai', id: 'other' })
    expect(JSON.parse(localStorage.getItem(localStorageKey.lastUsedModel)!)).toEqual({ provider: 'openai', model: 'other' })
  })
  it('uses onModelChange instead of mutating the current thread', () => {
    const change = vi.fn()
    renderPicker(<ComposerModelPicker onModelChange={change} />)
    fireEvent.click(screen.getByTestId('model-option-other'))
    expect(change).toHaveBeenCalledWith({ provider: 'openai', id: 'other' })
    expect(mocks.thread).not.toHaveBeenCalled()
  })
  it('initializes the explicit thread model', () => {
    renderPicker(<ComposerModelPicker model={{ provider: 'openai', id: 'other' }} />)
    expect(mocks.select).toHaveBeenCalledWith('openai', 'other')
  })
  it('restores the last-used model for a new chat', () => {
    localStorage.setItem(localStorageKey.lastUsedModel, JSON.stringify({ provider: 'openai', model: 'other' }))
    renderPicker(<ComposerModelPicker useLastUsedModel />)
    expect(mocks.select).toHaveBeenCalledWith('openai', 'other')
  })
  it('clears an unavailable thread model', () => {
    renderPicker(<ComposerModelPicker model={{ provider: 'missing', id: 'gone' }} />)
    expect(mocks.select).toHaveBeenCalledWith('', '')
  })
  it('retries an explicit target as providers and models hydrate', () => {
    mocks.state.providers = []
    const target = { provider: 'openai', id: 'late' }
    const { rerender } = renderPicker(<ComposerModelPicker model={target} />)
    expect(mocks.select).not.toHaveBeenCalled()
    setup()
    rerender(<ComposerModelPicker model={target} />)
    expect(mocks.select).toHaveBeenLastCalledWith('', '')
    const p = setup(model('late'))
    rerender(<ComposerModelPicker model={target} />)
    expect(mocks.select).toHaveBeenLastCalledWith('openai', 'late')
    mocks.select.mockClear()
    mocks.state.providers = [{ ...p }]
    rerender(<ComposerModelPicker model={target} />)
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it('does not replace a manual choice when the pending target arrives', () => {
    const target = { provider: 'openai', id: 'late' }
    const { rerender } = renderPicker(<ComposerModelPicker model={target} />)
    fireEvent.click(screen.getByTestId('model-option-other'))
    mocks.select.mockClear()
    setup(model('late'))
    rerender(<ComposerModelPicker model={target} />)
    expect(mocks.select).not.toHaveBeenCalled()
    rerender(<ComposerModelPicker model={{ provider: 'openai', id: 'late-next' }} />)
    expect(mocks.select).toHaveBeenLastCalledWith('', '')
    setup(model('late-next'))
    rerender(<ComposerModelPicker model={{ provider: 'openai', id: 'late-next' }} />)
    expect(mocks.select).toHaveBeenLastCalledWith('openai', 'late-next')
  })
  it('retries the last-used model after hydration without replacing a manual choice', () => {
    localStorage.setItem(localStorageKey.lastUsedModel, JSON.stringify({ provider: 'openai', model: 'late' }))
    const { rerender } = renderPicker(<ComposerModelPicker useLastUsedModel />)
    setup(model('late'))
    rerender(<ComposerModelPicker useLastUsedModel />)
    expect(mocks.select).toHaveBeenLastCalledWith('openai', 'late')
    cleanup()
    setup()
    const manual = renderPicker(<ComposerModelPicker useLastUsedModel />)
    fireEvent.click(screen.getByTestId('model-option-other'))
    mocks.select.mockClear()
    setup(model('late'))
    manual.rerender(<ComposerModelPicker useLastUsedModel />)
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it('leaves the global selection intact without initialization props', () => {
    renderPicker(<ComposerModelPicker />)
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it('writes symbolic effort to the selected model and refreshes selection', () => {
    renderPicker(<ComposerModelPicker />)
    choose('Reasoning effort', 'High')
    const updated = mocks.update.mock.calls[0][1].models[0]
    expect(updated.settings.thinking_budget_tokens.controller_props.value).toBe('high')
    expect(mocks.select).toHaveBeenCalledWith('openai', 'gpt-5.2')
    expect(mocks.thread).not.toHaveBeenCalled()
  })
  it('clears the setting for Default and displays an active override beside the name', () => {
    setup({ id: 'gpt-5.2', settings: { thinking_budget_tokens: { key: 'thinking_budget_tokens', title: '', description: '', controller_type: 'dropdown', controller_props: { value: 'high' } } } })
    renderPicker(<ComposerModelPicker />)
    expect(screen.getByTestId('model-selector-trigger').textContent).toContain('· High')
    choose('Reasoning effort', '')
    expect(mocks.update.mock.calls[0][1].models[0].settings.thinking_budget_tokens).toBeUndefined()
  })
  it.each(['auto', 'on', 'off', ''])('updates local reasoning mode %j independently of its budget', (value) => {
    const budget = { key: 'thinking_budget_tokens', title: '', description: '', controller_type: 'dropdown' as const, controller_props: { value: 'high' } }
    setup({ id: 'local', capabilities: ['reasoning'], settings: {
      reasoning: { key: 'reasoning', title: '', description: '', controller_type: 'dropdown', controller_props: { value: 'off' } },
      thinking_budget_tokens: budget,
    } }, 'llamacpp')
    renderPicker(<ComposerModelPicker />)
    expect(screen.getByRole('menuitem', { name: 'Reasoning mode' }).textContent).toContain('Off')
    expect(screen.getByTestId('model-selector-trigger').textContent).toContain('· Off')
    choose('Reasoning mode', value ? value[0].toUpperCase() + value.slice(1) : '')
    const settings = mocks.update.mock.calls[0][1].models[0].settings
    expect(settings.reasoning?.controller_props.value).toBe(value || undefined)
    expect(settings.thinking_budget_tokens).toEqual(budget)
    expect(mocks.select).toHaveBeenCalledWith('llamacpp', 'local')
    expect(mocks.thread).not.toHaveBeenCalled()
  })
  it('preserves local reasoning off when changing or clearing its budget', () => {
    const reasoning = { key: 'reasoning', title: '', description: '', controller_type: 'dropdown' as const, controller_props: { value: 'off' } }
    setup({ id: 'local', capabilities: ['reasoning'], settings: { reasoning } }, 'llamacpp')
    renderPicker(<ComposerModelPicker />)
    for (const value of ['high', '']) {
      choose('Reasoning effort', value ? 'High' : '')
      if (value) fireEvent.click(screen.getByTestId('model-selector-trigger'))
      const settings = mocks.update.mock.calls.at(-1)![1].models[0].settings
      expect(settings.reasoning).toEqual(reasoning)
      expect(settings.thinking_budget_tokens?.controller_props.value).toBe(value || undefined)
    }
  })
  it('keeps absent local reasoning settings at Default without a write', () => {
    setup({ id: 'local', capabilities: ['reasoning'] }, 'llamacpp')
    renderPicker(<ComposerModelPicker />)
    expect(screen.getByRole('menuitem', { name: 'Reasoning mode' }).textContent).toContain('Default')
    expect(screen.getByRole('menuitem', { name: 'Reasoning effort' }).textContent).toContain('Default')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('uses leading footer icons and a trailing chevron only for navigation', () => {
    setup({ id: 'gpt-5.2', settings: {} })
    renderPicker(<ComposerModelPicker />)
    const settings = screen.getByRole('menuitem', { name: 'Model settings' })
    const manage = screen.getByRole('menuitem', { name: 'Manage models' })
    expect(manage.className).toBe(settings.className)
    expect(manage.lastElementChild?.tagName.toLowerCase()).toBe('svg')
    expect(settings.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    expect(settings.lastElementChild?.tagName.toLowerCase()).toBe('span')
    expect(manage.firstElementChild?.tagName.toLowerCase()).toBe('svg')
  })
  it('opens provider management', () => {
    renderPicker(<ComposerModelPicker />)
    fireEvent.click(screen.getByText('Manage models'))
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/providers' })
  })
  it('searches by provider and model name in a flat list', () => {
    renderPicker(<ComposerModelPicker />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Search models or providers' }), { target: { value: 'openai other' } })
    expect(screen.queryByLabelText('Filter models')).toBeNull()
    expect(screen.getByTestId('model-option-other')).toBeTruthy()
    expect(screen.queryByTestId('model-option-gpt-5.2')).toBeNull()
  })
  it('opens selected model settings without selecting a different model', () => {
    setup({ id: 'gpt-5.2', settings: {} })
    renderPicker(<ComposerModelPicker />)
    fireEvent.click(screen.getByText('Model settings'))
    expect(screen.getByText('Model settings overlay')).toBeTruthy()
    expect(mocks.thread).not.toHaveBeenCalled()
  })
  it('moves the active search result with arrows and selects it with Enter', () => {
    renderPicker(<ComposerModelPicker />)
    const search = screen.getByRole('combobox', { name: 'Search models or providers' })
    const other = screen.getByTestId('model-option-other')
    other.scrollIntoView = vi.fn()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search).toHaveAttribute('aria-activedescendant', other.id)
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(mocks.select).toHaveBeenCalledWith('openai', 'other')
  })

  it('selects the first search result with Enter without submitting the composer', () => {
    renderPicker(<ComposerModelPicker />)
    const search = screen.getByRole('combobox', { name: 'Search models or providers' })
    fireEvent.change(search, { target: { value: 'Other model' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(mocks.select).toHaveBeenCalledWith('openai', 'other')
  })

  it('keeps search editable and supports adjacent submenu keyboard focus and checked state', async () => {
    const user = userEvent.setup()
    render(<ComposerModelPicker />)
    await user.click(screen.getByTestId('model-selector-trigger'))
    const search = screen.getByRole('combobox', { name: 'Search models or providers' })
    await waitFor(() => expect(document.activeElement).toBe(search))
    await user.type(search, 'other')
    expect(search).toHaveValue('other')
    expect(document.activeElement).toBe(search)
    expect(screen.queryByTestId('model-option-gpt-5.2')).toBeNull()
    await user.tab()
    const reasoning = screen.getByRole('menuitem', { name: 'Reasoning effort' })
    await waitFor(() => expect(document.activeElement).toBe(reasoning))
    await user.keyboard('{ArrowRight}')
    const defaultChoice = screen.getByRole('menuitemradio', { name: 'Default' })
    await waitFor(() => expect(document.activeElement).toBe(defaultChoice))
    expect(defaultChoice).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelector('select')).toBeNull()
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Low' }))
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(reasoning)
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(search)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('model-selector-trigger')))
  })
  it('marks the active effort choice and does not write when opening its submenu', () => {
    setup({ id: 'gpt-5.2', settings: { thinking_budget_tokens: { key: 'thinking_budget_tokens', title: '', description: '', controller_type: 'dropdown', controller_props: { value: 'high' } } } })
    renderPicker(<ComposerModelPicker />)
    openChoices('Reasoning effort')
    const selectedChoice = screen.getByRole('menuitemradio', { name: 'High' })
    expect(selectedChoice).toHaveAttribute('aria-checked', 'true')
    expect(selectedChoice.querySelector('svg')).toHaveClass('size-4', 'text-primary')
    expect(screen.getByRole('menuitemradio', { name: 'Default' })).toHaveAttribute('aria-checked', 'false')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('retains the full model name for accessibility and desktop with a shrinkable mobile middle', () => {
    const name = 'a-very-long-local-model-name-Q4_K_M.gguf'
    setup({ id: name })
    renderPicker(<ComposerModelPicker />)
    const trigger = screen.getByTestId('model-selector-trigger')
    expect(trigger).toHaveAttribute('title', name)
    expect(trigger).toHaveAttribute('aria-label', `Select model: ${name}`)
    expect(trigger.querySelector('.truncate')?.textContent).toBe(name)
    const mobile = trigger.querySelector('[aria-hidden="true"]')!
    expect(mobile.textContent).toBe(name)
    expect(mobile.firstElementChild?.className).toContain('truncate')
    expect(mobile.lastElementChild?.className).toContain('min-w-0')
    expect(mobile.lastElementChild?.className).toContain('max-w-[40%]')
    expect(mobile.lastElementChild?.className).toContain('truncate')
    expect(mobile.lastElementChild?.className).not.toContain('shrink-0')
    expect(trigger.className).toContain('@max-[520px]/composer:px-2')
    expect(trigger.className).toContain('overflow-hidden')
  })
  it('returns focus to the picker after closing model settings', async () => {
    setup({ id: 'gpt-5.2', settings: {} })
    renderPicker(<ComposerModelPicker />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Model settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('model-selector-trigger')))
    expect(mocks.thread).not.toHaveBeenCalled()
  })

})
