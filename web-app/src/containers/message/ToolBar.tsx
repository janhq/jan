import { cn } from '@/lib/utils'

/** Blinking block that reads as the model typing into the bar. */
const Caret = () => (
  <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-pulse bg-foreground/70" />
)

export type ToolBarProps = {
  icon: React.ReactNode
  value: string
  placeholder: string
  /** Show the caret: the model is still writing this argument. */
  typing: boolean
  mono?: boolean
  trailing?: React.ReactNode
}

/**
 * Input-bar chrome shared by the native tool widgets, so a web search reads as
 * a search bar and a fetch as an address bar. The value is whatever has
 * streamed in so far, which is why the caret matters.
 */
export const ToolBar = ({
  icon,
  value,
  placeholder,
  typing,
  mono,
  trailing,
}: ToolBarProps) => (
  <div className="flex items-center gap-2 rounded-full border bg-card/40 px-3 py-1.5">
    <span className="shrink-0 text-muted-foreground">{icon}</span>
    <span
      className={cn(
        'min-w-0 flex-1 truncate text-sm',
        mono && 'font-mono text-xs',
        !value && 'text-muted-foreground/60'
      )}
    >
      {value || placeholder}
      {typing && <Caret />}
    </span>
    {trailing}
  </div>
)
