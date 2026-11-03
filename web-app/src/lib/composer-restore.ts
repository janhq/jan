import { usePrompt } from '@/hooks/usePrompt'
import { useThreads } from '@/hooks/useThreads'
import { useMessageQueue, type QueuedMessage } from '@/stores/message-queue-store'
import {
  useFailedDrafts,
  mergeRestoredAttachments,
  attachmentIdentity,
} from '@/stores/failed-draft-store'
import type { Attachment } from '@/types/attachment'

// Composer restore helpers used by the thread route's onSubmit / queue drain.
// Kept in a small module so the composer contract can be tested against the
// production code without importing the whole route.

/**
 * Hands a submitted draft (text + attachments) back after a send was
 * cancelled, failed in processing, or was rejected, without clobbering
 * anything newer.
 *
 * The real ChatInput retains the prompt in the composer until `onSubmit`
 * settles and only clears it for an accepted send, so at restore time the
 * composer holds one of three things:
 *
 * - Thread open and the prompt EMPTY, or still exactly the submitted draft:
 *   nothing newer exists. The attachments (cleared when processing began) go
 *   back through a functional updater (unique by identity, submitted ones
 *   first, newer files kept) and the prompt is set to the draft (a no-op when
 *   it is already that text). No failed-draft entry is created, so nothing is
 *   duplicated.
 * - Otherwise (a newer draft was typed, or the thread is no longer open and the
 *   prompt store is shared with Home and other threads): the prompt and the
 *   composer are never touched. The COMPLETE draft, text and attachment
 *   snapshot together, is kept as one recoverable entry in the failed-draft
 *   store. It is never auto-sent; ChatInput offers Restore draft / Dismiss.
 *
 * In every non-restoring branch (thread gone, thread not open, newer prompt)
 * the prompt is cleared ONLY when it still equals the submitted original, so
 * ChatInput's retained copy neither leaks into the shared prompt store nor
 * duplicates the failed-draft entry. A different (newer) prompt is never
 * touched.
 *
 * Callers return `false` from `onSubmit` afterwards so ChatInput does not
 * clear whatever this left in the composer.
 */
export function restoreSubmittedDraft(args: {
  threadId: string
  attachmentsKey: string
  draft: string
  attachments: Attachment[]
  /** Lifetime token captured when the send started (see failed-draft-store). */
  token: string
  setAttachments: (
    key: string,
    updater: (prev: Attachment[]) => Attachment[]
  ) => void
  /**
   * The send stopped before the bucket was cleared (ingestion cancel), so the
   * submitted files are still in it. When the draft moves into a failed-draft
   * entry they are taken out of the bucket, otherwise they would be in the
   * entry AND ride along with the newer prompt.
   */
  bucketHoldsAttachments?: boolean
}): boolean {
  const {
    threadId,
    attachmentsKey,
    draft,
    attachments,
    token,
    setAttachments,
    bucketHoldsAttachments = false,
  } = args
  // The thread was deleted, reset, or (temporary chat) left while this send was
  // in flight: its text and media must not come back anywhere, composer included.
  const composer = usePrompt.getState()
  const unchanged = composer.prompt === draft
  if (useFailedDrafts.getState().getToken(threadId) !== token) {
    // ChatInput kept the original in the shared prompt store; drop it, but
    // never a newer prompt.
    if (unchanged && draft) composer.setPrompt('')
    return false
  }
  const open = useThreads.getState().currentThreadId === threadId
  if (open && (!composer.prompt || unchanged)) {
    if (attachments.length > 0) {
      setAttachments(attachmentsKey, (prev) =>
        mergeRestoredAttachments(attachments, prev)
      )
    }
    if (composer.prompt !== draft) composer.setPrompt(draft)
    return true
  }
  if (bucketHoldsAttachments && attachments.length > 0) {
    const moved = new Set(attachments.map(attachmentIdentity))
    setAttachments(attachmentsKey, (prev) =>
      prev.filter((a) => !moved.has(attachmentIdentity(a)))
    )
  }
  useFailedDrafts.getState().add(threadId, { text: draft, attachments }, token)
  // Thread not open: the unchanged original must not also stay in the composer.
  if (unchanged && draft) composer.setPrompt('')
  return false
}

/**
 * Puts a dequeued item back at the head of its thread's queue, unless the
 * queue was cleared (explicitly or by leaving the thread) after the dequeue:
 * `token` is the thread's generation captured at dequeue. When the SDK is
 * already in error for this same thread, the restored head is held right away:
 * the error's own pause ran while the queue was empty and was a no-op, so
 * without this a new submission could drain ahead of the restored item.
 * The same holds when the SDK stayed ready and this rejection latched the
 * retry: the head is held so Resume is visible and a new submission queues
 * behind it instead of being sent directly ahead of the older message.
 */
export function restoreQueueHead(
  threadId: string,
  item: QueuedMessage,
  token: number,
  live: { status: string; threadId: string },
  /** This rejection owns the current status epoch and latched the retry. */
  latched = false
): boolean {
  const store = useMessageQueue.getState()
  if (store.getToken(threadId) !== token) return false
  useMessageQueue.setState((state) => {
    const queue = state.queues[threadId] ?? []
    if (queue.some((m) => m.id === item.id)) return state
    return { queues: { ...state.queues, [threadId]: [item, ...queue] } }
  })
  if (latched || (live.status === 'error' && live.threadId === threadId)) {
    useMessageQueue.getState().pause(threadId)
  }
  return true
}
