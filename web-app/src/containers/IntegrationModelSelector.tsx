import { useMemo, useRef, useState } from 'react'
import { IconCheck, IconChevronDown, IconX } from '@tabler/icons-react'

import Capabilities from '@/containers/Capabilities'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn, formatBytes, getModelDisplayName, isLocalProvider } from '@/lib/utils'

type SelectableModel = Model & {
  providerName: string
  isLocal: boolean
  hasApiKey: boolean
  provider: ModelProvider
}

export default function IntegrationModelSelector({
  providers,
  selectedModel,
  onSelect,
  placeholder = 'Select a model',
  allowEmptyOption = false,
  emptyOptionLabel = 'Use current selected Jan model',
  filterModel,
  showSize = false,
}: {
  providers: ModelProvider[]
  selectedModel: string | null
  onSelect: (modelId: string | null) => void
  placeholder?: string
  allowEmptyOption?: boolean
  emptyOptionLabel?: string
  filterModel?: (model: SelectableModel) => boolean
  showSize?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const availableModels = useMemo(() => {
    const models = providers
      .filter((provider) => provider.active)
      .flatMap((provider) =>
        provider.models.map((model) => ({
          ...model,
          providerName: provider.provider,
          isLocal: isLocalProvider(provider.provider),
          hasApiKey: !!provider.api_key?.length,
          provider,
        }))
      )

    return filterModel ? models.filter(filterModel) : models
  }, [filterModel, providers])

  const filteredModels = useMemo(() => {
    if (!searchValue.trim()) return availableModels
    const search = searchValue.toLowerCase()

    return availableModels.filter(
      (model) =>
        model.id.toLowerCase().includes(search) ||
        getModelDisplayName(model as never).toLowerCase().includes(search) ||
        model.providerName.toLowerCase().includes(search)
    )
  }, [availableModels, searchValue])

  const groupedModels = useMemo(() => {
    const groups: Record<string, typeof filteredModels> = {}
    filteredModels.forEach((model) => {
      if (!groups[model.providerName]) {
        groups[model.providerName] = []
      }
      groups[model.providerName].push(model)
    })
    return groups
  }, [filteredModels])

  const currentModel = availableModels.find((model) => model.id === selectedModel)

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (!isOpen) {
      setSearchValue('')
    } else {
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }

  const selectModel = (modelId: string | null) => {
    onSelect(modelId)
    setOpen(false)
    setSearchValue('')
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[280px]">
          <span className="flex items-center gap-2 truncate leading-normal">
            {selectedModel && currentModel ? (
              <>
                <span
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-full shrink-0',
                    currentModel.isLocal
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-blue-500/10 text-blue-600'
                  )}
                >
                  {currentModel.isLocal ? 'Local' : 'Remote'}
                </span>
                <span>{getModelDisplayName(currentModel as never)}</span>
              </>
            ) : (
              placeholder
            )}
          </span>
          <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[280px] p-0 bg-background/95 border"
        align="end"
        sideOffset={8}
      >
        <div className="flex flex-col size-full">
          <div className="relative p-2 border-b">
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search models..."
              className="text-sm font-normal outline-0 w-full"
            />
            {searchValue.length > 0 && (
              <div className="absolute right-2 top-0 bottom-0 flex items-center justify-center">
                <IconX
                  size={16}
                  className="text-muted-foreground cursor-pointer"
                  onClick={() => setSearchValue('')}
                />
              </div>
            )}
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {Object.keys(groupedModels).length === 0 && searchValue ? (
              <div className="py-3 px-4 text-sm text-muted-foreground">
                No models found for &quot;{searchValue}&quot;
              </div>
            ) : (
              <div className="py-1">
                {allowEmptyOption && (
                  <div className="bg-secondary/30 rounded-sm my-1.5 mx-1.5 first:mt-1 py-1">
                    <div
                      className={cn(
                        'mx-1 mb-1 px-2 py-1.5 rounded-sm cursor-pointer flex items-center gap-2 transition-all duration-200',
                        'hover:bg-secondary/40',
                        !selectedModel && 'bg-secondary/60 hover:bg-secondary/60'
                      )}
                      onClick={() => selectModel(null)}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-sm truncate" title={emptyOptionLabel}>
                          {emptyOptionLabel}
                        </span>
                      </div>
                      {!selectedModel && (
                        <IconCheck size={16} className="shrink-0 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                )}

                {Object.entries(groupedModels).map(([providerKey, models]) => {
                  const providerInfo = providers.find(
                    (provider) => provider.provider === providerKey
                  )
                  if (!providerInfo) return null

                  return (
                    <div
                      key={providerKey}
                      className="bg-secondary/30 rounded-sm my-1.5 mx-1.5 first:mt-1 py-1"
                    >
                      <div className="flex items-center gap-1.5 px-2 py-1">
                        <ProvidersAvatar provider={providerInfo} />
                        <span className="capitalize text-sm font-medium text-muted-foreground">
                          {providerKey}
                        </span>
                      </div>

                      {models.map((model) => {
                        const isSelected = selectedModel === model.id
                        const capabilities = model.capabilities || []

                        return (
                          <div
                            key={model.id}
                            title={model.id}
                            onClick={() => selectModel(model.id)}
                            className={cn(
                              'mx-1 mb-1 px-2 py-1.5 rounded-sm cursor-pointer flex items-center gap-2 transition-all duration-200',
                              'hover:bg-secondary/40',
                              isSelected && 'bg-secondary/60 hover:bg-secondary/60'
                            )}
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-sm truncate" title={model.id}>
                                {getModelDisplayName(model as never)}
                              </span>
                              {showSize && typeof model.size === 'number' && (
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {formatBytes(model.size)}
                                </span>
                              )}
                              <div className="flex-1"></div>
                              {capabilities.length > 0 && (
                                <div className="shrink-0 -mr-1.5">
                                  <Capabilities capabilities={capabilities} />
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
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