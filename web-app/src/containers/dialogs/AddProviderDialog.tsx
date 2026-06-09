import { useState, useRef } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { useModelProvider } from '@/hooks/useModelProvider'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { getProviderTitle, cn } from '@/lib/utils'
import { IconSearch } from '@tabler/icons-react'

interface AddProviderDialogProps {
  onCreateProvider: (
    name: string,
    baseUrl: string,
    apiKey: string,
    apiType: ProviderApiType
  ) => void
  children: React.ReactNode
}

const URL_PATTERN = /^https?:\/\/[^\s]+$/i

export function AddProviderDialog({
  onCreateProvider,
  children,
}: AddProviderDialogProps) {
  const { t } = useTranslation()
  const { providers, updateProvider } = useModelProvider()

  // Tab state: 'toggles' or 'manual'
  const [activeTab, setActiveTab] = useState<'toggles' | 'manual'>('toggles')

  // Search state for toggles list
  const [searchQuery, setSearchQuery] = useState('')

  // Manual creation form state
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiType, setApiType] = useState<ProviderApiType>('openai')
  const [error, setError] = useState<string | null>(null)

  const [isOpen, setIsOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setName('')
    setBaseUrl('')
    setApiKey('')
    setApiType('openai')
    setError(null)
    setSearchQuery('')
    setActiveTab('toggles')
  }

  const handleCreate = () => {
    const trimmedName = name.trim()
    const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
    const trimmedApiKey = apiKey.trim()
    if (!trimmedName || !trimmedBaseUrl || !trimmedApiKey) return
    if (!URL_PATTERN.test(trimmedBaseUrl)) {
      setError(t('provider:invalidBaseUrl'))
      return
    }
    onCreateProvider(trimmedName, trimmedBaseUrl, trimmedApiKey, apiType)
    reset()
    setIsOpen(false)
  }

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) reset()
  }

  const canSubmit =
    name.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
    apiKey.trim().length > 0

  const baseUrlPlaceholder =
    apiType === 'anthropic'
      ? t('provider:baseUrlPlaceholderAnthropic')
      : t('provider:baseUrlPlaceholder')

  // Filter providers to display (apply platform restrictions like MLX on macOS only)
  const displayedProviders = providers.filter((p) => {
    if (!IS_MACOS && p.provider === 'mlx') return false
    return true
  })

  // Filter by search query
  const filteredProviders = displayedProviders.filter((p) =>
    getProviderTitle(p.provider).toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleRowClick = (providerName: string, currentlyActive: boolean) => {
    updateProvider(providerName, { active: !currentlyActive })
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="sm:max-w-[460px] max-w-[90vw]"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          if (activeTab === 'toggles') {
            searchInputRef.current?.focus()
          } else {
            nameInputRef.current?.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('common:modelProviders')}</DialogTitle>
        </DialogHeader>

        {/* Tab selection buttons */}
        <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg mb-2">
          <button
            onClick={() => {
              setActiveTab('toggles')
              setError(null)
              setTimeout(() => searchInputRef.current?.focus(), 50)
            }}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex-1 justify-center cursor-pointer',
              activeTab === 'toggles'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Model Providers
          </button>
          <button
            onClick={() => {
              setActiveTab('manual')
              setTimeout(() => nameInputRef.current?.focus(), 50)
            }}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex-1 justify-center cursor-pointer',
              activeTab === 'manual'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Add Manual
          </button>
        </div>

        <div className="flex flex-col gap-3 mt-1">
          {activeTab === 'toggles' ? (
            <div className="flex flex-col gap-3">
              {/* Search bar */}
              <div className="relative flex items-center">
                <IconSearch className="absolute left-3 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search model providers..."
                  className="pl-9 h-9 text-sm focus-visible:ring-1"
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>

              {/* Scrollable Toggle list */}
              <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto pr-1 select-none">
                {filteredProviders.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No providers found
                  </div>
                ) : (
                  filteredProviders.map((p) => {
                    const title = getProviderTitle(p.provider)
                    return (
                      <div
                        key={p.provider}
                        className="flex items-center justify-between p-2 hover:bg-secondary/40 rounded-lg transition-colors group cursor-pointer"
                        onClick={() => handleRowClick(p.provider, p.active)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="size-8 rounded-full border bg-background flex items-center justify-center shrink-0">
                            <ProvidersAvatar provider={p} />
                          </div>
                          <span className="font-medium text-sm text-foreground truncate">
                            {title}
                          </span>
                        </div>
                        <div onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={p.active}
                            onCheckedChange={(checked) => {
                              updateProvider(p.provider, { active: checked })
                            }}
                          />
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Input
                ref={nameInputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('provider:enterNameForProvider')}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground font-semibold">
                  {t('provider:apiTypeLabel')}
                </label>
                <RadioGroup
                  value={apiType}
                  onValueChange={(v) => setApiType(v as ProviderApiType)}
                  className="flex flex-row gap-4"
                >
                  <label className="flex items-center gap-2 text-sm cursor-pointer text-foreground">
                    <RadioGroupItem value="openai" />
                    {t('provider:apiTypeOpenAI')}
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer text-foreground">
                    <RadioGroupItem value="anthropic" />
                    {t('provider:apiTypeAnthropic')}
                  </label>
                </RadioGroup>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-semibold">
                  {t('provider:baseUrlLabel')}
                </label>
                <Input
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value)
                    if (error) setError(null)
                  }}
                  placeholder={baseUrlPlaceholder}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-semibold">
                  {t('provider:apiKeyLabel')}
                </label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t('provider:apiKeyPlaceholder')}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter' && canSubmit) {
                      e.preventDefault()
                      handleCreate()
                    }
                  }}
                />
              </div>
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-2">
          {activeTab === 'toggles' ? (
            <DialogClose asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
              >
                Close
              </Button>
            </DialogClose>
          ) : (
            <>
              <Button
                variant="link"
                size="sm"
                className="hover:no-underline w-full sm:w-auto text-muted-foreground"
                onClick={() => setActiveTab('toggles')}
              >
                {t('common:cancel')}
              </Button>
              <Button
                disabled={!canSubmit}
                onClick={handleCreate}
                className="w-full sm:w-auto"
                size="sm"
                aria-label={t('common:create')}
              >
                {t('common:create')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
