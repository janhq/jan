import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { DropdownMenu, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@/components/ui/dropdown-menu'
import { DropdownMenu as MenuPrimitive } from 'radix-ui'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ModelSettingSheet } from '@/containers/ModelSetting'
import { Brain, Check, ChevronRight, Search, Settings2, SlidersHorizontal } from 'lucide-react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useThreads } from '@/hooks/useThreads'
import { useServiceHub } from '@/hooks/useServiceHub'
import { getModelDisplayName, getProviderTitle, cn } from '@/lib/utils'
import { providerHasRemoteApiKeys } from '@/lib/provider-api-keys'
import { predefinedProviders } from '@/constants/providers'
import { localStorageKey } from '@/constants/localStorage'
import { route } from '@/constants/routes'
import { getLastUsedModel } from '@/utils/getModelToStart'

export interface ComposerModelPickerProps {
  model?: ThreadModel
  useLastUsedModel?: boolean
  onModelChange?: (model: ThreadModel) => void
  className?: string
  disabled?: boolean
}

export interface ComposerEffortChoice {
  value: string
  label: string
}

/** Only offer values that the current transport can encode. Unknown families
 * intentionally have no effort control; sampler capabilities are not evidence
 * of reasoning support. Model-supplied option metadata narrows the known set. */
