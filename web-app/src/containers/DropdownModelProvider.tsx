/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
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
import { useServiceHub } from '@/hooks/useServiceHub'
import { getLastUsedModel } from '@/utils/getModelToStart'

type DropdownModelProviderProps = {
  model?: ThreadModel
  useLastUsedModel?: boolean
}

interface SearchableModel {
  provider: ModelProvider
  model: Model
  searchStr: string
  value: string
  highlightedId?: string
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

const DropdownModelProvider = ({
  model,
  useLastUsedModel = false,
}: DropdownModelProviderProps) => {
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
        // Try to use last used model only when explicitly requested (for new chat)
        const lastUsed = getLastUsedModel()
        if (lastUsed && checkModelExists(lastUsed.provider, lastUsed.model)) {
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
          const llamacppProvider = providers.find(
            (p) => p.provider === 'llamacpp' && p.active && p.models.length > 0
          )
          if (llamacppProvider && llamacppProvider.models.length > 0) {
            const firstModel = llamacppProvider.models[0]
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
    const items: SearchableModel[] = []

    providers.forEach((provider) => {
      if (!provider.active) return

      provider.models.forEach((modelItem) => {
        // Skip embedding models - they can't be used for chat
        if (modelItem.embedding) return

        // Skip models that require API key but don't have one (except llamacpp)
        if (
          provider &&
          predefinedProviders.some((e) =>
            e.provider.includes(provider.provider)
          ) &&
          provider.provider !== 'llamacpp' &&
          !provider.api_key?.length
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
  }, [providers])

  // Create Fzf instance for fuzzy search
  const fzfInstance = useMemo(() => {
    return new Fzf(searchableItems, {
      selector: (item) =>
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
  const filteredItems = useMemo(() => {
    if (!searchValue) return searchableItems

    return fzfInstance.find(searchValue.toLowerCase()).map((result) => {
      const item = result.item
      const positions = Array.from(result.positions) || []
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

  // Group filtered items by provider, excluding favorites when not searching
  const groupedItems = useMemo(() => {
    const groups: Record<string, SearchableModel[]> = {}

    if (!searchValue) {
      // When not searching, show all active providers (even without models)
      providers.forEach((provider) => {
        if (provider.active) {
          groups[provider.provider] = []
        }
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

  const handleSelect = useCallback(
    async (searchableModel: SearchableModel) => {
      // Immediately update display to prevent double-click issues
      setDisplayModel(getModelDisplayName(searchableModel.model))
      setSearchValue('')
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

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <div className="bg-main-view-fg/5 hover:bg-main-view-fg/8 px-2 py-1 flex items-center gap-1.5 rounded-sm">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="font-medium cursor-pointer flex items-center gap-1.5 relative z-20 max-w-50"
          >
            {provider && (
              <div className="shrink-0">
                <ProvidersAvatar provider={provider} />
              </div>
            )}
            <span
              className={cn(
                'text-main-view-fg/80 truncate leading-normal',
                !selectedModel?.id && 'text-main-view-fg/50'
              )}
            >
              {displayModel}
            </span>
          </button>
        </PopoverTrigger>
        {currentModel?.settings &&
          provider &&
          provider.provider === 'llamacpp' && (
            <ModelSetting
              model={currentModel as Model}
              provider={provider}
              smallIcon
            />
          )}
        <ModelSupportStatus
          modelId={selectedModel?.id}
          provider={selectedProvider}
          contextSize={getContextSize()}
          className="ml-0.5 flex-shrink-0"
        />
      </div>

      <PopoverContent
        className={cn(
          'w-60 p-0 backdrop-blur-2xl',
          searchValue.length === 0 && 'h-[320px]'
        )}
        align="start"
        sideOffset={10}
        alignOffset={-8}
        side={searchValue.length === 0 ? undefined : 'top'}
        avoidCollisions={searchValue.length === 0 ? true : false}
      >
        <div className="flex flex-col w-full h-full">
          {/* Search input */}
          <div className="relative px-2 py-1.5 border-b border-main-view-fg/10 backdrop-blur-4xl">
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={t('common:searchModels')}
              className="text-sm font-normal outline-0"
            />
            {searchValue.length > 0 && (
              <div className="absolute right-2 top-0 bottom-0 flex items-center justify-center">
                <IconX
                  size={16}
                  className="text-main-view-fg/50 hover:text-main-view-fg cursor-pointer"
                  onClick={onClearSearch}
                />
              </div>
            )}
          </div>

          {/* Model list */}
          <div className="max-h-[320px] overflow-y-auto">
            {Object.keys(groupedItems).length === 0 && searchValue ? (
              <div className="py-3 px-4 text-sm text-main-view-fg/60">
                {t('common:noModelsFoundFor', { searchValue })}
              </div>
            ) : (
              <div className="py-1">
                {/* Favorites section - only show when not searching */}
                {!searchValue && favoriteItems.length > 0 && (
                  <div className="bg-main-view-fg/2 backdrop-blur-2xl rounded-sm my-1.5 mx-1.5">
                    {/* Favorites header */}
                    <div className="flex items-center gap-1.5 px-2 py-1">
                      <span className="text-sm font-medium text-main-view-fg/80">
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
                          title={searchableModel.model.id}
                          onClick={() => handleSelect(searchableModel)}
                          className={cn(
                            'mx-1 mb-1 px-2 py-1.5 rounded-sm cursor-pointer flex items-center gap-2 transition-all duration-200',
                            'hover:bg-main-view-fg/4',
                            isSelected &&
                              'bg-main-view-fg/8 hover:bg-main-view-fg/8'
                          )}
                        >
                          <div className="flex items-center gap-1 flex-1 min-w-0">
                            <div className="shrink-0 -ml-1">
                              <ProvidersAvatar
                                provider={searchableModel.provider}
                              />
                            </div>
                            <span className="text-main-view-fg/80 text-sm">
                              {getModelDisplayName(searchableModel.model)}
                            </span>
                            <div className="flex-1"></div>
                            {capabilities.length > 0 && (
                              <div className="flex-shrink-0 -mr-1.5">
                                <Capabilities capabilities={capabilities} />
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Divider between favorites and regular providers */}
                {favoriteItems.length > 0 && (
                  <div className="border-b border-1 border-main-view-fg/8 mx-2"></div>
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
                      className="bg-main-view-fg/2 backdrop-blur-2xl first:mt-0 rounded-sm my-1.5 mx-1.5 first:mb-0"
                    >
                      {/* Provider header */}
                      <div className="flex items-center justify-between px-2 py-1">
                        <div className="flex items-center gap-1.5">
                          <ProvidersAvatar provider={providerInfo} />
                          <span className="capitalize text-sm font-medium text-main-view-fg/80">
                            {getProviderTitle(providerInfo.provider)}
                          </span>
                        </div>

                        <div
                          className="size-6 cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate({
                              to: route.settings.providers,
                              params: { providerName: providerInfo.provider },
                            })
                            setOpen(false)
                          }}
                        >
                          <IconSettings
                            size={16}
                            className="text-main-view-fg/50"
                          />
                        </div>
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
                              title={searchableModel.model.id}
                              onClick={() => handleSelect(searchableModel)}
                              className={cn(
                                'mx-1 mb-1 px-2 py-1.5 rounded-sm cursor-pointer flex items-center gap-2 transition-all duration-200',
                                'hover:bg-main-view-fg/4',
                                isSelected &&
                                  'bg-main-view-fg/8 hover:bg-main-view-fg/8'
                              )}
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span
                                  className="text-main-view-fg/80 text-sm"
                                  title={searchableModel.model.id}
                                >
                                  {getModelDisplayName(searchableModel.model)}
                                </span>
                                <div className="flex-1"></div>
                                {capabilities.length > 0 && (
                                  <div className="flex-shrink-0 -mr-1.5">
                                    <Capabilities capabilities={capabilities} />
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default DropdownModelProvider
