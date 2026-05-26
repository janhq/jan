import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'

import { useAppState } from '@/hooks/useAppState'
import { useMessages } from '@/hooks/useMessages'
import { isPlatformTauri } from '@/lib/platform/utils'

function stampErrorOnLastUserMessage(
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

function clearActiveWork() {
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

export default function LlamacppOomListener() {
  useEffect(() => {
    if (!isPlatformTauri()) return
    const unlistenOom = listen<string>('llamacpp-router-oom', (event) => {
      const payload = event.payload ?? ''
      stampErrorOnLastUserMessage('oomError', payload)
      clearActiveWork()
      useAppState.getState().setOomError(payload)
    }).catch((e) => {
      console.warn('listen llamacpp-router-oom failed:', e)
      return () => {}
    })
    const unlistenBackend = listen<string>(
      'llamacpp-router-backend-error',
      (event) => {
        const payload = event.payload ?? ''
        stampErrorOnLastUserMessage('backendError', payload)
        clearActiveWork()
        useAppState.getState().setBackendError(payload)
      }
    ).catch((e) => {
      console.warn('listen llamacpp-router-backend-error failed:', e)
      return () => {}
    })
    return () => {
      void unlistenOom.then((fn) => fn?.())
      void unlistenBackend.then((fn) => fn?.())
    }
  }, [])

  return null
}
