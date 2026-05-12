import { useEffect, useMemo, useRef, useState } from 'react'
import { ThreadMessage } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { useModelProvider } from './useModelProvider'

export interface TokenCountData {
  tokenCount: number
  maxTokens?: number
  percentage?: number
  isNearLimit: boolean
  loading: boolean
  error?: string
}

interface UsageMeta {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

interface LlamacppExtensionLike {
  getModelContext?: (modelId: string) => Promise<number | undefined>
}

const getLatestServerUsage = (messages: ThreadMessage[]): number => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = (messages[i].metadata as { usage?: UsageMeta } | undefined)
      ?.usage
    const total = usage?.totalTokens
    if (typeof total === 'number' && total > 0) return total
  }
  return 0
}

const getLlamacppExtension = (): LlamacppExtensionLike | undefined => {
  const mgr = ExtensionManager.getInstance()
  const candidates = [
    mgr.getByName('@janhq/llamacpp-extension'),
    mgr.getByName('llamacpp-extension'),
  ]
  for (const c of candidates) {
    if (c && typeof (c as LlamacppExtensionLike).getModelContext === 'function')
      return c as LlamacppExtensionLike
  }
  const found = mgr.listExtensions().find(
    (ext) =>
      typeof (ext as LlamacppExtensionLike).getModelContext === 'function'
  ) as LlamacppExtensionLike | undefined
  return found
}

export const useTokensCount = (messages: ThreadMessage[] = []) => {
  const { selectedModel, selectedProvider } = useModelProvider()
  const [maxTokens, setMaxTokens] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const reqId = useRef(0)

  const modelId =
    selectedProvider === 'llamacpp' ? selectedModel?.id : undefined

  // Fetch real n_ctx from llama-server /props when the active llamacpp model
  // changes, and refresh when a new assistant turn lands (model may have just
  // been (re)loaded). Undefined → popup hides itself.
  useEffect(() => {
    if (!modelId) {
      setMaxTokens(undefined)
      setLoading(false)
      return
    }
    const ext = getLlamacppExtension()
    if (!ext?.getModelContext) {
      setMaxTokens(undefined)
      return
    }
    const id = ++reqId.current
    setLoading(true)
    ext
      .getModelContext(modelId)
      .then((n) => {
        if (id !== reqId.current) return
        setMaxTokens(n)
      })
      .catch(() => {
        if (id !== reqId.current) return
        setMaxTokens(undefined)
      })
      .finally(() => {
        if (id !== reqId.current) return
        setLoading(false)
      })
  }, [modelId, messages.length])

  const tokenData: TokenCountData = useMemo(() => {
    if (selectedProvider !== 'llamacpp' || !modelId) {
      return { tokenCount: 0, loading: false, isNearLimit: false }
    }
    const tokenCount = getLatestServerUsage(messages)
    const percentage = maxTokens ? (tokenCount / maxTokens) * 100 : undefined
    const isNearLimit = percentage ? percentage > 85 : false
    return {
      tokenCount,
      maxTokens,
      percentage,
      isNearLimit,
      loading,
    }
  }, [messages, modelId, selectedProvider, maxTokens, loading])

  return {
    ...tokenData,
    calculateTokens: async () => undefined,
  }
}
