import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { ThreadMessage, ContentType } from '@janhq/core'
import { useServiceHub } from './useServiceHub'
import { useModelProvider } from './useModelProvider'
import { usePrompt } from './usePrompt'

export interface TokenCountData {
  tokenCount: number
  maxTokens?: number
  percentage?: number
  isNearLimit: boolean
  loading: boolean
  error?: string
}

export const useTokensCount = (messages: ThreadMessage[] = []) => {
  const [tokenData, setTokenData] = useState<TokenCountData>({
    tokenCount: 0,
    loading: false,
    isNearLimit: false,
  })

  const debounceTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const isIncreasingContextSize = useRef<boolean>(false)
  const serviceHub = useServiceHub()
  const { selectedModel, selectedProvider } = useModelProvider()
  const { prompt } = usePrompt()

  // Create messages with current prompt for live calculation
  const messagesWithPrompt = useMemo(() => {
    const result = [...messages]
    if (prompt.trim()) {
      result.push({
        id: 'temp-prompt',
        thread_id: '',
        role: 'user',
        content: [{ type: ContentType.Text, text: { value: prompt } }],
        created_at: Date.now(),
      } as ThreadMessage)
    }
    return result
  }, [messages, prompt])

  // Debounced calculation that includes current prompt
  const debouncedCalculateTokens = useCallback(async () => {
    const modelId = selectedModel?.id
    if (!modelId || selectedProvider !== 'llamacpp') {
      setTokenData({
        tokenCount: 0,
        loading: false,
        isNearLimit: false,
      })
      return
    }

    // Use messages with current prompt for calculation
    const messagesToCalculate = messagesWithPrompt
    if (messagesToCalculate.length === 0) {
      setTokenData({
        tokenCount: 0,
        loading: false,
        isNearLimit: false,
      })
      return
    }

    setTokenData((prev) => ({ ...prev, loading: true, error: undefined }))

    try {
      const tokenCount = await serviceHub
        .models()
        .getTokensCount(modelId, messagesToCalculate)

      const maxTokensValue =
        selectedModel?.settings?.ctx_len?.controller_props?.value
      const maxTokensNum =
        typeof maxTokensValue === 'string'
          ? parseInt(maxTokensValue)
          : typeof maxTokensValue === 'number'
            ? maxTokensValue
            : undefined

      const percentage = maxTokensNum
        ? (tokenCount / maxTokensNum) * 100
        : undefined
      const isNearLimit = percentage ? percentage > 85 : false

      setTokenData({
        tokenCount,
        maxTokens: maxTokensNum,
        percentage,
        isNearLimit,
        loading: false,
      })
    } catch (error) {
      console.error('Failed to calculate tokens:', error)
      setTokenData((prev) => ({
        ...prev,
        loading: false,
        error:
          error instanceof Error ? error.message : 'Failed to calculate tokens',
      }))
    }
  }, [
    selectedModel?.id,
    selectedProvider,
    messagesWithPrompt,
    serviceHub,
    selectedModel?.settings?.ctx_len?.controller_props?.value,
  ])

  // Debounced effect that triggers when prompt or messages change
  useEffect(() => {
    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    // Skip calculation if we're currently increasing context size
    if (isIncreasingContextSize.current) {
      return
    }

    // Only calculate if we have messages or a prompt
    if (
      messagesWithPrompt.length > 0 &&
      selectedProvider === 'llamacpp' &&
      selectedModel?.id
    ) {
      debounceTimeoutRef.current = setTimeout(() => {
        debouncedCalculateTokens()
      }, 500) // 500ms debounce
    } else {
      // Reset immediately if no content
      setTokenData({
        tokenCount: 0,
        loading: false,
        isNearLimit: false,
      })
    }

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
    }
  }, [
    prompt,
    messages.length,
    selectedModel?.id,
    selectedProvider,
    messagesWithPrompt.length,
    debouncedCalculateTokens,
  ])

  // Manual calculation function (for click events)
  const calculateTokens = useCallback(async () => {
    // Trigger the debounced calculation immediately
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }
    await debouncedCalculateTokens()
  }, [debouncedCalculateTokens])

  const calculateTokensForImages = useCallback((images: File[]): number => {
    // Estimation for vision tokens - this is a rough calculation
    // Based on common vision models that use ~765 tokens per image
    return images.length * 765
  }, [])

  return {
    ...tokenData,
    calculateTokens,
    calculateTokensForImages,
  }
}
