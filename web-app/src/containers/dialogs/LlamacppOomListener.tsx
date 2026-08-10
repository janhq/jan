import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

import { useAppState } from '@/hooks/useAppState'
import { useCodeRun } from '@/hooks/useCodeRun'
import { isPlatformTauri } from '@/lib/platform/utils'
import {
  clearActiveWork,
  hasActiveLlamacppRequest,
  stampErrorOnLastUserMessage,
} from './llamacppRouterError'

type LoadProgressPayload = {
  model: string
  stage?: string
  stages: string[]
  value: number
}

type UnloadEventPayload = {
  model: string
  exit_code?: number | null
}

// Cowork sessions aren't chat threads, so they're invisible to
// hasActiveLlamacppRequest/stampErrorOnLastUserMessage (both keyed off
// useMessages + chat-only signals like currentStreamThreadId). A Cowork
// session currently talking to llamacpp is tracked separately in
// useCodeRun.llamacppRuns (sid -> model id it's using) — this notifies every
// session actually running against llamacpp right now. Rather than reaching
// into that session's in-flight submitTurn from outside, it cancels the run
// through the normal path and stashes a friendlier message than the generic
// connection failure the resulting cancellation will otherwise report;
// submitTurn's own completion logic (in code.tsx) picks it up. A no-op loop
// when no Cowork session is using llamacpp, so this needs no separate gating
// the way hasActiveLlamacppRequest does for chat's noisier, always-on signals.
function notifyCoworkSessions(message: string) {
  const { llamacppRuns, runId, setPendingLlamacppError } = useCodeRun.getState()
  for (const sid of Object.keys(llamacppRuns)) {
    const rid = runId[sid]
    if (!rid) continue
    setPendingLlamacppError(sid, message)
    invoke('agent_cancel', { runId: rid }).catch(() => {})
  }
}

export default function LlamacppOomListener() {
  useEffect(() => {
    if (!isPlatformTauri()) return
    const unlistenOom = listen<string>('llamacpp-router-oom', (event) => {
      const payload = event.payload ?? ''
      if (hasActiveLlamacppRequest()) {
        stampErrorOnLastUserMessage('oomError', payload)
        clearActiveWork()
        useAppState.getState().setOomError(payload)
      }
      notifyCoworkSessions(payload)
    }).catch((e) => {
      console.warn('listen llamacpp-router-oom failed:', e)
      return () => {}
    })
    const unlistenBackend = listen<string>(
      'llamacpp-router-backend-error',
      (event) => {
        const payload = event.payload ?? ''
        if (hasActiveLlamacppRequest()) {
          stampErrorOnLastUserMessage('backendError', payload)
          clearActiveWork()
          useAppState.getState().setBackendError(payload)
        }
        notifyCoworkSessions(payload)
      }
    ).catch((e) => {
      console.warn('listen llamacpp-router-backend-error failed:', e)
      return () => {}
    })
    const unlistenLoadProgress = listen<LoadProgressPayload>(
      'llamacpp-model-load-progress',
      (event) => {
        const { model, stage, stages, value } = event.payload
        const progress = { modelId: model, stage, stages, value }
        useAppState.getState().updateModelLoadProgress(progress)
        const threadId = useAppState.getState().currentStreamThreadId
        if (threadId) {
          useAppState.getState().updateThreadModelLoadProgress(threadId, progress)
        }
        // Forwarded to whichever Cowork session(s) are actually loading THIS
        // model — matched by id, not "whichever session ran most recently",
        // so two sessions loading different local models at once don't
        // cross-report each other's percentage. Cowork's own Record, not
        // useAppState's — see useCodeRun.loadingModels for why they're kept
        // separate rather than shared with chat's thread-keyed one.
        const { llamacppRuns } = useCodeRun.getState()
        for (const [sid, modelId] of Object.entries(llamacppRuns)) {
          if (modelId !== model) continue
          useCodeRun.getState().setSessionModelLoadProgress(sid, progress)
          useCodeRun.getState().setSessionLoadingModel(sid, true)
        }
      }
    ).catch((e) => {
      console.warn('listen llamacpp-model-load-progress failed:', e)
      return () => {}
    })
    // Fired for every model unload the router observes (explicit unload, LRU
    // eviction under models_max, or a crash) - forwarded unconditionally.
    // Jan already flips activeModels off for unloads it requested itself, so
    // reconciling an already-correct state here is a harmless no-op; the
    // real value is catching router-side evictions Jan didn't initiate.
    const unlistenUnloaded = listen<UnloadEventPayload>(
      'llamacpp-model-unloaded',
      (event) => {
        useAppState.getState().removeActiveModel(event.payload.model)
      }
    ).catch((e) => {
      console.warn('listen llamacpp-model-unloaded failed:', e)
      return () => {}
    })
    return () => {
      void unlistenOom.then((fn) => fn?.())
      void unlistenBackend.then((fn) => fn?.())
      void unlistenLoadProgress.then((fn) => fn?.())
      void unlistenUnloaded.then((fn) => fn?.())
    }
  }, [])

  return null
}
