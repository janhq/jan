import { useEffect, useMemo, useRef, useState } from 'react'
import { ThreadMessage } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { parseContextOverflow } from '@/utils/error'
import { useModelProvider } from './useModelProvider'

export interface ModelProps {
  nCtx: number
  totalSlots?: number
  modelAlias?: string
  isSleeping?: boolean
}

export interface TokenCountData {
  tokenCount: number
  inputTokens?: number
  outputTokens?: number
  maxTokens?: number
  percentage?: number
  isNearLimit: boolean
  loading: boolean
  modelProps?: ModelProps
  modelDisplayName?: string
  fitEnabled: boolean
  configuredCtxLen?: number
  modalities?: { vision: boolean; audio: boolean }
  error?: string
  isOverflow?: boolean
}

interface UsageMeta {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

interface LlamacppExtensionLike {
  getModelProps?: (modelId: string) => Promise<ModelProps | undefined>
}

// The token-usage popup normally reflects the last *successful* turn. When a
// request overflows, that turn is never recorded, so the popup would keep
// showing a comfortable percentage next to an "out of context" error. Parse
// the failing request's counts out of the stamped contextError so the popup
// reflects the request that actually overflowed.
const getActiveContextOverflow = (messages: ThreadMessage[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const ctx = (messages[i].metadata as { contextError?: unknown } | undefined)
      ?.contextError
    if (typeof ctx === 'string' && ctx.length > 0) return parseContextOverflow(ctx)
  }
  return null
}

const getLatestServerUsage = (messages: ThreadMessage[]): UsageMeta => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = (messages[i].metadata as { usage?: UsageMeta } | undefined)
      ?.usage
    if (usage && typeof usage.totalTokens === 'number' && usage.totalTokens > 0)
      return usage
  }
  return {}
}

const getLlamacppExtension = (): LlamacppExtensionLike | undefined => {
  const mgr = ExtensionManager.getInstance()
  const candidates = [
    mgr.getByName('@janhq/llamacpp-extension'),
    mgr.getByName('llamacpp-extension'),
  ]
  for (const c of candidates) {
    if (c && typeof (c as LlamacppExtensionLike).getModelProps === 'function')
      return c as LlamacppExtensionLike
  }
  return mgr.listExtensions().find(
    (ext) =>
      typeof (ext as LlamacppExtensionLike).getModelProps === 'function'
  ) as LlamacppExtensionLike | undefined
}

const readSettingNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

export const useTokensCount = (messages: ThreadMessage[] = []) => {
  const { selectedModel, selectedProvider, getProviderByName } =
    useModelProvider()
  const [modelProps, setModelProps] = useState<ModelProps | undefined>(
    undefined
  )
  const [loading, setLoading] = useState(false)
  const reqId = useRef(0)

  const modelId =
    selectedProvider === 'llamacpp' ? selectedModel?.id : undefined

  useEffect(() => {
    if (!modelId) {
      setModelProps(undefined)
      setLoading(false)
      return
    }
    const ext = getLlamacppExtension()
    if (!ext?.getModelProps) {
      setModelProps(undefined)
      return
    }
    const id = ++reqId.current
    setLoading(true)
    ext
      .getModelProps(modelId)
      .then((props) => {
        if (id !== reqId.current) return
        setModelProps(props)
      })
      .catch(() => {
        if (id !== reqId.current) return
        setModelProps(undefined)
      })
      .finally(() => {
        if (id !== reqId.current) return
        setLoading(false)
      })
  }, [modelId, messages.length])

  const tokenData: TokenCountData = useMemo(() => {
    if (selectedProvider !== 'llamacpp' || !modelId) {
      return {
        tokenCount: 0,
        loading: false,
        isNearLimit: false,
        fitEnabled: false,
      }
    }
    const overflow = getActiveContextOverflow(messages)
    const usage = getLatestServerUsage(messages)
    const tokenCount = overflow?.requestTokens ?? usage.totalTokens ?? 0
    const maxTokens = overflow?.contextTokens ?? modelProps?.nCtx
    const percentage = maxTokens ? (tokenCount / maxTokens) * 100 : undefined
    const isNearLimit = overflow != null || (percentage ? percentage > 85 : false)

    const provider = getProviderByName('llamacpp')
    const fitEnabled =
      provider?.settings?.find((s) => s.key === 'fit')?.controller_props
        ?.value === true
    const configuredCtxLen = readSettingNumber(
      selectedModel?.settings?.ctx_len?.controller_props?.value
    )
    const modelDisplayName =
      modelProps?.modelAlias || selectedModel?.name || modelId
    const caps = selectedModel?.capabilities ?? []
    const modalities = {
      vision: caps.includes('vision'),
      audio: caps.includes('audio'),
    }

    return {
      tokenCount,
      inputTokens: overflow ? overflow.requestTokens : usage.inputTokens,
      outputTokens: overflow ? 0 : usage.outputTokens,
      maxTokens,
      percentage,
      isNearLimit,
      loading,
      modelProps,
      modelDisplayName,
      fitEnabled,
      configuredCtxLen,
      modalities,
      isOverflow: overflow != null,
    }
  }, [
    messages,
    modelId,
    selectedProvider,
    modelProps,
    loading,
    getProviderByName,
    selectedModel?.name,
    selectedModel?.capabilities,
    selectedModel?.settings?.ctx_len?.controller_props?.value,
  ])

  return {
    ...tokenData,
    calculateTokens: async () => undefined,
  }
}