function supportsLocalReasoning(model: Model | null): boolean {
  return !!model && (
    !!model.capabilities?.includes('reasoning') ||
    !!model.template_kwargs?.some((kwarg) => kwarg.name === 'enable_thinking') ||
    !!model.settings?.reasoning
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function getComposerEffortChoices(providerId: string, model: Model | null): {
  settingKey: 'thinking_budget_tokens' | 'reasoning'
  choices: ComposerEffortChoice[]
} | undefined {
  if (!model) return undefined
  const id = model.id.toLowerCase()
  let settingKey: 'thinking_budget_tokens' | 'reasoning' = 'reasoning'
  let values: string[]
  if (providerId === 'openai') {
    if (!/^(o[134](?:-|$)|gpt-5(?:[.-]|$))/.test(id)) return undefined
    settingKey = 'thinking_budget_tokens'
    // Pro variants do not accept low/medium; o1-mini predates effort controls.
    if (/^o1-(mini|preview)/.test(id) || /-chat(?:-|$)/.test(id)) return undefined
    values = /-pro(?:-|$)/.test(id) ? ['high'] : ['low', 'medium', 'high']
    if (/^gpt-5\.[2-9](?:-|$)|^gpt-5\.1-codex-max(?:-|$)/.test(id)) values.push('xhigh')
  } else if (providerId === 'llamacpp' && supportsLocalReasoning(model)) {
    settingKey = 'thinking_budget_tokens'
    values = ['low', 'medium', 'high', 'xhigh', 'unlimited']
  } else if (
    ((providerId === 'google' || providerId === 'gemini') && /^gemini-2\.5-(?:flash|pro)/.test(id)) ||
    (providerId === 'anthropic' && /(?:sonnet|opus|haiku)-(?:4|[5-9])|3-7-sonnet/.test(id))
  ) {
    // Gemini 2.5 Pro always thinks and rejects a zero thinking budget.
    // Gemini 3 uses a different thinking-level API: do not imply support via
    // the older budget mapping used by buildReasoningProviderOptions.
    values = /^gemini-2\.5-pro/.test(id) ? ['auto', 'on'] : ['auto', 'on', 'off']
  } else return undefined
  const options = model.settings?.[settingKey]?.controller_props?.options
  if (options?.length) values = values.filter((v) => options.some((o) => o.value === v))
  if (!values.length) return undefined
  return {
    settingKey,
    choices: values.map((value) => ({
      value,
      label: value === 'xhigh' ? 'XHigh' : value[0].toUpperCase() + value.slice(1),
    })),
  }
}

/** A real Radix submenu: pointer grace areas, roving focus, typeahead, and
 * ArrowRight/Left/Escape behavior stay with the shared menu primitives. */
function ReasoningSubmenu({ label, accessibleLabel, value, choices, onChange }: {
  label: string
  accessibleLabel: string
  value: string
  choices: ComposerEffortChoice[]
  onChange: (value: string | undefined) => void
}) {
  const options = [{ value: '', label: 'Default' }, ...choices]
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger aria-label={accessibleLabel} className="rounded-lg px-2.5 py-2 [&>svg:last-child]:ml-0">
        <Brain className="size-4 text-muted-foreground" />
        <span>{label}</span>
        <span className="flex-1 text-right text-muted-foreground">{options.find((choice) => choice.value === value)?.label ?? 'Default'}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent aria-label={accessibleLabel} sideOffset={6} className="min-w-40 rounded-xl p-1.5">
          <MenuPrimitive.RadioGroup value={value} onValueChange={(next) => onChange(next || undefined)}>
            {options.map((choice) => (
              <MenuPrimitive.RadioItem key={choice.value} value={choice.value}
                className="flex cursor-default items-center gap-4 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground">
                <span className="flex-1">{choice.label}</span>
                <span className="size-4"><MenuPrimitive.ItemIndicator><Check className="size-4" /></MenuPrimitive.ItemIndicator></span>
              </MenuPrimitive.RadioItem>
            ))}
          </MenuPrimitive.RadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}

export default function ComposerModelPicker({
  model, useLastUsedModel = false, onModelChange, className, disabled,
}: ComposerModelPickerProps) {
  const {
    providers, selectedProvider, selectedModel, selectModelProvider,
    getProviderByName, updateProvider,
  } = useModelProvider((state) => state)
  const updateCurrentThreadModel = useThreads((state) => state.updateCurrentThreadModel)
  const serviceHub = useServiceHub()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const initialized = useRef<string | undefined>(undefined)

  const resultsId = useId()
  const footerRef = useRef<HTMLDivElement>(null)

  // DropdownMenu.Content owns a focus scope even though this footer is inline.
  // Its public API does not expose open autofocus; restore search after mount.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  const initializationKey = JSON.stringify([model?.provider, model?.id, useLastUsedModel])

  useEffect(() => {
    if (!providers.length) return
    const key = initializationKey
    if (initialized.current === key) return
    const exists = (p: string, id: string) => providers.some(
      (provider) => provider.active && provider.provider === p && provider.models.some((m) => m.id === id && !m.embedding)
    )
    if (model) {
      if (exists(model.provider, model.id)) {
        selectModelProvider(model.provider, model.id)
        initialized.current = key
      } else selectModelProvider('', '')
    } else if (useLastUsedModel) {
      const last = getLastUsedModel()
      if (last && exists(last.provider, last.model)) {
        selectModelProvider(last.provider, last.model)
        initialized.current = key
      }
      else {
        const first = providers.find((p) => p.active && p.provider === 'llamacpp')?.models.find((m) => !m.embedding)
        selectModelProvider(first ? 'llamacpp' : '', first?.id ?? '')
        if (!last && first) initialized.current = key
      }
    }
  }, [initializationKey, model, useLastUsedModel, providers, selectModelProvider])

  // Preserve the local model's multimodal configuration on both initialization
  // and manual selection, without blocking the menu on a filesystem check.
  useEffect(() => {
    if (selectedProvider !== 'llamacpp' || !selectedModel) return
    const id = selectedModel.id
    void (async () => {
      await serviceHub.models().checkMmprojExistsAndUpdateOffloadMMprojSetting(id, updateProvider, getProviderByName)
      if (!await serviceHub.models().checkMmprojExists(id)) return
      const provider = getProviderByName('llamacpp')
      const current = provider?.models.find((m) => m.id === id)
      if (!provider || !current || current.capabilities?.includes('vision') ||
        (current as Model & { _userConfiguredCapabilities?: boolean })._userConfiguredCapabilities) return
      updateProvider('llamacpp', { models: provider.models.map((m) => m.id === id
        ? { ...m, capabilities: [...(m.capabilities ?? []), 'vision'], _autoDetectedVision: true } : m) })
    })().catch((error) => console.debug('Failed to check model vision support:', error))
  }, [selectedProvider, selectedModel, serviceHub, updateProvider, getProviderByName])

  const available = providers.filter((p) => p.active).map((p) => ({
    ...p,
    models: p.models.filter((m) => !m.embedding && (
      p.provider === 'llamacpp' || p.provider === 'mlx' || providerHasRemoteApiKeys(p) ||
      !predefinedProviders.some((known) => known.provider.includes(p.provider))
    )),
  })).sort((a, b) => {
    const local = (p: string) => p === 'llamacpp' || p === 'mlx'
    return Number(local(b.provider)) - Number(local(a.provider)) || getProviderTitle(a.provider).localeCompare(getProviderTitle(b.provider))
  })
  const provider = getProviderByName(selectedProvider)
  const effort = getComposerEffortChoices(selectedProvider, selectedModel)
  const rawValue = effort && selectedModel?.settings?.[effort.settingKey]?.controller_props?.value
  const activeChoice = effort?.choices.find((c) => c.value === rawValue)
  const localReasoning = selectedProvider === 'llamacpp' && supportsLocalReasoning(selectedModel)
  const reasoningValue = selectedModel?.settings?.reasoning?.controller_props?.value
  const override = localReasoning && reasoningValue === 'off' ? 'Off' : activeChoice && !['auto', 'unlimited'].includes(activeChoice.value) ? activeChoice.label : undefined

  const select = (providerId: string, modelId: string) => {
    // A manual choice wins over a target still waiting for provider hydration.
    initialized.current = initializationKey
    selectModelProvider(providerId, modelId)
    ;(onModelChange ?? updateCurrentThreadModel)({ provider: providerId, id: modelId })
    try { localStorage.setItem(localStorageKey.lastUsedModel, JSON.stringify({ provider: providerId, model: modelId })) }
    catch (error) { console.debug('Failed to save last used model:', error) }
    setOpen(false)
  }
  const setEffort = (value: string | undefined, settingKey = effort?.settingKey) => {
    if (!provider || !selectedModel || !settingKey) return
    const settings = { ...selectedModel.settings }
    if (value === undefined) delete settings[settingKey]
    else settings[settingKey] = {
      ...(settings[settingKey] ?? {
        key: settingKey, title: 'Reasoning effort', description: '', controller_type: 'dropdown',
      }),
      controller_props: { ...settings[settingKey]?.controller_props, value },
    }
    updateProvider(provider.provider, { models: provider.models.map((m) => m.id === selectedModel.id ? { ...m, settings } : m) })
    selectModelProvider(provider.provider, selectedModel.id)
    setOpen(false)
  }

  const results = available.flatMap((p) => p.models.map((m) => ({ provider: p, model: m })))
    .filter(({ provider: p, model: m }) => {
      const text = `${getModelDisplayName(m)} ${m.id} ${p.provider} ${getProviderTitle(p.provider)}`.toLowerCase()
      return query.toLowerCase().trim().split(/\s+/).every((term) => text.includes(term))
    })
    .sort((a, b) => {
      const selected = (x: typeof a) => x.provider.provider === selectedProvider && x.model.id === selectedModel?.id
      return Number(selected(b)) - Number(selected(a))
    })

  const displayName = selectedModel ? getModelDisplayName(selectedModel) : 'Select a model'
  // Keep the identifying tail visible on narrow composers; desktop retains the
  // complete name. This is presentational only, never the accessible name.
  const tailLength = Math.min(8, Math.floor(displayName.length / 3))

  return (
    <>
      <Popover open={open} onOpenChange={(next) => {
        setOpen(next)
        if (next) { setQuery(''); setActiveIndex(0) }
      }}>
        <PopoverTrigger asChild>
          <button ref={triggerRef} type="button" disabled={disabled} aria-label={`Select model: ${selectedModel ? getModelDisplayName(selectedModel) : 'None'}`} data-testid="model-selector-trigger" title={displayName}
            className={cn('inline-flex h-8 min-w-0 max-w-64 @max-[520px]/composer:max-w-full @max-[520px]/composer:shrink @max-[520px]/composer:px-2 overflow-hidden items-center gap-1.5 rounded-full border border-border/60 bg-background px-4 text-sm text-muted-foreground shadow-xs dark:border-white/10 dark:bg-white/[0.06] dark:text-foreground/85 dark:shadow-none transition-colors hover:bg-muted/50 hover:text-foreground dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', className)}>
            <span className="truncate @max-[520px]/composer:hidden">{displayName}</span>
            <span aria-hidden="true" className="hidden min-w-0 flex-1 items-center @max-[520px]/composer:flex">
              <span className="min-w-0 truncate">{tailLength ? displayName.slice(0, -tailLength) : displayName}</span>
              {tailLength > 0 && <span className="min-w-0 max-w-[40%] shrink truncate">{displayName.slice(-tailLength)}</span>}
            </span>
            {override && <span className="shrink-0 text-muted-foreground @max-[520px]/composer:hidden">· {override}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent aria-label="Choose a model" align="end" side="top" sideOffset={8} className="w-[336px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl p-0 shadow-lg"
          onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus() }}
          onCloseAutoFocus={(event) => { if (settingsOpen) event.preventDefault() }}>
          <div className="border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input ref={searchRef} role="combobox" aria-label="Search models or providers" aria-expanded={open} aria-controls={resultsId} aria-autocomplete="list"
                aria-activedescendant={results[activeIndex] ? `${resultsId}-${activeIndex}` : undefined}
                value={query} placeholder="Search models or providers…" className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none"
                onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation()
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Tab' && !e.shiftKey) {
                    const first = footerRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
                    if (first) { e.preventDefault(); first.focus() }
                  }
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActiveIndex((n) => {
                      const next = Math.max(0, Math.min(results.length - 1, n + (e.key === 'ArrowDown' ? 1 : -1)))
                      document.getElementById(`${resultsId}-${next}`)?.scrollIntoView({ block: 'nearest' })
                      return next
                    })
                  } else if (e.key === 'Enter') {
                    e.preventDefault(); e.stopPropagation()
                    const row = results[activeIndex]
                    if (row) select(row.provider.provider, row.model.id)
                  }
                }} />
            </div>
          </div>
          <div id={resultsId} role="listbox" aria-label="Models" className="max-h-64 overflow-y-auto p-1.5">
            {results.map(({ provider: p, model: m }, index) => {
              const selected = p.provider === selectedProvider && m.id === selectedModel?.id
              return <button type="button" role="option" tabIndex={-1} aria-selected={selected} id={`${resultsId}-${index}`} key={`${p.provider}/${m.id}`}
                onKeyDown={(e) => { if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation() }}
                data-testid={`model-option-${m.id}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => select(p.provider, m.id)}
                className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', activeIndex === index && 'bg-muted', selected && 'font-medium')}>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm" title={m.id}>{getModelDisplayName(m)}</span><span className="block text-[11px] leading-4 font-normal text-muted-foreground">{getProviderTitle(p.provider)}</span></span>
                {selected && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            })}
            {!results.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{available.some((p) => p.models.length) ? 'No matching models' : 'No models configured'}</p>}
          </div>
          {/* Only the footer is a menu. Keep its Popper wrapper in normal flow;
              submenus still use the shared portalled/layered primitives. */}
          <div className="border-t p-1.5 [&>[data-radix-popper-content-wrapper]]:static! [&>[data-radix-popper-content-wrapper]]:transform-none! [&>[data-radix-popper-content-wrapper]]:w-full!">
            <DropdownMenu modal={false} open>
              <MenuPrimitive.Content ref={footerRef} aria-label="Model options" className="space-y-0.5 outline-none"
                onCloseAutoFocus={(event) => event.preventDefault()}
                onInteractOutside={(event) => event.preventDefault()}
                onEscapeKeyDown={() => setOpen(false)}
                onKeyDown={(event) => {
                  if (event.key !== 'Tab') return
                  event.preventDefault()
                  event.stopPropagation()
                  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
                  const index = rows.indexOf(document.activeElement as HTMLElement)
                  if (event.shiftKey && index <= 0) searchRef.current?.focus()
                  else if (!event.shiftKey && index < rows.length - 1) rows[index + 1]?.focus()
                  else setOpen(false)
                }}>
            {localReasoning && <ReasoningSubmenu label="Reasoning" accessibleLabel="Reasoning mode"
              value={['auto', 'on', 'off'].includes(String(reasoningValue)) ? String(reasoningValue) : ''}
              choices={['auto', 'on', 'off'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
              onChange={(value) => setEffort(value, 'reasoning')} />}
            {effort && <ReasoningSubmenu label={localReasoning ? 'Thinking budget' : 'Reasoning'} accessibleLabel="Reasoning effort"
              value={activeChoice?.value ?? ''}
              choices={effort.choices.map((choice) => ({ ...choice, label: choice.label === 'XHigh' ? 'Very high' : choice.label }))}
              onChange={(value) => setEffort(value)} />}
            {provider && selectedModel?.settings && <DropdownMenuItem className="rounded-lg px-2.5 py-2" onSelect={() => { setOpen(false); setSettingsOpen(true) }}>
              <Settings2 className="size-4 text-muted-foreground" /><span>Model settings</span>
            </DropdownMenuItem>}
            <DropdownMenuItem className="rounded-lg px-2.5 py-2" onSelect={() => { setOpen(false); navigate({ to: route.settings.model_providers }) }}>
              <SlidersHorizontal className="size-4 text-muted-foreground" /><span className="flex-1">Manage models</span><ChevronRight className="size-4 text-muted-foreground" />
            </DropdownMenuItem>
              </MenuPrimitive.Content>
            </DropdownMenu>
          </div>
        </PopoverContent>
      </Popover>
      {provider && selectedModel?.settings && <ModelSettingSheet model={selectedModel} provider={provider} open={settingsOpen} onOpenChange={setSettingsOpen} onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus() }} />}
    </>
  )
}
