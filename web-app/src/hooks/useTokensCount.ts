import { useMemo } from 'react'
import { ThreadMessage } from '@janhq/core'
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

const getLatestServerUsage = (messages: ThreadMessage[]): number => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = (messages[i].metadata as { usage?: UsageMeta } | undefined)
      ?.usage
    const total = usage?.totalTokens
    if (typeof total === 'number' && total > 0) return total
  }
  return 0
}

export const useTokensCount = (messages: ThreadMessage[] = []) => {
  const { selectedModel, selectedProvider } = useModelProvider()

  const tokenData: TokenCountData = useMemo(() => {
    if (selectedProvider !== 'llamacpp' || !selectedModel?.id) {
      return { tokenCount: 0, loading: false, isNearLimit: false }
    }

    const tokenCount = getLatestServerUsage(messages)

    const maxTokensValue =
      selectedModel?.settings?.ctx_len?.controller_props?.value
    const maxTokens =
      typeof maxTokensValue === 'string'
        ? parseInt(maxTokensValue)
        : typeof maxTokensValue === 'number'
          ? maxTokensValue
          : undefined

    const percentage = maxTokens ? (tokenCount / maxTokens) * 100 : undefined
    const isNearLimit = percentage ? percentage > 85 : false

    return {
      tokenCount,
      maxTokens,
      percentage,
      isNearLimit,
      loading: false,
    }
  }, [
    messages,
    selectedModel?.id,
    selectedProvider,
    selectedModel?.settings?.ctx_len?.controller_props?.value,
  ])

  return {
    ...tokenData,
    calculateTokens: async () => undefined,
  }
}
