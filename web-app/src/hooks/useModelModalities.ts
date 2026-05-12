import { useEffect, useRef, useState } from 'react'
import { ExtensionManager } from '@/lib/extension'
import { useModelProvider } from './useModelProvider'

export interface ModelModalities {
  vision: boolean
  audio: boolean
}

interface LlamacppExtensionLike {
  getModelModalities?: (
    modelId: string
  ) => Promise<ModelModalities | undefined>
}

const getLlamacppExtension = (): LlamacppExtensionLike | undefined => {
  const mgr = ExtensionManager.getInstance()
  const candidates = [
    mgr.getByName('@janhq/llamacpp-extension'),
    mgr.getByName('llamacpp-extension'),
  ]
  for (const c of candidates) {
    if (
      c &&
      typeof (c as LlamacppExtensionLike).getModelModalities === 'function'
    )
      return c as LlamacppExtensionLike
  }
  return mgr.listExtensions().find(
    (ext) =>
      typeof (ext as LlamacppExtensionLike).getModelModalities === 'function'
  ) as LlamacppExtensionLike | undefined
}

const PROBE_INTERVAL_MS = 4000

/**
 * Probes the llamacpp router's `/props?model=...` for advertised modalities.
 * Returns `undefined` until the model is loaded (router only knows modalities
 * after load), so callers should treat `undefined` as "unknown" and re-poll.
 */
export const useModelModalities = (): {
  modalities: ModelModalities | undefined
  loading: boolean
} => {
  const selectedModel = useModelProvider((s) => s.selectedModel)
  const selectedProvider = useModelProvider((s) => s.selectedProvider)
  const [modalities, setModalities] = useState<ModelModalities | undefined>(
    undefined
  )
  const [loading, setLoading] = useState(false)
  const reqId = useRef(0)

  const modelId =
    selectedProvider === 'llamacpp' ? selectedModel?.id : undefined

  useEffect(() => {
    if (!modelId) {
      setModalities(undefined)
      setLoading(false)
      return
    }
    const ext = getLlamacppExtension()
    if (!ext?.getModelModalities) {
      setModalities(undefined)
      return
    }
    const id = ++reqId.current
    let cancelled = false
    setLoading(true)

    const probe = async () => {
      try {
        const m = await ext.getModelModalities!(modelId)
        if (cancelled || id !== reqId.current) return
        if (m) {
          setModalities(m)
          setLoading(false)
        }
      } catch {
        if (!cancelled && id === reqId.current) setLoading(false)
      }
    }

    probe()
    const handle = setInterval(() => {
      if (cancelled) return
      probe()
    }, PROBE_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [modelId])

  return { modalities, loading }
}
