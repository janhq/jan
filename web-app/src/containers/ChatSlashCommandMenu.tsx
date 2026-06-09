import type { ChatSlashCommand } from '@/constants/chat-commands'
import { cn } from '@/lib/utils'

type ChatSlashCommandMenuProps = {
  commands: ChatSlashCommand[]
  highlightedIndex: number
  onHighlight: (index: number) => void
  onSelect: (command: ChatSlashCommand) => void
  className?: string
}

export function ChatSlashCommandMenu({
  commands,
  highlightedIndex,
  onHighlight,
  onSelect,
  className,
}: ChatSlashCommandMenuProps) {
  if (commands.length === 0) return null

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      className={cn(
        'absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-lg border border-border/70 bg-popover shadow-md',
        className
      )}
    >
      <div className="border-b border-border/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        Commands
      </div>
      <ul className="max-h-52 overflow-y-auto py-1">
        {commands.map((command, index) => {
          const active = index === highlightedIndex
          return (
            <li key={command.id}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                className={cn(
                  'flex w-full items-start gap-3 px-3 py-2 text-left text-sm transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/60'
                )}
                onMouseEnter={() => onHighlight(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onSelect(command)
                }}
              >
                <span className="shrink-0 font-mono text-xs font-medium text-foreground">
                  /{command.name}
                </span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {command.description}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}