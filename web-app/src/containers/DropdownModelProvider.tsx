/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useRef, useMemo, useCallback, memo } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderTitle, getModelDisplayName } from '@/lib/utils'
import { highlightFzfMatch } from '@/utils/highlight'
import Capabilities from './Capabilities'
import { IconSettings, IconX } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'
import { ModelSetting } from '@/containers/ModelSetting'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { ModelSupportStatus } from '@/containers/ModelSupportStatus'
import { Fzf } from 'fzf'
import { localStorageKey } from '@/constants/localStorage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useFavoriteModel } from '@/hooks/useFavoriteModel'
import { predefinedProviders } from '@/constants/providers'
import { providerHasConfiguredRemoteAuth } from '@/lib/provider-api-keys'
import {
  getXaiOAuthStatus,
  onXaiOAuthLoginComplete,
} from '@/lib/xai-oauth'
import { useServiceHub } from '@/hooks/useServiceHub'
import { getLastUsedModel } from '@/utils/getModelToStart'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { ModelReasoningDropdown } from '@/containers/ModelReasoningDropdown'
import {
  applyModelReasoningUpdate,
  getModelReasoningOptions,
  getModelReasoningSetting,
  getModelReasoningValue,
  modelSupportsReasoningControl,
  type ModelReasoningValue,
} from '@/lib/model-reasoning'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type DropdownModelProviderProps = {
  model?: ThreadModel
  useLastUsedModel?: boolean
  compact?: boolean
  popupSide?: 'top' | 'right' | 'bottom' | 'left'
  popupAlign?: 'start' | 'center' | 'end'
  showSettings?: boolean
  showSupportStatus?: boolean
  showReasoning?: boolean
}

interface SearchableModel {
  provider: ModelProvider
  model: Model
  searchStr: string
  value: string
  highlightedId?: string
}

const DEFAULT_CONTEXT_SIZE = 8192

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

const getModelContextValue = (
  model?: Pick<Model, 'settings'> | null
): number => {
  return (
    toFiniteNumber(model?.settings?.ctx_len?.controller_props?.value) ??
    DEFAULT_CONTEXT_SIZE
  )
}

const getModelContextMax = (
  model?: Pick<Model, 'settings'> | null
): number | undefined => {
  return toFiniteNumber(model?.settings?.ctx_len?.controller_props?.max)
}

const getModelContextRecommended = (
  model?: Pick<Model, 'settings'> | null
): number | undefined => {
  const props = model?.settings?.ctx_len?.controller_props
  return (
    toFiniteNumber(props?.recommended) ?? toFiniteNumber(props?.placeholder)
  )
}

