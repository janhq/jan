import { useEffect, useMemo, useRef, useState } from 'react'
import { ThreadMessage } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { useModelProvider } from './useModelProvider'

export interface ModelProps {
  nCtx: number
  totalSlots?: number
  modelAlias?: string
  modalities?: { vision: boolean; audio: boolean }
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
  error?: string
}

interface UsageMeta {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

interface LlamacppExtensionLike {
  getModelProps?: (modelId: string) => Promise<ModelProps | undefined>
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
    const usage = getLatestServerUsage(messages)
    const tokenCount = usage.totalTokens ?? 0
    const maxTokens = modelProps?.nCtx
    const percentage = maxTokens ? (tokenCount / maxTokens) * 100 : undefined
    const isNearLimit = percentage ? percentage > 85 : false

    const provider = getProviderByName('llamacpp')
    const fitEnabled =
      provider?.settings?.find((s) => s.key === 'fit')?.controller_props
        ?.value === true
    const configuredCtxLen = readSettingNumber(
      selectedModel?.settings?.ctx_len?.controller_props?.value
    )
    const modelDisplayName =
      modelProps?.modelAlias || selectedModel?.name || modelId

    return {
      tokenCount,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      maxTokens,
      percentage,
      isNearLimit,
      loading,
      modelProps,
      modelDisplayName,
      fitEnabled,
      configuredCtxLen,
    }
  }, [
    messages,
    modelId,
    selectedProvider,
    modelProps,
    loading,
    getProviderByName,
    selectedModel?.name,
    selectedModel?.settings?.ctx_len?.controller_props?.value,
  ])

  return {
    ...tokenData,
    calculateTokens: async () => undefined,
  }
}
