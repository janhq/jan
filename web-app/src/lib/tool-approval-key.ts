export const approvalRequestKey = (threadId: string, toolCallId: string): string =>
  JSON.stringify([threadId, toolCallId])

/** Renderers with an owner must never display another thread's approval. */
export function findPendingApproval<T>(
  pending: Record<string, T>, toolCallId: string | undefined, threadId: string | undefined
): T | undefined {
  if (!toolCallId) return undefined
  return pending[threadId ? approvalRequestKey(threadId, toolCallId) : toolCallId]
}
