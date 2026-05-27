import { useMemo } from 'react'
import {
  IconAdjustmentsHorizontal,
  IconChevronDown,
  IconSettings,
  IconUser,
} from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'

import { route } from '@/constants/routes'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { AssistantsMenu } from '@/components/AssistantsMenu'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { ParametersSection } from '@/containers/ParametersSection'
import { useAssistant } from '@/hooks/useAssistant'
import { useModelProvider } from '@/hooks/useModelProvider'
import { paramsSettings, type ParamDef } from '@/lib/predefinedParams'
import { isPredefinedRemoteProvider } from '@/lib/providerCaps'
import { cn } from '@/lib/utils'

interface SamplerPopoverProps {
  /** Provider ID of the currently-selected model, if any. Used to scope the
   *  chip palette to a single provider's capabilities. */
  providerId?: string
  /** Currently-selected model ID. Drives model-family rejection (e.g. o1/gpt-5
   *  reasoning models reject temperature/top_p). */
  modelId?: string
  /** Optional assistant switcher. When omitted, the header shows the active
   *  assistant name as static text. */
  assistantSwitcher?: {
    assistants: Assistant[]
    currentThread: Thread | undefined
    selectedAssistantId: string | undefined
    setSelectedAssistantId: (id: string) => void
    updateCurrentThreadAssistant: (assistant: Assistant) => void
  }
}

export function SamplerPopover({
  providerId,
  modelId,
  assistantSwitcher,
}: SamplerPopoverProps) {
  const currentAssistant = useAssistant((s) => s.currentAssistant)
  const updateAssistant = useAssistant((s) => s.updateAssistant)
  const assistantsLoading = useAssistant((s) => s.loading)
  const providers = useModelProvider((s) => s.providers)

  const scopedProviders = useMemo(() => {
    if (providerId) {
      const p = providers.find((x) => x.provider === providerId)
      return p ? [p] : []
    }
    return providers.filter((p) => p.active)
  }, [providers, providerId])

  const params = currentAssistant?.parameters ?? {}
  const samplerKeys = Object.keys(params).filter((k) => k in paramsSettings)
  const hasOverrides = samplerKeys.length > 0

  const writeParams = (next: Record<string, unknown>) => {
    if (!currentAssistant) return
    updateAssistant({ ...currentAssistant, parameters: next })
  }

  const handleToggle = (def: ParamDef) => {
    if (def.key in params) {
      const next = { ...params }
      delete next[def.key]
      writeParams(next)
    } else {
      writeParams({ ...params, [def.key]: def.value })
    }
  }

  const handleChange = (key: string, value: unknown) => {
    writeParams({ ...params, [key]: value })
  }

  const handleRemove = (key: string) => {
    const next = { ...params }
    delete next[key]
    writeParams(next)
  }

  const handleAddMany = (values: Record<string, unknown>) => {
    writeParams({ ...params, ...values })
  }

  const handleRemoveMany = (keys: string[]) => {
    const next = { ...params }
    for (const k of keys) delete next[k]
    writeParams(next)
  }

  const handleResetAll = () => {
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(params)) {
      if (!(k in paramsSettings)) next[k] = v
    }
    writeParams(next)
  }

  if (isPredefinedRemoteProvider(providerId)) return null

  const triggerLabel = assistantsLoading
    ? 'Loading assistant…'
    : currentAssistant
      ? `Sampling — ${currentAssistant.name}`
      : 'Sampling'

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Sampling parameters"
              className="relative"
              disabled={assistantsLoading}
            >
              <IconAdjustmentsHorizontal
                size={18}
                className={cn(
                  'text-muted-foreground',
                  hasOverrides && 'text-primary'
                )}
              />
              {hasOverrides && (
                <span
                  aria-hidden
                  className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
                />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>{triggerLabel}</p>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        avoidCollisions
        className="w-[380px] p-0 flex flex-col max-h-[var(--radix-popover-content-available-height)]"
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b">
          <AssistantHeader
            currentAssistant={currentAssistant}
            assistantSwitcher={assistantSwitcher}
          />
          <div className="flex items-center gap-1 shrink-0">
            {hasOverrides && (
              <Button variant="ghost" size="sm" onClick={handleResetAll}>
                Reset all
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" asChild>
                  <Link to={route.settings.assistant}>
                    <IconSettings size={16} className="text-muted-foreground" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Open assistant settings</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        {currentAssistant ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            <ParametersSection
              params={params}
              providers={scopedProviders}
              providerId={providerId}
              modelId={modelId}
              onToggle={handleToggle}
              onChange={handleChange}
              onRemove={handleRemove}
              onAddMany={handleAddMany}
              onRemoveMany={handleRemoveMany}
            />
          </div>
        ) : (
          <div className="text-xs text-muted-foreground px-4 py-3">
            Pick an assistant above to configure sampling.
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface AssistantHeaderProps {
  currentAssistant: Assistant | undefined
  assistantSwitcher: SamplerPopoverProps['assistantSwitcher']
}

function AssistantHeader({
  currentAssistant,
  assistantSwitcher,
}: AssistantHeaderProps) {
  const label = (
    <span className="flex items-center gap-1.5 min-w-0">
      {currentAssistant?.avatar ? (
        <AvatarEmoji
          avatar={currentAssistant.avatar}
          imageClassName="size-4 object-contain"
          textClassName="text-sm"
        />
      ) : (
        <IconUser size={14} className="text-muted-foreground" />
      )}
      <span className="text-sm font-medium truncate">
        {currentAssistant?.name ?? 'No assistant'}
      </span>
    </span>
  )

  if (!assistantSwitcher) {
    return <div className="flex items-center gap-1 min-w-0">{label}</div>
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 px-2 gap-1 min-w-0"
        >
          {label}
          <IconChevronDown size={14} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-64 overflow-y-auto"
      >
        <AssistantsMenu
          selectedAssistant={assistantSwitcher.selectedAssistantId}
          setSelectedAssistant={assistantSwitcher.setSelectedAssistantId}
          currentThread={assistantSwitcher.currentThread}
          updateCurrentThreadAssistant={
            assistantSwitcher.updateCurrentThreadAssistant
          }
          assistants={assistantSwitcher.assistants}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
