import { useMemo } from 'react'
import {
  IconAdjustmentsHorizontal,
  IconChevronDown,
} from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { ParametersSection } from '@/containers/ParametersSection'
import { paramGroups } from '@/lib/predefinedParams'
import { useAssistant } from '@/hooks/useAssistant'
import { useSamplingSettings } from '@/hooks/useSamplingSettings'
import { useThreads } from '@/hooks/useThreads'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

interface SamplerPopoverProps {
  disabled?: boolean
}

export function SamplerPopover({ disabled }: SamplerPopoverProps) {
  const { t } = useTranslation()

  const assistants = useAssistant((state) => state.assistants)
  const defaultAssistantId = useAssistant((state) => state.defaultAssistantId)
  const selectedAssistant = useAssistant((state) => state.pendingAssistant)
  const onSelectAssistant = useAssistant((state) => state.setPendingAssistant)

  const samplingParams = useSamplingSettings((state) => state.params)
  const setParam = useSamplingSettings((state) => state.setParam)

  const currentThreadId = useThreads((state) => state.currentThreadId)
  const threads = useThreads((state) => state.threads)
  const updateCurrentThreadAssistant = useThreads(
    (state) => state.updateCurrentThreadAssistant
  )

  const currentThread = currentThreadId ? threads[currentThreadId] : undefined
  const threadAssistant = currentThread?.assistants?.[0]

  // The assistant shown/selected in the switcher (persona only — no sampling).
  // Priority: explicit unsaved-chat selection -> thread-bound -> default -> first.
  const effectiveAssistant = useMemo<Assistant | undefined>(() => {
    return (
      selectedAssistant ??
      threadAssistant ??
      assistants.find((a) => a.id === defaultAssistantId) ??
      assistants[0]
    )
  }, [selectedAssistant, threadAssistant, assistants, defaultAssistantId])

  const activeAssistant = effectiveAssistant

  const handleSamplingChange = (key: string, value: number | boolean) => {
    setParam(key, value)
  }

  const handleSelectAssistant = (assistant: Assistant | undefined) => {
    onSelectAssistant(assistant)
    if (currentThreadId) {
      updateCurrentThreadAssistant(assistant as unknown as Assistant)
    }
  }

  const samplingLabel = t('assistants:paramCategory.sampling')

  // Surface only sampling + penalties (exclude the General group, e.g. Stream).
  const popoverParamKeys = [...paramGroups.sampling, ...paramGroups.penalties]

  return (
    <Popover>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                aria-label={samplingLabel}
              >
                <IconAdjustmentsHorizontal
                  size={18}
                  className="text-muted-foreground"
                />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>{samplingLabel}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        avoidCollisions={false}
        collisionPadding={12}
        className="w-64 max-h-[min(16rem,70vh)] overflow-y-auto bg-background/95 backdrop-blur-2xl p-3"
      >
        <div className="space-y-2">
          {/* Header: assistant switcher (persona only) */}
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide">
              {t('assistants:title')}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between gap-2 h-7 bg-secondary/30 border-secondary"
                >
                  <span className="flex items-center gap-2 truncate">
                    {activeAssistant ? (
                      <AvatarEmoji
                        avatar={activeAssistant.avatar}
                        imageClassName="size-4 object-contain"
                        textClassName="text-sm"
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    <span className="truncate">
                      {activeAssistant?.name ?? t('assistants:none')}
                    </span>
                  </span>
                  <IconChevronDown size={14} className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-(--radix-dropdown-menu-trigger-width) max-h-64 overflow-y-auto"
              >
                <DropdownMenuItem
                  className={!activeAssistant ? 'bg-accent' : ''}
                  onClick={() => handleSelectAssistant(undefined)}
                >
                  <span className="text-muted-foreground">—</span>
                  <span>{t('assistants:none')}</span>
                </DropdownMenuItem>
                {assistants.length > 0 ? (
                  assistants.map((assistant) => (
                    <DropdownMenuItem
                      key={assistant.id}
                      className={
                        activeAssistant?.id === assistant.id ? 'bg-accent' : ''
                      }
                      onClick={() => handleSelectAssistant(assistant)}
                    >
                      <AvatarEmoji
                        avatar={assistant.avatar}
                        imageClassName="size-4 object-contain"
                        textClassName="text-sm"
                      />
                      <span className="truncate">
                        {assistant.name || t('assistants:none')}
                      </span>
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>
                    <span className="text-muted-foreground">
                      {t('assistants:noAssistants')}
                    </span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Body: global sampling parameters */}
          <ParametersSection
            parameters={samplingParams}
            onChange={handleSamplingChange}
            paramKeys={popoverParamKeys}
            className={cn(disabled && 'pointer-events-none opacity-50')}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
