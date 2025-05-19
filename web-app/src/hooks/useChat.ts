import { useCallback, useMemo } from 'react'
import { usePrompt } from './usePrompt'
import { useModelProvider } from './useModelProvider'
import { useThreads } from './useThreads'
import { useAppState } from './useAppState'
import { useMessages } from './useMessages'
import { useRouter } from '@tanstack/react-router'
import { defaultModel } from '@/lib/models'
import { route } from '@/constants/routes'
import {
  emptyThreadContent,
  extractToolCall,
  newAssistantThreadContent,
  newUserThreadContent,
  postMessageProcessing,
  sendCompletion,
  startModel,
} from '@/lib/completion'
import { CompletionMessagesBuilder } from '@/lib/messages'
import { ChatCompletionMessageToolCall } from 'openai/resources'

export const useChat = () => {
  const { prompt, setPrompt } = usePrompt()
  const { tools } = useAppState()

  const { getProviderByName, selectedModel, selectedProvider } =
    useModelProvider()

  const { getCurrentThread: retrieveThread, createThread } = useThreads()
  const { updateStreamingContent, updateLoadingModel } = useAppState()
  const { addMessage } = useMessages()
  const router = useRouter()

  const provider = useMemo(() => {
    return getProviderByName(selectedProvider)
  }, [selectedProvider, getProviderByName])
  const getCurrentThread = useCallback(async () => {
    let currentThread = retrieveThread()
    if (!currentThread) {
      currentThread = await createThread(
        {
          id: selectedModel?.id ?? defaultModel(selectedProvider),
          provider: selectedProvider,
        },
        prompt
      )
      router.navigate({
        to: route.threadsDetail,
        params: { threadId: currentThread.id },
      })
    }
    return currentThread
  }, [
    createThread,
    prompt,
    retrieveThread,
    router,
    selectedModel?.id,
    selectedProvider,
  ])

  const sendMessage = useCallback(
    async (message: string) => {
      const activeThread = await getCurrentThread()

      if (!activeThread || !provider) return

      updateStreamingContent(emptyThreadContent)
      addMessage(newUserThreadContent(activeThread.id, message))
      setPrompt('')
      try {
        if (selectedModel?.id) {
          updateLoadingModel(true)
          await startModel(provider.provider, selectedModel.id).catch(
            console.error
          )
          updateLoadingModel(false)
        }

        const builder = new CompletionMessagesBuilder()
        // REMARK: Would it possible to not attach the entire message history to the request?
        // TODO: If not amend messages history here
        builder.addUserMessage(message)

        let isCompleted = false

        while (!isCompleted) {
          const completion = await sendCompletion(
            activeThread,
            provider,
            builder.getMessages(),
            tools
          )

          if (!completion) throw new Error('No completion received')
          let accumulatedText = ''
          const currentCall: ChatCompletionMessageToolCall | null = null
          const toolCalls: ChatCompletionMessageToolCall[] = []
          for await (const part of completion) {
            const delta = part.choices[0]?.delta?.content || ''
            if (part.choices[0]?.delta?.tool_calls) {
              extractToolCall(part, currentCall, toolCalls)
            }
            if (delta) {
              accumulatedText += delta
              // Create a new object each time to avoid reference issues
              // Use a timeout to prevent React from batching updates too quickly
              const currentContent = newAssistantThreadContent(
                activeThread.id,
                accumulatedText
              )
              updateStreamingContent(currentContent)
              await new Promise((resolve) => setTimeout(resolve, 0))
            }
          }
          // Create a final content object for adding to the thread
          const finalContent = newAssistantThreadContent(
            activeThread.id,
            accumulatedText
          )
          builder.addAssistantMessage(accumulatedText, undefined, toolCalls)
          const updatedMessage = await postMessageProcessing(
            toolCalls,
            builder,
            finalContent
          )
          addMessage(updatedMessage ?? finalContent)

          isCompleted = !toolCalls.length
        }
      } catch (error) {
        console.error('Error sending message:', error)
      }
      updateStreamingContent(undefined)
    },
    [
      getCurrentThread,
      provider,
      updateStreamingContent,
      addMessage,
      setPrompt,
      selectedModel,
      tools,
      updateLoadingModel,
    ]
  )

  return { sendMessage }
}
