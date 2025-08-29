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
  isCompletionResponse,
  newAssistantThreadContent,
  newUserThreadContent,
  postMessageProcessing,
  sendCompletion,
} from '@/lib/completion'
import { CompletionMessagesBuilder } from '@/lib/messages'
import { renderInstructions } from '@/lib/instructionTemplate'
import { ChatCompletionMessageToolCall } from 'openai/resources'
import { useAssistant } from './useAssistant'

import { useServiceHub } from '@/hooks/useServiceHub'
import { useToolApproval } from '@/hooks/useToolApproval'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { OUT_OF_CONTEXT_SIZE } from '@/utils/error'
import { useContextSizeApproval } from './useModelContextApproval'
import { useModelLoad } from './useModelLoad'
import {
  ReasoningProcessor,
  extractReasoningFromMessage,
} from '@/utils/reasoning'

export const useChat = () => {
  const { prompt, setPrompt } = usePrompt()
  const {
    tools,
    updateTokenSpeed,
    resetTokenSpeed,
    updateStreamingContent,
    updateLoadingModel,
    setAbortController,
  } = useAppState()
  const { assistants, currentAssistant } = useAssistant()
  const { updateProvider } = useModelProvider()
  const serviceHub = useServiceHub()

  const { approvedTools, showApprovalModal, allowAllMCPPermissions } =
    useToolApproval()
  const { showApprovalModal: showIncreaseContextSizeModal } =
    useContextSizeApproval()
  const { getDisabledToolsForThread } = useToolAvailable()

  const { getProviderByName, selectedModel, selectedProvider } =
    useModelProvider()

  const {
    getCurrentThread: retrieveThread,
    createThread,
    updateThreadTimestamp,
  } = useThreads()
  const { getMessages, addMessage } = useMessages()
  const { setModelLoadError } = useModelLoad()
  const router = useRouter()

  const provider = useMemo(() => {
    return getProviderByName(selectedProvider)
  }, [selectedProvider, getProviderByName])

  const currentProviderId = useMemo(() => {
    return provider?.provider || selectedProvider
  }, [provider, selectedProvider])

  const selectedAssistant =
    assistants.find((a) => a.id === currentAssistant.id) || assistants[0]

  const getCurrentThread = useCallback(async () => {
    let currentThread = retrieveThread()

    if (!currentThread) {
      currentThread = await createThread(
        {
          id: selectedModel?.id ?? defaultModel(selectedProvider),
          provider: selectedProvider,
        },
        prompt,
        selectedAssistant
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
    selectedAssistant,
  ])

  const restartModel = useCallback(
    async (provider: ProviderObject, modelId: string) => {
      await serviceHub.models().stopAllModels()
      await new Promise((resolve) => setTimeout(resolve, 1000))
      updateLoadingModel(true)
      await serviceHub.models().startModel(provider, modelId).catch(console.error)
      updateLoadingModel(false)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    },
    [updateLoadingModel, serviceHub]
  )

  const increaseModelContextSize = useCallback(
    async (modelId: string, provider: ProviderObject) => {
      /**
       * Should increase the context size of the model by 2x
       * If the context size is not set or too low, it defaults to 8192.
       */
      const model = provider.models.find((m) => m.id === modelId)
      if (!model) return undefined
      const ctxSize = Math.max(
        model.settings?.ctx_len?.controller_props.value
          ? typeof model.settings.ctx_len.controller_props.value === 'string'
            ? parseInt(model.settings.ctx_len.controller_props.value as string)
            : (model.settings.ctx_len.controller_props.value as number)
          : 16384,
        16384
      )
      const updatedModel = {
        ...model,
        settings: {
          ...model.settings,
          ctx_len: {
            ...(model.settings?.ctx_len != null ? model.settings?.ctx_len : {}),
            controller_props: {
              ...(model.settings?.ctx_len?.controller_props ?? {}),
              value: ctxSize * 2,
            },
          },
        },
      }

      // Find the model index in the provider's models array
      const modelIndex = provider.models.findIndex((m) => m.id === model.id)

      if (modelIndex !== -1) {
        // Create a copy of the provider's models array
        const updatedModels = [...provider.models]

        // Update the specific model in the array
        updatedModels[modelIndex] = updatedModel as Model

        // Update the provider with the new models array
        updateProvider(provider.provider, {
          models: updatedModels,
        })
      }
      const updatedProvider = getProviderByName(provider.provider)
      if (updatedProvider) await restartModel(updatedProvider, model.id)

      return updatedProvider
    },
    [getProviderByName, restartModel, updateProvider]
  )
  const toggleOnContextShifting = useCallback(
    async (modelId: string, provider: ProviderObject) => {
      const providerName = provider.provider
      const newSettings = [...provider.settings]
      const settingKey = 'ctx_shift'
      // Handle different value types by forcing the type
      // Use type assertion to bypass type checking
      const settingIndex = provider.settings.findIndex(
        (s) => s.key === settingKey
      )
      ;(
        newSettings[settingIndex].controller_props as {
          value: string | boolean | number
        }
      ).value = true

      // Create update object with updated settings
      const updateObj: Partial<ModelProvider> = {
        settings: newSettings,
      }

      await serviceHub.providers().updateSettings(providerName, updateObj.settings ?? [])
      updateProvider(providerName, {
        ...provider,
        ...updateObj,
      })
      const updatedProvider = getProviderByName(providerName)
      if (updatedProvider) await restartModel(updatedProvider, modelId)
      return updatedProvider
    },
    [updateProvider, getProviderByName, restartModel, serviceHub]
  )

  const sendMessage = useCallback(
    async (
      message: string,
      troubleshooting = true,
      attachments?: Array<{
        name: string
        type: string
        size: number
        base64: string
        dataUrl: string
      }>
    ) => {
      const activeThread = await getCurrentThread()

      resetTokenSpeed()
      let activeProvider = currentProviderId
        ? getProviderByName(currentProviderId)
        : provider
      if (!activeThread || !activeProvider) return
      const messages = getMessages(activeThread.id)
      const abortController = new AbortController()
      setAbortController(activeThread.id, abortController)
      updateStreamingContent(emptyThreadContent)
      // Do not add new message on retry
      if (troubleshooting)
        addMessage(newUserThreadContent(activeThread.id, message, attachments))
      updateThreadTimestamp(activeThread.id)
      setPrompt('')
      try {
        if (selectedModel?.id) {
          updateLoadingModel(true)
          await serviceHub.models().startModel(activeProvider, selectedModel.id)
          updateLoadingModel(false)
        }

        const builder = new CompletionMessagesBuilder(
          messages,
          renderInstructions(currentAssistant?.instructions)
        )
        if (troubleshooting) builder.addUserMessage(message, attachments)

        let isCompleted = false

        // Filter tools based on model capabilities and available tools for this thread
        let availableTools = selectedModel?.capabilities?.includes('tools')
          ? tools.filter((tool) => {
              const disabledTools = getDisabledToolsForThread(activeThread.id)
              return !disabledTools.includes(tool.name)
            })
          : []

        let assistantLoopSteps = 0

        while (
          !isCompleted &&
          !abortController.signal.aborted &&
          activeProvider
        ) {
          const modelConfig = activeProvider.models.find(
            (m) => m.id === selectedModel?.id
          )
          assistantLoopSteps += 1

          const modelSettings = modelConfig?.settings
            ? Object.fromEntries(
                Object.entries(modelConfig.settings)
                  .filter(
                    ([key, value]) =>
                      key !== 'ctx_len' &&
                      key !== 'ngl' &&
                      value.controller_props?.value !== undefined &&
                      value.controller_props?.value !== null &&
                      value.controller_props?.value !== ''
                  )
                  .map(([key, value]) => [key, value.controller_props?.value])
              )
            : undefined

          const completion = await sendCompletion(
            activeThread,
            activeProvider,
            builder.getMessages(),
            abortController,
            availableTools,
            currentAssistant.parameters?.stream === false ? false : true,
            {
              ...modelSettings,
              ...currentAssistant.parameters,
            } as unknown as Record<string, object>
          )

          if (!completion) throw new Error('No completion received')
          let accumulatedText = ''
          const currentCall: ChatCompletionMessageToolCall | null = null
          const toolCalls: ChatCompletionMessageToolCall[] = []
          try {
            if (isCompletionResponse(completion)) {
              const message = completion.choices[0]?.message
              accumulatedText = (message?.content as string) || ''

              // Handle reasoning field if there is one
              const reasoning = extractReasoningFromMessage(message)
              if (reasoning) {
                accumulatedText =
                  `<think>${reasoning}</think>` + accumulatedText
              }

              if (message?.tool_calls) {
                toolCalls.push(...message.tool_calls)
              }
            } else {
              // High-throughput scheduler: batch UI updates on rAF (requestAnimationFrame)
              let rafScheduled = false
              let rafHandle: number | undefined
              let pendingDeltaCount = 0
              const reasoningProcessor = new ReasoningProcessor()
              const scheduleFlush = () => {
                if (rafScheduled || abortController.signal.aborted) return
                rafScheduled = true
                const doSchedule = (cb: () => void) => {
                  if (typeof requestAnimationFrame !== 'undefined') {
                    rafHandle = requestAnimationFrame(() => cb())
                  } else {
                    // Fallback for non-browser test environments
                    const t = setTimeout(() => cb(), 0) as unknown as number
                    rafHandle = t
                  }
                }
                doSchedule(() => {
                  // Check abort status before executing the scheduled callback
                  if (abortController.signal.aborted) {
                    rafScheduled = false
                    return
                  }

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
                  if (pendingDeltaCount > 0) {
                    updateTokenSpeed(currentContent, pendingDeltaCount)
                  }
                  pendingDeltaCount = 0
                  rafScheduled = false
                })
              }
              const flushIfPending = () => {
                if (!rafScheduled) return
                if (
                  typeof cancelAnimationFrame !== 'undefined' &&
                  rafHandle !== undefined
                ) {
                  cancelAnimationFrame(rafHandle)
                } else if (rafHandle !== undefined) {
                  clearTimeout(rafHandle)
                }
                // Do an immediate flush
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
                if (pendingDeltaCount > 0) {
                  updateTokenSpeed(currentContent, pendingDeltaCount)
                }
                pendingDeltaCount = 0
                rafScheduled = false
              }
              try {
                for await (const part of completion) {
                  // Check if aborted before processing each part
                  if (abortController.signal.aborted) {
                    break
                  }

                  // Error message
                  if (!part.choices) {
                    throw new Error(
                      'message' in part
                        ? (part.message as string)
                        : (JSON.stringify(part) ?? '')
                    )
                  }

                  if (part.choices[0]?.delta?.tool_calls) {
                    extractToolCall(part, currentCall, toolCalls)
                    // Schedule a flush to reflect tool update
                    scheduleFlush()
                  }
                  const deltaReasoning =
                    reasoningProcessor.processReasoningChunk(part)
                  if (deltaReasoning) {
                    accumulatedText += deltaReasoning
                    pendingDeltaCount += 1
                    // Schedule flush for reasoning updates
                    scheduleFlush()
                  }
                  const deltaContent = part.choices[0]?.delta?.content || ''
                  if (deltaContent) {
                    accumulatedText += deltaContent
                    pendingDeltaCount += 1
                    // Batch UI update on next animation frame
                    scheduleFlush()
                  }
                }
              } finally {
                // Always clean up scheduled RAF when stream ends (either normally or via abort)
                if (rafHandle !== undefined) {
                  if (typeof cancelAnimationFrame !== 'undefined') {
                    cancelAnimationFrame(rafHandle)
                  } else {
                    clearTimeout(rafHandle)
                  }
                  rafHandle = undefined
                  rafScheduled = false
                }

                // Only finalize and flush if not aborted
                if (!abortController.signal.aborted) {
                  // Finalize reasoning (close any open think tags)
                  accumulatedText += reasoningProcessor.finalize()
                  // Ensure any pending buffered content is rendered at the end
                  flushIfPending()
                }
              }
            }
          } catch (error) {
            const errorMessage =
              error && typeof error === 'object' && 'message' in error
                ? error.message
                : error
            if (
              typeof errorMessage === 'string' &&
              errorMessage.includes(OUT_OF_CONTEXT_SIZE) &&
              selectedModel
            ) {
              const method = await showIncreaseContextSizeModal()
              if (method === 'ctx_len') {
                /// Increase context size
                activeProvider = await increaseModelContextSize(
                  selectedModel.id,
                  activeProvider
                )
                continue
              } else if (method === 'context_shift' && selectedModel?.id) {
                /// Enable context_shift
                activeProvider = await toggleOnContextShifting(
                  selectedModel?.id,
                  activeProvider
                )
                continue
              } else throw error
            } else {
              throw error
            }
          }
          // TODO: Remove this check when integrating new llama.cpp extension
          if (
            accumulatedText.length === 0 &&
            toolCalls.length === 0 &&
            activeThread.model?.id &&
            provider?.provider === 'llamacpp'
          ) {
            await serviceHub.models().stopModel(activeThread.model.id, 'llamacpp')
            throw new Error('No response received from the model')
          }

          // Create a final content object for adding to the thread
          const finalContent = newAssistantThreadContent(
            activeThread.id,
            accumulatedText,
            {
              tokenSpeed: useAppState.getState().tokenSpeed,
              assistant: currentAssistant,
            }
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
          // Check if assistant loop steps are within limits
          if (assistantLoopSteps >= (currentAssistant?.tool_steps ?? 20)) {
            // Stop the assistant tool call if it exceeds the maximum steps
            availableTools = []
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          if (error && typeof error === 'object' && 'message' in error) {
            setModelLoadError(error as ErrorObject)
          } else {
            setModelLoadError(`${error}`)
          }
        }
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
      selectedModel,
      currentAssistant,
      tools,
      updateLoadingModel,
      getDisabledToolsForThread,
      approvedTools,
      allowAllMCPPermissions,
      showApprovalModal,
      updateTokenSpeed,
      showIncreaseContextSizeModal,
      increaseModelContextSize,
      toggleOnContextShifting,
      setModelLoadError,
      serviceHub,
    ]
  )

  return { sendMessage }
}
