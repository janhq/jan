/* eslint-disable react-hooks/refs */
import { CustomChatTransport } from '@/lib/custom-chat-transport'
import { useCapabilities } from '@/stores/capabilities-store'
import {
  type UIMessage,
  type UseChatOptions,
  useChat as useChatSDK,
} from '@ai-sdk/react'
import { type ChatInit, type LanguageModel } from 'ai'
import { useEffect, useRef } from 'react'

type CustomChatOptions = Omit<ChatInit<UIMessage>, 'transport'> &
  Pick<UseChatOptions<UIMessage>, 'experimental_throttle' | 'resume'>

// This is a wrapper around the AI SDK's useChat hook
// It implements model switching and uses the custom chat transport,
// making a nice reusable hook for chat functionality.
export function useChat(model: LanguageModel, options?: CustomChatOptions) {
  const transportRef = useRef<CustomChatTransport | null>(null) // Using a ref here so we can update the model used in the transport without having to reload the page or recreate the transport
  const searchEnabled = useCapabilities((state) => state.searchEnabled)
  const deepResearchEnabled = useCapabilities((state) => state.deepResearchEnabled)
  if (!transportRef.current) {
    transportRef.current = new CustomChatTransport(model, searchEnabled || deepResearchEnabled)
  }

  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.updateModel(model)
    }
  }, [model])

  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.updateToolEnabled(searchEnabled || deepResearchEnabled)
    }
  }, [searchEnabled, deepResearchEnabled])

  const chatResult = useChatSDK({
    transport: transportRef.current,
    ...options,
  })

  return chatResult
}