const formatContextSize = (value: number): string => {
  if (value >= 1_000_000) {
    const scaled = value / 1_000_000
    return `${Number.isInteger(scaled) ? scaled : scaled.toFixed(1)}M`
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`
  }
  return value.toLocaleString()
}

const getContextOptions = (model?: Model): number[] => {
  if (!model) return []

  const current = getModelContextValue(model)
  const recommended = getModelContextRecommended(model)
  const max = getModelContextMax(model)
  const options = [recommended ?? current, current]

  if (max && max !== current) {
    options.push(max)
  }

  return Array.from(new Set(options.filter((value) => value > 0)))
}

// Helper functions for localStorage
const setLastUsedModel = (provider: string, model: string) => {
  try {
    localStorage.setItem(
      localStorageKey.lastUsedModel,
      JSON.stringify({ provider, model })
    )
  } catch (error) {
    console.debug('Failed to set last used model in localStorage:', error)
  }
}

const getFirstActiveModelForProvider = (
  providers: ModelProvider[],
  providerName: string
) => {
  const provider = providers.find(
    (p) => p.provider === providerName && p.active && p.models.length > 0
  )
  return provider?.models[0]
}

const DropdownModelProvider = memo(function DropdownModelProvider({
  model,
  useLastUsedModel = false,
  compact = false,
  popupSide = 'bottom',
  popupAlign = 'start',
  showSettings = true,
  showSupportStatus = true,
  showReasoning = false,
}: DropdownModelProviderProps) {
  const {
    providers,
    getProviderByName,
    selectModelProvider,
    getModelBy,
    selectedProvider,
    selectedModel,
    updateProvider,
  } = useModelProvider()
  const [displayModel, setDisplayModel] = useState<string>('')
  const { updateCurrentThreadModel } = useThreads()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { favoriteModels } = useFavoriteModel()
  const serviceHub = useServiceHub()

  // Search state
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [remoteAuthRevision, setRemoteAuthRevision] = useState(0)
  const [settingsModelValue, setSettingsModelValue] = useState<string | null>(null)
  const useCursorStyleSelector = compact && showReasoning

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void getXaiOAuthStatus().then(() => {
      setRemoteAuthRevision((n) => n + 1)
    })
    void onXaiOAuthLoginComplete(() => {
      setRemoteAuthRevision((n) => n + 1)
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [])

  // Helper function to check if a model exists in providers
  const checkModelExists = useCallback(
    (providerName: string, modelId: string) => {
      const provider = providers.find(
        (p) => p.provider === providerName && p.active
      )
      return provider?.models.find((m) => m.id === modelId)
    },
    [providers]
  )

  // Helper function to get context size from model settings
  const getContextSize = useCallback((): number => {
    if (!selectedModel?.settings?.ctx_len?.controller_props?.value) {
      return 8192 // Default context size
    }
    return selectedModel.settings.ctx_len.controller_props.value as number
  }, [selectedModel?.settings?.ctx_len?.controller_props?.value])

  // Function to check if a llamacpp model has vision capabilities and update model capabilities
  const checkAndUpdateModelVisionCapability = useCallback(
    async (modelId: string) => {
      try {
        const hasVision = await serviceHub.models().checkMmprojExists(modelId)
        if (hasVision) {
          // Update the model capabilities to include 'vision'
          const provider = getProviderByName('llamacpp')
          if (provider) {
            const modelIndex = provider.models.findIndex(
              (m) => m.id === modelId
            )
            if (modelIndex !== -1) {
              const model = provider.models[modelIndex]
              const capabilities = model.capabilities || []

              // Add 'vision' capability if not already present AND if user hasn't manually configured capabilities
              // Check if model has a custom capabilities config flag

              const hasUserConfiguredCapabilities =
                (model as any)._userConfiguredCapabilities === true

              if (
                !capabilities.includes('vision') &&
                !hasUserConfiguredCapabilities
              ) {
                const updatedModels = [...provider.models]
                updatedModels[modelIndex] = {
                  ...model,
                  capabilities: [...capabilities, 'vision'],
                  // Mark this as auto-detected, not user-configured
                  _autoDetectedVision: true,
                } as any

                updateProvider('llamacpp', { models: updatedModels })
              }
            }
          }
        }
      } catch (error) {
        console.debug('Error checking mmproj for model:', modelId, error)
      }
    },
    [getProviderByName, updateProvider, serviceHub]
  )

  // Initialize model provider - avoid race conditions with manual selections
  useEffect(() => {
    const initializeModel = async () => {
      // Auto select model when existing thread is passed
      if (model) {
        selectModelProvider(model?.provider as string, model?.id as string)
        if (!checkModelExists(model.provider, model.id)) {
          selectModelProvider('', '')
        }
        // Check mmproj existence for llamacpp models
        if (model?.provider === 'llamacpp') {
          await serviceHub
            .models()
            .checkMmprojExistsAndUpdateOffloadMMprojSetting(
              model.id as string,
              updateProvider,
              getProviderByName
            )
          // Also check vision capability
          await checkAndUpdateModelVisionCapability(model.id as string)
        }
      } else if (useLastUsedModel) {
        // Fresh agent chats should enter the Codex runtime when it is available.
        // Direct local/remote models remain selectable from the dropdown.
        const lastUsed = getLastUsedModel()
        const codexModel = getFirstActiveModelForProvider(providers, 'codex')
        if (
          lastUsed?.provider === 'codex' &&
          checkModelExists(lastUsed.provider, lastUsed.model)
        ) {
          selectModelProvider(lastUsed.provider, lastUsed.model)
        } else if (codexModel) {
          selectModelProvider('codex', codexModel.id)
          setLastUsedModel('codex', codexModel.id)
        } else if (lastUsed && checkModelExists(lastUsed.provider, lastUsed.model)) {
          selectModelProvider(lastUsed.provider, lastUsed.model)
          if (lastUsed.provider === 'llamacpp') {
            await serviceHub
              .models()
              .checkMmprojExistsAndUpdateOffloadMMprojSetting(
                lastUsed.model,
                updateProvider,
                getProviderByName
              )
            // Also check vision capability
            await checkAndUpdateModelVisionCapability(lastUsed.model)
          }
        } else {
          // Fallback: auto-select first llamacpp model if available
          const firstModel = getFirstActiveModelForProvider(
            providers,
            'llamacpp'
          )
          if (firstModel) {
            selectModelProvider('llamacpp', firstModel.id)
            setLastUsedModel('llamacpp', firstModel.id)
          } else {
            selectModelProvider('', '')
          }
        }
      }
    }

    initializeModel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    model,
    selectModelProvider,
    updateCurrentThreadModel,
    providers,
    checkModelExists,
    updateProvider,
    getProviderByName,
    checkAndUpdateModelVisionCapability,

    // selectedModel and selectedProvider intentionally excluded to prevent race conditions
  ])

  // Update display model when selection changes
  useEffect(() => {
    if (selectedProvider && selectedModel) {
      setDisplayModel(getModelDisplayName(selectedModel))
    } else {
      setDisplayModel(t('common:selectAModel'))
    }
  }, [selectedProvider, selectedModel, t])

  // Check vision capabilities for all llamacpp models
  useEffect(() => {
    const checkAllLlamacppModelsForVision = async () => {
      const llamacppProvider = providers.find(
        (p) => p.provider === 'llamacpp' && p.active
      )
      if (llamacppProvider) {
        const checkPromises = llamacppProvider.models.map((model) =>
          checkAndUpdateModelVisionCapability(model.id)
        )
        await Promise.allSettled(checkPromises)
      }
    }

    if (open) {
      checkAllLlamacppModelsForVision()
    }
  }, [open, providers, checkAndUpdateModelVisionCapability])

  // Reset search value when dropdown closes
  const onOpenChange = useCallback((open: boolean) => {
    setOpen(open)
    if (!open) {
      requestAnimationFrame(() => setSearchValue(''))
      setSettingsModelValue(null)
    } else {
      // Focus search input when opening
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 100)
    }
  }, [])

  // Clear search and focus input
  const onClearSearch = useCallback(() => {
    setSearchValue('')
    searchInputRef.current?.focus()
  }, [])

  // Create searchable items from all models
  const searchableItems = useMemo(() => {
    // Recompute after remote auth callbacks refresh provider availability.
    void remoteAuthRevision

    const items: SearchableModel[] = []

    providers.forEach((provider) => {
      if (!provider.active) return

      provider.models.forEach((modelItem) => {
        // Skip embedding models - they can't be used for chat
        if (modelItem.embedding) return

        // Skip disabled/inactive models (default to active for local providers, inactive for remote)
        const isModelActive = modelItem.active !== undefined
          ? modelItem.active
          : (provider.provider === 'llamacpp' || provider.provider === 'mlx')
        if (!isModelActive) return

        // Skip models that require API key but don't have one (except llamacpp)
        // For custom providers, allow if they have at least one model loaded
        const isPredefined = predefinedProviders.some((e) =>
          e.provider.includes(provider.provider)
        )
        if (
          provider &&
          provider.provider !== 'llamacpp' &&
          !providerHasConfiguredRemoteAuth(provider) &&
          (isPredefined || provider.models.length === 0)
        )
          return

        const capabilities = modelItem.capabilities || []
        const capabilitiesString = capabilities.join(' ')
        const providerTitle = getProviderTitle(provider.provider)

        // Create search string with model id, provider, and capabilities
        const searchStr =
          `${modelItem.id} ${providerTitle} ${provider.provider} ${capabilitiesString}`.toLowerCase()

        items.push({
          provider,
          model: modelItem,
          searchStr,
          value: `${provider.provider}:${modelItem.id}`,
        })
      })
    })

    return items
  }, [providers, remoteAuthRevision])

  // Create Fzf instance for fuzzy search
  const fzfInstance = useMemo(() => {
    return new Fzf(searchableItems, {
      selector: (item: SearchableModel) =>
        `${getModelDisplayName(item.model)} ${item.model.id}`.toLowerCase(),
    })
  }, [searchableItems])

  // Get favorite models that are currently available
  const favoriteItems = useMemo(() => {
    return searchableItems.filter((item) =>
      favoriteModels.some((fav) => fav.id === item.model.id)
    )
  }, [searchableItems, favoriteModels])

  // Filter models based on search value
  const filteredItems = useMemo<SearchableModel[]>(() => {
    if (!searchValue) return searchableItems

    return fzfInstance.find(searchValue.toLowerCase()).map((result: {
      item: SearchableModel
      positions: Iterable<number>
    }) => {
      const item = result.item
      const positions = Array.from(result.positions)
      const highlightedId = highlightFzfMatch(
        item.model.id,
        positions,
        'text-accent'
      )

      return {
        ...item,
        highlightedId,
      }
    })
  }, [searchableItems, searchValue, fzfInstance])

  const selectedSearchableItem = useMemo(() => {
    if (!selectedProvider || !selectedModel?.id) return undefined
    return searchableItems.find(
      (item) =>
        item.provider.provider === selectedProvider &&
        item.model.id === selectedModel.id
    )
  }, [searchableItems, selectedModel?.id, selectedProvider])

  const settingsSearchableItem = useMemo(() => {
    if (!settingsModelValue) return undefined
    return searchableItems.find((item) => item.value === settingsModelValue)
  }, [settingsModelValue, searchableItems])

  const panelModelItem = settingsSearchableItem ?? selectedSearchableItem

  // Group filtered items by provider, excluding favorites when not searching
  const groupedItems = useMemo(() => {
    const groups: Record<string, SearchableModel[]> = {}

    if (!searchValue) {
      // When not searching, show all active providers (even without models)
      // Sort: local first, then providers with API keys or custom with models, then others, alphabetically
      const activeProviders = providers
        .filter((p) => p.active)
        .sort((a, b) => {
          const aIsLocal = a.provider === 'llamacpp' || a.provider === 'mlx'
          const bIsLocal = b.provider === 'llamacpp' || b.provider === 'mlx'
          // Local (llamacpp) first
          if (aIsLocal && !bIsLocal) return -1
          if (!aIsLocal && bIsLocal) return 1

          // Custom providers without API key but with models should be treated like "have API key"
          const aIsPredefined = predefinedProviders.some((e) =>
            e.provider.includes(a.provider)
          )
          const bIsPredefined = predefinedProviders.some((e) =>
            e.provider.includes(b.provider)
          )
          const aHasApiKeyOrCustomModel =
            providerHasConfiguredRemoteAuth(a) ||
            (!aIsPredefined && a.models.length > 0)
          const bHasApiKeyOrCustomModel =
            providerHasConfiguredRemoteAuth(b) ||
            (!bIsPredefined && b.models.length > 0)
          // Providers with API keys or custom with models filled second
          if (aHasApiKeyOrCustomModel && !bHasApiKeyOrCustomModel) return -1
          if (!aHasApiKeyOrCustomModel && bHasApiKeyOrCustomModel) return 1

          // Sort remaining by provider name
          return a.provider.localeCompare(b.provider)
        })

      activeProviders.forEach((provider) => {
        groups[provider.provider] = []
      })
    }

    // Add the filtered items to their respective groups
    filteredItems.forEach((item) => {
      const providerKey = item.provider.provider
      if (!groups[providerKey]) {
        groups[providerKey] = []
      }

      // When not searching, exclude favorite models from regular provider sections
      const isFavorite = favoriteModels.some((fav) => fav.id === item.model.id)
      if (!searchValue && isFavorite) return // Skip adding this item to regular provider section

      groups[providerKey].push(item)
    })

    return groups
  }, [filteredItems, providers, searchValue, favoriteModels])

  const updateModelSetting = useCallback(
    (
      providerName: string,
      modelId: string,
      key: string,
      value: string | boolean | number
    ) => {
      const providerObj = getProviderByName(providerName)
      if (!providerObj) return

      const modelIndex = providerObj.models.findIndex((m) => m.id === modelId)
      if (modelIndex === -1) return

      const existingModel = providerObj.models[modelIndex]
      const existingSetting = existingModel.settings?.[key]
      const updatedModel = {
        ...existingModel,
        settings: {
          ...existingModel.settings,
          [key]: {
            key,
            title: key === 'ctx_len' ? 'Context Size' : key,
            description: existingSetting?.description ?? '',
            controller_type: existingSetting?.controller_type ?? 'input',
            ...existingSetting,
            controller_props: {
              ...(existingSetting?.controller_props ?? {}),
              ...(key === 'ctx_len' &&
              existingSetting?.controller_props?.recommended === undefined
                ? {
                    recommended: String(
                      getModelContextValue(existingModel)
                    ),
                  }
                : {}),
              value,
            },
          },
        },
      } as Model

      const updatedModels = [...providerObj.models]
      updatedModels[modelIndex] = updatedModel

      updateProvider(providerName, { models: updatedModels })

      if (providerName === 'llamacpp') {
        serviceHub
          .models()
          .updateModelSettings(modelId, { [key]: value })
          .catch((error) => {
            console.error('Failed to persist model setting', error)
          })
      }
    },
    [getProviderByName, serviceHub, updateProvider]
  )

  const handleContextSelect = useCallback(
    (searchableModel: SearchableModel, value: number) => {
      updateModelSetting(
        searchableModel.provider.provider,
        searchableModel.model.id,
        'ctx_len',
        value
      )
    },
    [updateModelSetting]
  )

  const handleReasoningSelect = useCallback(
    (searchableModel: SearchableModel, value: ModelReasoningValue) => {
      const updatedProvider = applyModelReasoningUpdate(
        searchableModel.provider,
        searchableModel.model.id,
        value
      )

      if (!updatedProvider) return

      updateProvider(searchableModel.provider.provider, {
        models: updatedProvider.models,
      })

      if (
        selectedProvider === searchableModel.provider.provider &&
        selectedModel?.id === searchableModel.model.id
      ) {
        selectModelProvider(
          searchableModel.provider.provider,
          searchableModel.model.id
        )
      }
    },
    [
      selectModelProvider,
      selectedModel?.id,
      selectedProvider,
      updateProvider,
    ]
  )

  const handleSelect = useCallback(
    async (searchableModel: SearchableModel) => {
      // Immediately update display to prevent double-click issues
      setDisplayModel(getModelDisplayName(searchableModel.model))
      setSearchValue('')
      setSettingsModelValue(null)
      setOpen(false)

      selectModelProvider(
        searchableModel.provider.provider,
        searchableModel.model.id
      )
      updateCurrentThreadModel({
        id: searchableModel.model.id,
        provider: searchableModel.provider.provider,
      })

      // Store the selected model as last used
      setLastUsedModel(
        searchableModel.provider.provider,
        searchableModel.model.id
      )

      // Check mmproj existence for llamacpp models (async, don't block UI)
      if (searchableModel.provider.provider === 'llamacpp') {
        serviceHub
          .models()
          .checkMmprojExistsAndUpdateOffloadMMprojSetting(
            searchableModel.model.id,
            updateProvider,
            getProviderByName
          )
          .catch((error) => {
            console.debug(
              'Error checking mmproj for model:',
              searchableModel.model.id,
              error
            )
          })

        // Also check vision capability (async, don't block UI)
        checkAndUpdateModelVisionCapability(searchableModel.model.id).catch(
          (error) => {
            console.debug(
              'Error checking vision capability for model:',
              searchableModel.model.id,
              error
            )
          }
        )
      }
    },
    [
      selectModelProvider,
      updateCurrentThreadModel,
      updateProvider,
      getProviderByName,
      checkAndUpdateModelVisionCapability,
      serviceHub,
    ]
  )

  const currentModel = selectedModel?.id
    ? getModelBy(selectedModel?.id)
    : undefined

  if (!providers.length) return null

  const provider = getProviderByName(selectedProvider)
  const panelContextOptions = getContextOptions(panelModelItem?.model)
  const panelContextValue = panelModelItem
    ? getModelContextValue(panelModelItem.model)
    : undefined
  const panelReasoningOptions = panelModelItem
    ? getModelReasoningOptions(panelModelItem.model)
    : []
  const panelReasoningValue = panelModelItem
    ? getModelReasoningValue(panelModelItem.model)
    : undefined
  const panelReasoningTitle =
    (panelModelItem
      ? getModelReasoningSetting(panelModelItem.model)?.title
      : undefined) ?? t('common:reasoning')

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            'border relative z-20 flex items-center gap-1.5',
            compact
              ? 'max-w-full rounded-md bg-secondary/40 px-2.5 py-1.5 shadow-sm'
              : 'max-w-[22rem] rounded-full px-4 py-1.5'
          )}
        >
          <button
            type="button"
            className="font-medium cursor-pointer flex min-w-0 items-center gap-1.5 relative z-20"
            aria-label="Select model"
          >
            {provider && (
              <div className="shrink-0">
                <ProvidersAvatar provider={provider} />
              </div>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'text-foreground truncate leading-normal',
                    compact ? 'text-xs' : 'text-base',
                    !selectedModel?.id && 'text-muted-foreground'
                  )}
                >
                  {displayModel}
                </span>
              </TooltipTrigger>
              <TooltipContent>{displayModel}</TooltipContent>
            </Tooltip>
            <ChevronsUpDown
              className={cn(
                'shrink-0 text-muted-foreground',
                compact ? 'size-3.5' : 'size-4'
              )}
            />
          </button>
          {currentModel?.settings &&
            provider &&
            provider.provider === 'llamacpp' &&
            showSettings && (
              <div onClick={(e) => e.stopPropagation()}>
                <ModelSetting
                  model={currentModel as Model}
                  provider={provider}
                />
              </div>
            )}
          {showSupportStatus && (
            <ModelSupportStatus
              modelId={selectedModel?.id}
              provider={selectedProvider}
              contextSize={getContextSize()}
              className="ml-0.5 shrink-0"
            />
          )}
        </div>
      </PopoverTrigger>

      <PopoverContent
        className={cn(
          'rounded-md border bg-popover p-0 text-popover-foreground shadow-md',
          useCursorStyleSelector
            ? 'w-80 max-w-[calc(100vw-2rem)] overflow-visible'
            : 'w-auto min-w-70 max-w-[90vw]',
          !useCursorStyleSelector && searchValue.length === 0 && 'h-80'
        )}
        align={popupAlign}
        // sideOffset={16}
        // alignOffset={-10}
        side={popupSide}
        avoidCollisions={useCursorStyleSelector || searchValue.length === 0}
      >
        <div
          className={cn(
            useCursorStyleSelector
              ? 'relative flex flex-col overflow-visible'
              : 'flex flex-col size-full'
          )}
        >
          <div
            className={cn(
              useCursorStyleSelector
                ? 'flex min-w-0 flex-1 flex-col'
                : 'flex flex-col size-full'
            )}
          >
            {/* Search input */}
            <div className="relative p-2 border-b">
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={t('common:searchModels')}
              className={cn(
                'w-full bg-transparent text-sm font-normal outline-0',
                useCursorStyleSelector && 'placeholder:text-muted-foreground'
              )}
            />
            {searchValue.length > 0 && (
              <div className="absolute right-2 top-0 bottom-0 flex items-center justify-center">
                <IconX
                  size={16}
                  className="text-muted-foreground cursor-pointer"
                  onClick={onClearSearch}
                />
              </div>
            )}
            </div>

            {/* Model list */}
            <div
              className={cn(
                'overflow-y-auto',
                useCursorStyleSelector ? 'max-h-64 p-1' : 'max-h-80'
              )}
            >
            {Object.keys(groupedItems).length === 0 && searchValue ? (
              <div className="py-3 px-4 text-sm ">
                {t('common:noModelsFoundFor', { searchValue })}
              </div>
            ) : (
              <div className="py-1">
                {/* Favorites section - only show when not searching */}
                {!searchValue && favoriteItems.length > 0 && (
                  <div
                    className={cn(
                      useCursorStyleSelector
                        ? 'py-1'
                        : 'bg-secondary/30 rounded-sm m-2 py-1'
                    )}
                  >
                    {/* Favorites header */}
                    <div className="flex items-center gap-1.5 px-2 py-1">
                      <span
                        className={cn(
                          'font-medium text-muted-foreground',
                          useCursorStyleSelector
                            ? 'text-[11px] uppercase'
                            : 'text-sm'
                        )}
                      >
                        {t('common:favorites')}
                      </span>
                    </div>

                    {/* Favorite models */}
                    {favoriteItems.map((searchableModel) => {
                      const isSelected =
                        selectedModel?.id === searchableModel.model.id &&
                        selectedProvider === searchableModel.provider.provider
                      const capabilities =
                        searchableModel.model.capabilities || []

                      return (
                        <div
                          key={`fav-${searchableModel.value}`}
                          onClick={() => handleSelect(searchableModel)}
                          className={cn(
                            'mx-1 mb-1 cursor-pointer flex items-center gap-2 transition-all duration-200',
                            useCursorStyleSelector
                              ? 'rounded-md px-2 py-1.5 hover:bg-secondary/60'
                              : 'rounded-sm px-2 py-1.5 hover:bg-secondary/40',
                            isSelected &&
                              (useCursorStyleSelector
                                ? 'bg-secondary/70 hover:bg-secondary/70'
                                : 'bg-primary/15 hover:bg-primary/15 ring-1 ring-primary/40')
                          )}
                        >
                          <div className="flex items-center gap-1 flex-1 min-w-0">
                            <div className="shrink-0 -ml-1">
                              <ProvidersAvatar
                                provider={searchableModel.provider}
                              />
                            </div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm truncate">
                                  {getModelDisplayName(searchableModel.model)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {searchableModel.model.id}
                              </TooltipContent>
                            </Tooltip>
                            <div className="flex-1"></div>
                            {!useCursorStyleSelector &&
                              capabilities.length > 0 && (
                              <div className="shrink-0 -mr-1.5">
                                <Capabilities capabilities={capabilities} />
                              </div>
                            )}
                            {showReasoning && !useCursorStyleSelector && (
                              <ModelReasoningDropdown
                                model={searchableModel.model}
                                providerName={searchableModel.provider.provider}
                                variant="row"
                              />
                            )}
                            {useCursorStyleSelector && isSelected && (
                              <>
                                <button
                                  type="button"
                                  className="rounded-sm px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    setSettingsModelValue((value) =>
                                      value === searchableModel.value
                                        ? null
                                        : searchableModel.value
                                    )
                                  }}
                                >
                                  Edit
                                </button>
                                <Check className="size-4 shrink-0 text-foreground" />
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Divider between favorites and regular providers */}
                {favoriteItems.length > 0 && (
                  <div className="border-b mx-2"></div>
                )}

                {/* Regular provider sections */}
                {Object.entries(groupedItems).map(([providerKey, models]) => {
                  const providerInfo = providers.find(
                    (p) => p.provider === providerKey
                  )

                  if (!providerInfo) return null

                  return (
                    <div
                      key={providerKey}
                      className={cn(
                        useCursorStyleSelector
                          ? 'py-1'
                          : 'bg-secondary/30 first:mt-0 rounded-sm my-1.5 mx-1.5 first:mb-0 py-1'
                      )}
                    >
                      {/* Provider header */}
                      <div className="flex items-center justify-between px-2 py-1">
                        <div className="flex items-center gap-1.5">
                          {!useCursorStyleSelector && (
                            <ProvidersAvatar provider={providerInfo} />
                          )}
                          <span
                            className={cn(
                              'capitalize font-medium text-muted-foreground',
                              useCursorStyleSelector
                                ? 'text-[11px] uppercase'
                                : 'text-sm'
                            )}
                          >
                            {getProviderTitle(providerInfo.provider)}
                          </span>
                        </div>

                        {!useCursorStyleSelector && (
                          <div
                            className="size-6 cursor-pointer flex items-center justify-center rounded-sm bg-secondary-foreground/8 transition-all duration-200 ease-in-out"
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate({
                                to: route.settings.providers,
                                params: {
                                  providerName: providerInfo.provider,
                                },
                              })
                              setOpen(false)
                            }}
                          >
                            <IconSettings
                              size={16}
                              className="text-muted-foreground"
                            />
                          </div>
                        )}
                      </div>

                      {/* Models for this provider */}
                      {models.length === 0 ? (
                        // Show message when provider has no available models
                        <></>
                      ) : (
                        models.map((searchableModel) => {
                          const isSelected =
                            selectedModel?.id === searchableModel.model.id &&
                            selectedProvider ===
                              searchableModel.provider.provider
                          const capabilities =
                            searchableModel.model.capabilities || []

                          return (
                            <div
                              key={searchableModel.value}
                              onClick={() => handleSelect(searchableModel)}
                              className={cn(
                                'mx-1 mb-1 cursor-pointer flex items-center gap-2 transition-all duration-200',
                                useCursorStyleSelector
                                  ? 'rounded-md px-2 py-1.5 hover:bg-secondary/60'
                                  : 'rounded-sm px-2 py-1.5 hover:bg-secondary/40',
                                isSelected &&
                                  (useCursorStyleSelector
                                    ? 'bg-secondary/70 hover:bg-secondary/70'
                                    : 'bg-primary/15 hover:bg-primary/15 ring-1 ring-primary/40')
                              )}
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-sm truncate">
                                      {getModelDisplayName(
                                        searchableModel.model
                                      )}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {searchableModel.model.id}
                                  </TooltipContent>
                                </Tooltip>
                                <div className="flex-1"></div>
                                {!useCursorStyleSelector &&
                                  capabilities.length > 0 && (
                                  <div className="shrink-0 -mr-1.5">
                                    <Capabilities capabilities={capabilities} />
                                  </div>
                                )}
                                {showReasoning && !useCursorStyleSelector && (
                                  <ModelReasoningDropdown
                                    model={searchableModel.model}
                                    providerName={
                                      searchableModel.provider.provider
                                    }
                                    variant="row"
                                  />
                                )}
                                {useCursorStyleSelector && isSelected && (
                                  <>
                                    <button
                                      type="button"
                                      className="rounded-sm px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                                      onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        setSettingsModelValue((value) =>
                                          value === searchableModel.value
                                            ? null
                                            : searchableModel.value
                                        )
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <Check className="size-4 shrink-0 text-foreground" />
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  )
                })}
                {useCursorStyleSelector && !searchValue && (
                  <button
                    type="button"
                    className="mt-1 flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => {
                      navigate({ to: route.hub.index })
                      setOpen(false)
                    }}
                  >
                    <Plus className="size-4" />
                    <span>Add Models</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {!useCursorStyleSelector &&
            showReasoning &&
            selectedModel?.id &&
            selectedProvider &&
            modelSupportsReasoningControl(selectedModel) && (
            <div className="border-t px-3 py-2.5">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
                {getModelReasoningSetting(selectedModel)?.title ??
                  t('common:reasoning')}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-foreground">
                  {getModelDisplayName(selectedModel)}
                </span>
                <ModelReasoningDropdown
                  model={selectedModel}
                  providerName={selectedProvider}
                  variant="panel"
                />
              </div>
            </div>
          )}
          </div>

          {useCursorStyleSelector && settingsModelValue && panelModelItem && (
            <div className="absolute bottom-0 left-full z-50 ml-2 w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                  <div className="border-b px-2 py-2">
                    <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
                      Context
                    </div>
                    <div className="space-y-0.5">
                      {panelContextOptions.map((contextValue) => {
                        const isActive = panelContextValue === contextValue

                        return (
                          <button
                            key={contextValue}
                            type="button"
                            className={cn(
                              'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary/60',
                              isActive && 'text-foreground'
                            )}
                            onClick={(event) => {
                              event.stopPropagation()
                              handleContextSelect(panelModelItem, contextValue)
                            }}
                          >
                            <span>{formatContextSize(contextValue)}</span>
                            {isActive && <Check className="size-4" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="border-b px-3 py-2.5">
                    <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
                      {panelReasoningTitle}
                    </div>
                    {panelReasoningOptions.length > 0 ? (
                      <div className="space-y-0.5">
                        {panelReasoningOptions.map((option) => {
                          const isActive = panelReasoningValue === option.value

                          return (
                            <button
                              key={String(option.value)}
                              type="button"
                              className={cn(
                                'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary/60',
                                isActive && 'text-foreground'
                              )}
                              onClick={(event) => {
                                event.stopPropagation()
                                handleReasoningSelect(panelModelItem, option.value)
                              }}
                            >
                              <span>{option.label}</span>
                              {isActive && <Check className="size-4" />}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        Not available
                      </div>
                    )}
                  </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
})

export default DropdownModelProvider
