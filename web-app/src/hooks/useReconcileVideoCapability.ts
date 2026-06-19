import { useEffect } from 'react'
import { ExtensionManager } from '@/lib/extension'
import { useModelProvider } from './useModelProvider'

// `/props.modalities.video` is the only authoritative signal for video input:
// it reflects both the model's vision encoder AND whether the backend binary
// was built with MTMD_VIDEO — something the GGUF can't reveal. We can only read
// it once the model is loaded into the router, so video capability is
// reconciled here (post-load) rather than derived offline at list time.

type ModalitiesProps = {
  modalities?: { vision: boolean; video: boolean; audio: boolean }
}

type LlamacppLike = {
  getModelProps?: (modelId: string) => Promise<ModalitiesProps | undefined>
}

const getLlamacppExtension = (): LlamacppLike | undefined => {
  const mgr = ExtensionManager.getInstance()
  const candidates = [
    mgr.getByName('@janhq/llamacpp-extension'),
    mgr.getByName('llamacpp-extension'),
  ]
  for (const c of candidates) {
    if (c && typeof (c as LlamacppLike).getModelProps === 'function')
      return c as LlamacppLike
  }
  return undefined
}

/**
 * Reconcile the selected llamacpp model's `video` capability against the
 * router's `/props`. Runs whenever the model or `trigger` (e.g. chat status)
 * changes; no-ops until the model is loaded (getModelProps returns undefined).
 * Self-healing: persists the correction to the provider store.
 */
export function useReconcileVideoCapability(
  modelId: string | undefined,
  selectedProvider: string,
  trigger?: unknown
) {
  useEffect(() => {
    if (selectedProvider !== 'llamacpp' || !modelId) return
    const ext = getLlamacppExtension()
    if (!ext?.getModelProps) return

    let cancelled = false
    ext
      .getModelProps(modelId)
      .then((props) => {
        if (cancelled || !props?.modalities) return
        const supportsVideo = props.modalities.video

        const store = useModelProvider.getState()
        const provider = store.getProviderByName('llamacpp')
        const model = provider?.models.find((m) => m.id === modelId)
        if (!provider || !model) return

        const caps = model.capabilities ?? []
        const hasVideo = caps.includes('video')
        if (hasVideo === supportsVideo) return // already correct

        const nextCaps = supportsVideo
          ? [...caps, 'video']
          : caps.filter((c) => c !== 'video')

        store.updateProvider('llamacpp', {
          ...provider,
          models: provider.models.map((m) =>
            m.id === modelId
              ? {
                  ...m,
                  capabilities: nextCaps.length > 0 ? nextCaps : undefined,
                }
              : m
          ),
        })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [modelId, selectedProvider, trigger])
}
