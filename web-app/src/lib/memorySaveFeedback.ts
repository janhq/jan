import { createElement } from 'react'
import { toast } from 'sonner'
import { MemorySavedToast } from '@/components/MemorySavedToast'

export const MEMORY_SAVE_TOAST_ID = 'durable-memory-save'

/** Only native acknowledgements of actual mutations qualify. In particular,
 * deleting an absent note succeeds but changes nothing. Never parse/display
 * note content, and never infer success just from a non-error tool outcome.
 * Keep in step with memory.rs MemoryScopes' result strings.
 */
export function notifyMemoryMutation(
  args: Record<string, unknown>,
  content: unknown,
  signal?: AbortSignal
): void {
  if (signal?.aborted || typeof content !== 'string') return
  const confirmed =
    (args.op === 'write' && /^Wrote \d+ bytes to memory\//.test(content)) ||
    (args.op === 'edit' && content.startsWith('Edited memory/')) ||
    (args.op === 'delete' && content.startsWith('Deleted memory/')) ||
    (args.op === 'move' && content.startsWith('Moved memory/'))
  if (!confirmed) return

  // One toast across sessions/children: repeated writes replace, never stack.
  // Sonner supplies its polite live region and keyboard-accessible dismissal.
  toast(createElement(MemorySavedToast), {
    id: MEMORY_SAVE_TOAST_ID,
    duration: 6000,
    closeButton: true,
  })
}
