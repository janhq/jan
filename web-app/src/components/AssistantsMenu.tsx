import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { IconCheck, IconMinus } from '@tabler/icons-react'

type AssistantMenuProps = {
  selectedAssistant: string | undefined
  setSelectedAssistant: (assistant: string) => void
  currentThread: Thread | undefined
  updateCurrentThreadAssistant: (assistant: Assistant | undefined) => void
  assistants: Assistant[]
}

export function AssistantsMenu({
  selectedAssistant,
  setSelectedAssistant,
  currentThread,
  updateCurrentThreadAssistant,
  assistants,
}: AssistantMenuProps) {
  const threadAssistant = currentThread?.assistants?.[0]
  const deletedAssistant =
    threadAssistant &&
    threadAssistant.id !== 'model-only' &&
    !assistants.some((a) => a.id === threadAssistant.id)
      ? currentThread?.assistants?.[0]
      : null
  const noSelectedAssistant = currentThread
    ? !threadAssistant || threadAssistant.id === 'model-only'
    : !selectedAssistant
  return (
    <>
      {deletedAssistant && (
        <DropdownMenuItem className="min-w-0 bg-accent" disabled>
          <div className="flex min-w-0 w-full items-center gap-2 leading-5">
            <AssistantAvatar avatar={deletedAssistant.avatar} />
            <span
              dir="auto"
              title={`${deletedAssistant.name || 'Unnamed Assistant'} (deleted)`}
              className="min-w-0 flex-1 truncate [unicode-bidi:isolate]"
            >
              {deletedAssistant.name || 'Unnamed Assistant'} (deleted)
            </span>
            <span className="flex size-4 shrink-0 items-center justify-center text-xs text-muted-foreground"><IconCheck size={14} aria-hidden /></span>
          </div>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        className={`min-w-0 ${noSelectedAssistant ? 'bg-accent' : ''}`}
        onClick={() => {
          setSelectedAssistant('')
          if (currentThread) {
            updateCurrentThreadAssistant(undefined)
          }
        }}
      >
        <div className="flex min-w-0 w-full items-center gap-2 leading-5">
          <span className="flex size-4 shrink-0 items-center justify-center leading-none text-muted-foreground"><IconMinus size={14} aria-hidden /></span>
          <span className="min-w-0 flex-1 truncate">None</span>
          <span className="flex size-4 shrink-0 items-center justify-center text-xs text-muted-foreground">
            {noSelectedAssistant ? <IconCheck size={14} aria-hidden /> : null}
          </span>
        </div>
      </DropdownMenuItem>
      {assistants.length > 0 ? (
        assistants.map((assistant) => {
          const isSelected = currentThread
            ? currentThread?.assistants?.some((a) => a.id === assistant.id)
            : selectedAssistant === assistant.id
          return (
            <DropdownMenuItem
              key={assistant.id}
              className={`min-w-0 ${isSelected ? 'bg-accent' : ''}`}
              onClick={() => {
                if (currentThread) {
                  updateCurrentThreadAssistant(assistant)
                } else {
                  setSelectedAssistant(assistant ? assistant.id : '')
                }
              }}
            >
              <div className="flex min-w-0 w-full items-center gap-2 leading-5">
                <AssistantAvatar avatar={assistant.avatar} />
                <span
                  dir="auto"
                  title={assistant.name || 'Unnamed Assistant'}
                  className="min-w-0 flex-1 truncate [unicode-bidi:isolate]"
                >
                  {assistant.name || 'Unnamed Assistant'}
                </span>
                <span className="flex size-4 shrink-0 items-center justify-center text-xs text-muted-foreground">
                  {isSelected ? <IconCheck size={14} aria-hidden /> : null}
                </span>
              </div>
            </DropdownMenuItem>
          )
        })
      ) : (
        <DropdownMenuItem disabled>
          <span className="text-muted-foreground">No assistants available</span>
        </DropdownMenuItem>
      )}
    </>
  )
}
