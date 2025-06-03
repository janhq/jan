import { useCallback, useEffect, useMemo } from 'react'
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
  isCompletionResponse,
  newAssistantThreadContent,
  newUserThreadContent,
  postMessageProcessing,
  sendCompletion,
} from '@/lib/completion'
import { CompletionMessagesBuilder } from '@/lib/messages'
import { ChatCompletionMessageToolCall } from 'openai/resources'
import { useAssistant } from './useAssistant'
import { toast } from 'sonner'
import { getTools } from '@/services/mcp'
import { MCPTool } from '@/types/completion'
import { listen } from '@tauri-apps/api/event'
import { SystemEvent } from '@/types/events'
import { stopModel, startModel } from '@/services/models'

import { useToolApproval } from '@/hooks/useToolApproval'
import { useToolAvailable } from '@/hooks/useToolAvailable'

export const useChat = () => {
  const { prompt, setPrompt } = usePrompt()
  const {
    tools,
    updateTokenSpeed,
    resetTokenSpeed,
    updateTools,
    updateStreamingContent,
    updateLoadingModel,
    setAbortController,
  } = useAppState()
  const { currentAssistant } = useAssistant()

  const { approvedTools, showApprovalModal, allowAllMCPPermissions } =
    useToolApproval()
  const { getDisabledToolsForThread } = useToolAvailable()

  const { getProviderByName, selectedModel, selectedProvider } =
    useModelProvider()

  const {
    getCurrentThread: retrieveThread,
    createThread,
    updateThreadTimestamp,
  } = useThreads()
  const { getMessages, addMessage } = useMessages()
  const router = useRouter()

  const provider = useMemo(() => {
    return getProviderByName(selectedProvider)
  }, [selectedProvider, getProviderByName])

  const currentProviderId = useMemo(() => {
    return provider?.provider || selectedProvider
  }, [provider, selectedProvider])

  useEffect(() => {
    function setTools() {
      getTools().then((data: MCPTool[]) => {
        updateTools(data)
      })
    }
    setTools()

    let unsubscribe = () => { }
    listen(SystemEvent.MCP_UPDATE, setTools).then((unsub) => {
      // Unsubscribe from the event when the component unmounts
      unsubscribe = unsub
    })
    return unsubscribe
  }, [updateTools])

  const getCurrentThread = useCallback(async () => {
    let currentThread = retrieveThread()
    if (!currentThread) {
      currentThread = await createThread(
        {
          id: selectedModel?.id ?? defaultModel(selectedProvider),
          provider: selectedProvider,
        },
        prompt,
        currentAssistant
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
    currentAssistant,
  ])

  const sendMessage = useCallback(
    async (message: string, uploadedFiles?: Array<{
      name: string
      type: string
      size: number
      base64: string
      dataUrl: string
    }>) => {
      const activeThread = await getCurrentThread()

      resetTokenSpeed()
      const activeProvider = currentProviderId
        ? getProviderByName(currentProviderId)
        : provider
      if (!activeThread || !activeProvider) return
      const messages = getMessages(activeThread.id)
      const abortController = new AbortController()
      setAbortController(activeThread.id, abortController)
      updateStreamingContent(emptyThreadContent)

      // Create user message
      const userMessage = newUserThreadContent(activeThread.id, message)
      addMessage(userMessage)
      updateThreadTimestamp(activeThread.id)
      setPrompt('')

      try {

        if (selectedModel?.id) {
          updateLoadingModel(true)
          await startModel(
            activeProvider,
            selectedModel.id,
            abortController
          ).catch(console.error)
          updateLoadingModel(false)
        }

        const builder = new CompletionMessagesBuilder(
          messages,
          currentAssistant?.instructions
        )

        // Add user message or file content to builder
        if (uploadedFiles && uploadedFiles.length > 0) {
          const file = uploadedFiles[0] // Process first file for now
          builder.addFileContent(message, {
            file_data: file.base64,
            filename: file.name
          })
        } else {
          builder.addUserMessage(message)
        }

        let isCompleted = false

        // Filter tools based on model capabilities and available tools for this thread
        let availableTools = selectedModel?.capabilities?.includes('tools')
          ? tools.filter((tool) => {
              const disabledTools = getDisabledToolsForThread(activeThread.id)
              return !disabledTools.includes(tool.name)
            })
          : []

        // TODO: Later replaced by Agent setup?
        const followUpWithToolUse = true
        while (!isCompleted && !abortController.signal.aborted) {
          const completion = await sendCompletion(
            activeThread,
            activeProvider,
            builder.getMessages(),
            abortController,
            availableTools,
            currentAssistant.parameters?.stream === false ? false : true,
            currentAssistant.parameters as unknown as Record<string, object>
            // TODO: replace it with according provider setting later on
            // selectedProvider === 'llama.cpp' && availableTools.length > 0
            //   ? false
            //   : true
          )

          if (!completion) throw new Error('No completion received')
          let accumulatedText = ''
          const currentCall: ChatCompletionMessageToolCall | null = null
          const toolCalls: ChatCompletionMessageToolCall[] = []
          if (isCompletionResponse(completion)) {
            accumulatedText = completion.choices[0]?.message?.content || ''
            if (completion.choices[0]?.message?.tool_calls) {
              toolCalls.push(...completion.choices[0].message.tool_calls)
            }
          } else {
            for await (const part of completion) {
              const delta = part.choices[0]?.delta?.content || ''

              if (part.choices[0]?.delta?.tool_calls) {
                const calls = extractToolCall(part, currentCall, toolCalls)
                const currentContent = newAssistantThreadContent(
                  activeThread.id,
                  accumulatedText,
                  {
                    tool_calls: calls.map((e) => ({
                      ...e,
                      state: 'pending',
                    })),
                  }
                )
                updateStreamingContent(currentContent)
                await new Promise((resolve) => setTimeout(resolve, 0))
              }
              if (delta) {
                accumulatedText += delta
                // Create a new object each time to avoid reference issues
                // Use a timeout to prevent React from batching updates too quickly
                const currentContent = newAssistantThreadContent(
                  activeThread.id,
                  accumulatedText,
                  {
                    tool_calls: toolCalls.map((e) => ({
                      ...e,
                      state: 'pending',
                    })),
                  }
                )
                updateStreamingContent(currentContent)
                updateTokenSpeed(currentContent)
                await new Promise((resolve) => setTimeout(resolve, 0))
              }
            }
          }
          // TODO: Remove this check when integrating new llama.cpp extension
          if (
            accumulatedText.length === 0 &&
            toolCalls.length === 0 &&
            activeThread.model?.id &&
            activeProvider.provider === 'llama.cpp'
          ) {
            await stopModel(activeThread.model.id, 'cortex')
            throw new Error('No response received from the model')
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
            finalContent,
            abortController,
            approvedTools,
            allowAllMCPPermissions ? undefined : showApprovalModal,
            allowAllMCPPermissions
          )
          addMessage(updatedMessage ?? finalContent)
          updateStreamingContent(emptyThreadContent)
          updateThreadTimestamp(activeThread.id)

          isCompleted = !toolCalls.length
          // Do not create agent loop if there is no need for it
          if (!followUpWithToolUse) availableTools = []
        }
      } catch (error) {
        toast.error(
          `Error sending message: ${error && typeof error === 'object' && 'message' in error ? error.message : error}`
        )
        console.error('Error sending message:', error)
      } finally {
        updateLoadingModel(false)
        updateStreamingContent(undefined)
      }
    },
    [
      getCurrentThread,
      resetTokenSpeed,
      currentProviderId,
      getProviderByName,
      provider,
      getMessages,
      setAbortController,
      updateStreamingContent,
      addMessage,
      updateThreadTimestamp,
      setPrompt,
      selectedModel?.id,
      selectedModel?.capabilities,
      currentAssistant,
      tools,
      updateLoadingModel,
      getDisabledToolsForThread,
      approvedTools,
      allowAllMCPPermissions,
      showApprovalModal,
      updateTokenSpeed,
    ]
  )

  return { sendMessage }
}
