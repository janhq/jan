import { cn } from '@/lib/utils'
import { CodeBlock } from '@/components/ai-elements/code-block'

/**
 * Renders the line-prefixed diff emitted by the agent loop for `write`/`edit`
 * using the shared Shiki `CodeBlock` with the `diff` grammar, so agent diffs are
 * highlighted the same way code and tool output are elsewhere in the app.
 */
export function DiffView({
  diff,
  className,
}: {
  diff: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'max-h-56 overflow-auto rounded-md border text-xs',
        className
      )}
    >
      <CodeBlock code={diff} language="diff" />
    </div>
  )
}
