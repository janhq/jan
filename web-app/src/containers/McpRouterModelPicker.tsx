import { useMemo, useRef, useState, useCallback } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn, getModelDisplayName, isLocalProvider } from '@/lib/utils'
import { IconChevronDown, IconX } from '@tabler/icons-react'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import Capabilities from '@/containers/Capabilities'
import { isRouterModelSelectable } from '@/lib/mcp-router-model-filter'

type Entry = {
  model: Model
  providerName: string
  isLocal: boolean
  hasApiKey: boolean
}

export type McpRouterModelPickerProps = {
  /** Optional label for the trigger control (accessibility). */
  ariaLabel?: string
  providers: ModelProvider[]
  selectedProvider: string
  selectedModelId: string
  disabled?: boolean
  onSelect: (provider: string, modelId: string) => void
  placeholder: string
  searchPlaceholder: string
  emptyListMessage: string
  /** Called with trimmed search text when the filter returns no rows. */
  formatEmptySearch: (query: string) => string
}

export function McpRouterModelPicker({
  ariaLabel,
  providers,
  selectedProvider,
  selectedModelId,
  disabled = false,
  onSelect,
  placeholder,
  searchPlaceholder,
  emptyListMessage,
  formatEmptySearch,
}: McpRouterModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const availableModels = useMemo((): Entry[] => {
    return providers
      .filter((p) => p.active)
      .flatMap((p) =>
        p.models
          .filter((m) => isRouterModelSelectable(p, m))
          .map((m) => ({
            model: m,
            providerName: p.provider,
            isLocal: isLocalProvider(p.provider),
            hasApiKey: !!p.api_key?.length,
          }))
      )
  }, [providers])

  const filteredModels = useMemo(() => {
    if (!searchValue.trim()) return availableModels
    const search = searchValue.toLowerCase()
    return availableModels.filter(
      (e) =>
        e.model.id.toLowerCase().includes(search) ||
        (e.model.displayName?.toLowerCase() ?? '').includes(search) ||
        e.providerName.toLowerCase().includes(search)
    )
  }, [availableModels, searchValue])

  const groupedModels = useMemo(() => {
    const groups: Record<string, Entry[]> = {}
    filteredModels.forEach((e) => {
      if (!groups[e.providerName]) groups[e.providerName] = []
      groups[e.providerName].push(e)
    })
    return groups
  }, [filteredModels])

  const current = useMemo(() => {
    if (!selectedModelId || !selectedProvider) return undefined
    return availableModels.find(
      (e) =>
        e.providerName === selectedProvider && e.model.id === selectedModelId
    )
  }, [availableModels, selectedProvider, selectedModelId])

  const handleSelect = useCallback(
    (entry: Entry) => {
      onSelect(entry.providerName, entry.model.id)
      setOpen(false)
      setSearchValue('')
    },
    [onSelect]
  )

  const handleOpenChange = useCallback((isOpen: boolean) => {
    setOpen(isOpen)
    if (!isOpen) {
      setSearchValue('')
    } else {
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }, [])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
          className="max-w-[min(100%,320px)] justify-between"
        >
          <span className="flex items-center gap-2 truncate leading-normal">
            {current ? (
              <>
                <span
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-full shrink-0',
                    current.isLocal
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-blue-500/10 text-blue-600'
                  )}
                >
                  {current.providerName}
                </span>
                <span className="truncate" title={current.model.id}>
                  {getModelDisplayName(current.model)}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[min(100vw-2rem,320px)] p-0 bg-background/95 border"
        align="end"
        sideOffset={8}
      >
        <div className="flex flex-col size-full">
          <div className="relative p-2 border-b">
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={searchPlaceholder}
              className="text-sm font-normal outline-0 w-full bg-transparent"
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
            {Object.keys(groupedModels).length === 0 ? (
              <div className="py-3 px-4 text-sm text-muted-foreground">
                {searchValue.trim()
                  ? formatEmptySearch(searchValue.trim())
                  : emptyListMessage}
              </div>
            ) : (
              <div className="py-1">
                {Object.entries(groupedModels).map(([providerKey, entries]) => {
                  const providerInfo = providers.find(
                    (p) => p.provider === providerKey
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

                      {entries.map((e) => {
                        const isSelected =
                          selectedModelId === e.model.id &&
                          selectedProvider === e.providerName
                        const capabilities = e.model.capabilities || []

                        return (
                          <div
                            key={`${e.providerName}:${e.model.id}`}
                            title={e.model.id}
                            onClick={() => handleSelect(e)}
                            className={cn(
                              'mx-1 mb-1 px-2 py-1.5 rounded-sm cursor-pointer flex items-center gap-2 transition-all duration-200',
                              'hover:bg-secondary/40',
                              isSelected &&
                                'bg-secondary/60 hover:bg-secondary/60'
                            )}
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span
                                className="text-sm truncate"
                                title={e.model.id}
                              >
                                {getModelDisplayName(e.model)}
                              </span>
                              <div className="flex-1" />
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
