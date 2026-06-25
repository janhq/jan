import { useAppState } from '@/hooks/useAppState'
import { useMessages } from '@/hooks/useMessages'
import { useModelProvider } from '@/hooks/useModelProvider'

// Router errors are only user-facing when they could have killed an in-flight
// llamacpp generation. At launch/idle the router can emit startup noise with no
// active request — surfacing it would banner a provider the user never invoked
// (e.g. MLX selected on macOS).
export function hasActiveLlamacppRequest(): boolean {
  if (useModelProvider.getState().selectedProvider !== 'llamacpp') return false
  const app = useAppState.getState()
  return (
    // A token stream is the common case and sets none of the slots below;
    // currentStreamThreadId is the reliable "request in flight" signal.
    app.currentStreamThreadId != null ||
    Object.keys(app.abortControllers).length > 0 ||
    Object.keys(app.busyThreads).length > 0 ||
    Object.keys(app.loadingModels).length > 0 ||
    Object.keys(app.streamingContents).length > 0
  )
}

export function stampErrorOnLastUserMessage(
  field: 'oomError' | 'backendError',
  value: string
) {
  const threadId = useAppState.getState().currentStreamThreadId
  if (!threadId) return
  const messages = useMessages.getState().getMessages(threadId)
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const meta = (m.metadata as Record<string, unknown> | undefined) ?? {}
    if (meta[field] === value) return
    useMessages.getState().updateMessage({
      ...m,
      metadata: { ...meta, [field]: value },
    })
    return
  }
}

export function clearActiveWork() {
  const app = useAppState.getState()
  Object.values(app.abortControllers).forEach((c) => {
    try {
      c.abort()
    } catch (e) {
      console.warn('router error: abort controller threw:', e)
    }
  })
  const threadIds = new Set<string>([
    ...Object.keys(app.loadingModels),
    ...Object.keys(app.busyThreads),
    ...Object.keys(app.streamingContents),
    ...Object.keys(app.abortControllers),
  ])
  threadIds.forEach((id) => app.clearThreadState(id))
  app.updateLoadingModel(false)
}
