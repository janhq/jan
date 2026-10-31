import { useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ParametersSection } from '@/containers/ParametersSection'
import { useAssistant } from '@/hooks/useAssistant'
import { useThreads } from '@/hooks/useThreads'
import { useModelProvider } from '@/hooks/useModelProvider'
import { paramsSettings, type ParamDef } from '@/lib/predefinedParams'
import { isPredefinedRemoteProvider } from '@/lib/providerCaps'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface SamplerPopoverProps {
  /** Provider ID of the currently-selected model, if any. Used to scope the
   *  chip palette to a single provider's capabilities. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>
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
  open,
  onOpenChange,
  hideTrigger = false,
  returnFocusRef,
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

  // The header must match the switcher's checkmark in every context:
  //  - inside a thread: the thread's assigned assistant, including "None"
  //    (model-only) which must NOT fall back to the global default;
  //  - off-thread with a switcher (home screen): the dropdown selection
  //    (selectedAssistantId), since that's what a new chat will use;
  //  - no switcher at all: the global current assistant.
  const inThread = !!assistantSwitcher?.currentThread
  const threadAssistant = assistantSwitcher?.currentThread?.assistants?.[0]
  const isThreadAssistant =
    !!threadAssistant && threadAssistant.id !== 'model-only'
  const selectedAssistant = assistantSwitcher
    ? assistantSwitcher.assistants.find(
        (a) => a.id === assistantSwitcher.selectedAssistantId
      )
    : currentAssistant
  const activeAssistant: Assistant | undefined = inThread
    ? isThreadAssistant
      ? threadAssistant
      : undefined
    : selectedAssistant

  type SaveLane = {
    threadId?: string
    expected: Assistant
    params: Record<string, unknown>
    revision: number
    saving: boolean
  }
  const lanes = useRef<SaveLane[]>([])
  const [, refreshDraft] = useState(0)
  const threadId = assistantSwitcher?.currentThread?.id
  const lane = lanes.current.find(
    (entry) => entry.threadId === threadId && entry.expected === activeAssistant
  )
  const params = lane?.params ?? activeAssistant?.parameters ?? {}
  const samplerKeys = Object.keys(params).filter((k) => k in paramsSettings)
  const hasOverrides = samplerKeys.length > 0

  const writeParams = (change: (previous: Record<string, unknown>) => Record<string, unknown>) => {
    if (!activeAssistant) return
    let target = lanes.current.find(
      (entry) => entry.threadId === threadId && entry.expected === activeAssistant
    )
    if (!target) {
      target = { threadId, expected: activeAssistant, params, revision: 0, saving: false }
      lanes.current.push(target)
    }
    target.params = change(target.params)
    target.revision++
    refreshDraft((value) => value + 1)
    if (target.saving) return
    target.saving = true
    const save = async (entry: SaveLane) => {
      try {
        while (true) {
          const revision = entry.revision
          const next = entry.params
          // A newer thread assignment invalidates this lane, even for the same ID.
          if (entry.threadId && useThreads.getState().threads[entry.threadId]?.assistants?.[0] !== entry.expected) break
          const canonical = useAssistant.getState().assistants.find((a) => a.id === entry.expected.id)
          if (canonical) await updateAssistant({ ...canonical, parameters: next })
          if (entry.threadId) {
            const saved = await useThreads.getState().updateThreadAssistantIfUnchanged(entry.threadId, entry.expected, next)
            if (!saved) break
            entry.expected = saved
          } else {
            // Never replace a newly selected assistant with the captured one.
            const saved = useAssistant.getState().assistants.find((a) => a.id === entry.expected.id)
            if (saved) entry.expected = saved
          }
          if (revision === entry.revision) break
        }
      } catch (error) {
        toast.error('Could not save sampling parameters. Please try again.', {
          description: error instanceof Error ? error.message : undefined,
        })
      } finally {
        // Removing the optimistic draft reveals the last successfully saved
        // state on failure, not parameters belonging to a newer selection.
        lanes.current = lanes.current.filter((item) => item !== entry)
        refreshDraft((value) => value + 1)
      }
    }
    void save(target)
  }

  const handleToggle = (def: ParamDef) => {
    if (def.key in params) {
      writeParams((previous) => {
        const next = { ...previous }
        delete next[def.key]
        return next
      })
    } else {
      writeParams((previous) => ({ ...previous, [def.key]: def.value }))
    }
  }

  const handleChange = (key: string, value: unknown) => {
    writeParams((previous) => ({ ...previous, [key]: value }))
  }

  const handleRemove = (key: string) => {
    writeParams((previous) => {
      const next = { ...previous }
      delete next[key]
      return next
    })
  }

  const handleAddMany = (values: Record<string, unknown>) => {
    writeParams((previous) => ({ ...previous, ...values }))
  }

  const handleRemoveMany = (keys: string[]) => {
    writeParams((previous) => {
      const next = { ...previous }
      for (const k of keys) delete next[k]
      return next
    })
  }

  const handleResetAll = () => {
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(params)) {
      if (!(k in paramsSettings)) next[k] = v
    }
    writeParams(() => next)
  }

  if (isPredefinedRemoteProvider(providerId)) return null

  const triggerLabel = assistantsLoading
    ? 'Loading assistant…'
    : activeAssistant
      ? `Sampling — ${activeAssistant.name}`
      : 'Sampling'

  const content = (<>
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b">
          <AssistantHeader
            currentAssistant={activeAssistant}
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
        {activeAssistant ? (
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
  </>)

  if (hideTrigger) {
    return <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={(event) => {
        if (returnFocusRef?.current) { event.preventDefault(); returnFocusRef.current.focus() }
      }} className="flex max-h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[420px]">
        <DialogHeader className="border-b px-4 py-3 pr-12"><DialogTitle className="text-sm font-medium">Sampling parameters</DialogTitle></DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {!hideTrigger && <Tooltip>
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
      </Tooltip>}

      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        avoidCollisions
        className="w-[380px] p-0 flex flex-col max-h-[var(--radix-popover-content-available-height)]"
      >
        {content}
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
  const { t } = useTranslation()
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
        {currentAssistant?.name ?? t('common:noAssistant')}
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
        className="min-w-0 w-[min(320px,calc(100vw-16px),var(--radix-dropdown-menu-content-available-width))] max-h-64 overflow-y-auto"
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
