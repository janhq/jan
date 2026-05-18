import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'

import { useAppState } from '@/hooks/useAppState'
import { isPlatformTauri } from '@/lib/platform/utils'

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
      clearActiveWork()
      useAppState.getState().setOomError(event.payload ?? '')
    }).catch((e) => {
      console.warn('listen llamacpp-router-oom failed:', e)
      return () => {}
    })
    const unlistenBackend = listen<string>(
      'llamacpp-router-backend-error',
      (event) => {
        clearActiveWork()
        useAppState.getState().setBackendError(event.payload ?? '')
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
