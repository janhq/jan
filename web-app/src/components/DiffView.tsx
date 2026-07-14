import { cn } from '@/lib/utils'

/**
 * Renders a focused, line-prefixed diff (the `diff` field emitted by the agent
 * loop for `write`/`edit`): `+` additions green, `-` deletions red, `@` hunk
 * headers muted. Display-only — not a full unified-diff parser.
 */
export function DiffView({
  diff,
  className,
}: {
  diff: string
  className?: string
}) {
  return (
    <pre
      className={cn(
        'max-h-56 overflow-auto rounded-md bg-sidebar-foreground/5 p-2 text-xs font-mono leading-relaxed',
        className
      )}
    >
      {diff.split('\n').map((line, i) => (
        <div
          key={i}
          className={cn(
            line.startsWith('+') && 'text-emerald-600 dark:text-emerald-400',
            line.startsWith('-') && 'text-red-600 dark:text-red-400',
            line.startsWith('@') && 'text-muted-foreground'
          )}
        >
          {line || ' '}
        </div>
      ))}
    </pre>
  )
}
