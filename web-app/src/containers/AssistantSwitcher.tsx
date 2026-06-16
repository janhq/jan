import { useEffect, useRef } from 'react'
import { IconChevronDown, IconUser } from '@tabler/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { AssistantsMenu } from '@/components/AssistantsMenu'
import { useAssistantSwitcher } from '@/hooks/useAssistantSwitcher'

export interface AssistantSwitcherProps {
  assistants: Assistant[]
  currentThread: Thread | undefined
  selectedAssistantId: string | undefined
  setSelectedAssistantId: (id: string) => void
  updateCurrentThreadAssistant: (assistant: Assistant) => void
}

const isMac =
  typeof navigator !== 'undefined' &&
  navigator.userAgent.toUpperCase().indexOf('MAC') >= 0
const shortcutHint = `${isMac ? '⌘' : 'Ctrl'}+J`

// Dedicated, always-visible assistant switcher for the chat input. Rendered
// only when more than one assistant exists; otherwise switching is moot.
export function AssistantSwitcher({
  assistants,
  currentThread,
  selectedAssistantId,
  setSelectedAssistantId,
  updateCurrentThreadAssistant,
}: AssistantSwitcherProps) {
  const open = useAssistantSwitcher((s) => s.open)
  const setOpen = useAssistantSwitcher((s) => s.setOpen)
  const setCycleHandler = useAssistantSwitcher((s) => s.setCycleHandler)

  const threadAssistant = currentThread?.assistants?.[0]
  const isThreadAssistant =
    !!threadAssistant && threadAssistant.id !== 'model-only'
  const activeAssistant = currentThread
    ? isThreadAssistant
      ? threadAssistant
      : undefined
    : assistants.find((a) => a.id === selectedAssistantId)

  // Keep a ref to the freshest cycle logic so the registered handler (stable
  // across renders) always advances using current props.
  const cycleRef = useRef<() => void>(() => {})
  cycleRef.current = () => {
    if (assistants.length <= 1) return
    const activeId = currentThread
      ? isThreadAssistant
        ? threadAssistant?.id
        : undefined
      : selectedAssistantId
    const idx = assistants.findIndex((a) => a.id === activeId)
    const next = assistants[(idx + 1) % assistants.length]
    if (currentThread) {
      updateCurrentThreadAssistant(next)
    } else {
      setSelectedAssistantId(next.id)
    }
  }

  useEffect(() => {
    const handler = () => cycleRef.current()
    setCycleHandler(handler)
    return () => {
      setCycleHandler(null)
      setOpen(false)
    }
  }, [setCycleHandler, setOpen])

  if (assistants.length <= 1) return null

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1 min-w-0"
              aria-label="Switch assistant"
            >
              {activeAssistant?.avatar ? (
                <AvatarEmoji
                  avatar={activeAssistant.avatar}
                  imageClassName="size-4 object-contain"
                  textClassName="text-sm"
                />
              ) : (
                <IconUser size={14} className="text-muted-foreground" />
              )}
              <span className="text-sm font-medium truncate max-w-32">
                {activeAssistant?.name ?? 'No assistant'}
              </span>
              <IconChevronDown size={14} className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>Switch assistant ({shortcutHint})</p>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
        <AssistantsMenu
          selectedAssistant={selectedAssistantId}
          setSelectedAssistant={setSelectedAssistantId}
          currentThread={currentThread}
          updateCurrentThreadAssistant={updateCurrentThreadAssistant}
          assistants={assistants}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
