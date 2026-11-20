import { useAppState } from '@/hooks/useAppState'
import { useMessages } from '@/hooks/useMessages'
import { useModelProvider } from '@/hooks/useModelProvider'

// Router errors are only user-facing when they could have killed an in-flight
// llamacpp generation. At launch/idle the router can emit startup noise with no
// active request — surfacing it would banner a provider the user never invoked
// (e.g. MLX selected on macOS).
/**
 * Whether the app has engine work in flight, independent of which provider is
 * selected. Separate from [`hasActiveLlamacppRequest`] so a caller that
 * already knows it is on llama.cpp -- the provider settings page -- can use it
 * as a zustand selector and re-render when the answer changes.
 */
export function isEngineWorkInFlight(
  app: Pick<
    ReturnType<typeof useAppState.getState>,
    | 'currentStreamThreadId'
    | 'abortControllers'
    | 'busyThreads'
    | 'loadingModels'
    | 'streamingContents'
  >
): boolean {
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

export function hasActiveLlamacppRequest(): boolean {
  if (useModelProvider.getState().selectedProvider !== 'llamacpp') return false
  return isEngineWorkInFlight(useAppState.getState())
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
