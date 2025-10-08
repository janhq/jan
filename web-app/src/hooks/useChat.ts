import { useCallback, useMemo } from 'react'
import { flushSync } from 'react-dom'
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
import {
  ChatCompletionMessageToolCall,
  CompletionUsage,
} from 'openai/resources'

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
import { useAssistant } from './useAssistant'
import { useShallow } from 'zustand/shallow'
import { TEMPORARY_CHAT_QUERY_ID, TEMPORARY_CHAT_ID } from '@/constants/chat'
import { toast } from 'sonner'
import { Attachment } from '@/types/attachment'

export const useChat = () => {
  const [
    updateTokenSpeed,
    resetTokenSpeed,
    updateStreamingContent,
    updateLoadingModel,
    setAbortController,
    setTokenSpeed,
  ] = useAppState(
    useShallow((state) => [
      state.updateTokenSpeed,
      state.resetTokenSpeed,
      state.updateStreamingContent,
      state.updateLoadingModel,
      state.setAbortController,
      state.setTokenSpeed,
    ])
  )
  const updatePromptProgress = useAppState(
    (state) => state.updatePromptProgress
  )

  const updateProvider = useModelProvider((state) => state.updateProvider)
  const serviceHub = useServiceHub()

  const showApprovalModal = useToolApproval((state) => state.showApprovalModal)
  const allowAllMCPPermissions = useToolApproval(
    (state) => state.allowAllMCPPermissions
  )
  const showIncreaseContextSizeModal = useContextSizeApproval(
    (state) => state.showApprovalModal
  )
  const getDisabledToolsForThread = useToolAvailable(
    (state) => state.getDisabledToolsForThread
  )

  const getProviderByName = useModelProvider((state) => state.getProviderByName)

  const [createThread, retrieveThread, updateThreadTimestamp] = useThreads(
    useShallow((state) => [
      state.createThread,
      state.getCurrentThread,
      state.updateThreadTimestamp,
    ])
  )

  const getMessages = useMessages((state) => state.getMessages)
  const addMessage = useMessages((state) => state.addMessage)
  const setMessages = useMessages((state) => state.setMessages)
  const setModelLoadError = useModelLoad((state) => state.setModelLoadError)
  const router = useRouter()

  const getCurrentThread = useCallback(async (projectId?: string) => {
    let currentThread = retrieveThread()

    // Check if we're in temporary chat mode
    const isTemporaryMode = window.location.search.includes(`${TEMPORARY_CHAT_QUERY_ID}=true`)

    // Clear messages for existing temporary thread on reload to ensure fresh start
    if (isTemporaryMode && currentThread?.id === TEMPORARY_CHAT_ID) {
      setMessages(TEMPORARY_CHAT_ID, [])
    }

    if (!currentThread) {
      // Get prompt directly from store when needed
      const currentPrompt = usePrompt.getState().prompt
      const currentAssistant = useAssistant.getState().currentAssistant
      const assistants = useAssistant.getState().assistants
      const selectedModel = useModelProvider.getState().selectedModel
      const selectedProvider = useModelProvider.getState().selectedProvider

      // Get project metadata if projectId is provided
      let projectMetadata: { id: string; name: string; updated_at: number } | undefined
      if (projectId) {
        const project = await serviceHub.projects().getProjectById(projectId)
        if (project) {
          projectMetadata = {
            id: project.id,
            name: project.name,
            updated_at: project.updated_at,
          }
        }
      }

      currentThread = await createThread(
        {
          id: selectedModel?.id ?? defaultModel(selectedProvider),
          provider: selectedProvider,
        },
        isTemporaryMode ? 'Temporary Chat' : currentPrompt,
        assistants.find((a) => a.id === currentAssistant?.id) || assistants[0],
        projectMetadata,
        isTemporaryMode // pass temporary flag
      )

      // Clear messages for temporary chat to ensure fresh start on reload
      if (isTemporaryMode && currentThread?.id === TEMPORARY_CHAT_ID) {
        setMessages(TEMPORARY_CHAT_ID, [])
      }

      // Set flag for temporary chat navigation
      if (currentThread.id === TEMPORARY_CHAT_ID) {
        sessionStorage.setItem('temp-chat-nav', 'true')
      }

      router.navigate({
        to: route.threadsDetail,
        params: { threadId: currentThread.id },
      })
    }
    return currentThread
  }, [createThread, retrieveThread, router, setMessages, serviceHub])

  const restartModel = useCallback(
    async (provider: ProviderObject, modelId: string) => {
      await serviceHub.models().stopAllModels()
      await new Promise((resolve) => setTimeout(resolve, 1000))
      updateLoadingModel(true)
      await serviceHub
        .models()
        .startModel(provider, modelId)
        .catch(console.error)
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

      await serviceHub
        .providers()
        .updateSettings(providerName, updateObj.settings ?? [])
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
      attachments?: Attachment[],
      projectId?: string,
      updateAttachmentProcessing?: (
        fileName: string,
        status: 'processing' | 'done' | 'error' | 'clear_docs' | 'clear_all'
      ) => void
    ) => {
      const activeThread = await getCurrentThread(projectId)
      const selectedProvider = useModelProvider.getState().selectedProvider
      let activeProvider = getProviderByName(selectedProvider)

      resetTokenSpeed()
      if (!activeThread || !activeProvider) return

      // Separate images and documents
      const images = attachments?.filter((a) => a.type === 'image') || []
      const documents = attachments?.filter((a) => a.type === 'document') || []

      // Process attachments BEFORE sending
      const processedAttachments: Attachment[] = []

      // 1) Images ingestion (placeholder/no-op for now)
      // Track attachment ingestion; all must succeed before sending

      if (images.length > 0) {
        for (const img of images) {
          try {
            // Skip if already processed (ingested in ChatInput when thread existed)
            if (img.processed && img.id) {
              processedAttachments.push(img)
              continue
            }

            if (updateAttachmentProcessing) {
              updateAttachmentProcessing(img.name, 'processing')
            }
            // Upload image, get id/URL
            const res = await serviceHub.uploads().ingestImage(activeThread.id, img)
            processedAttachments.push({
              ...img,
              id: res.id,
              processed: true,
              processing: false,
            })
            if (updateAttachmentProcessing) {
              updateAttachmentProcessing(img.name, 'done')
            }
          } catch (err) {
            console.error(`Failed to ingest image ${img.name}:`, err)
            if (updateAttachmentProcessing) {
              updateAttachmentProcessing(img.name, 'error')
            }
            const desc = err instanceof Error ? err.message : String(err)
            toast.error('Failed to ingest image attachment', { description: desc })
            return
          }
        }
      }

      if (documents.length > 0) {
        try {
          for (const doc of documents) {
            // Skip if already processed (ingested in ChatInput when thread existed)
            if (doc.processed && doc.id) {
              processedAttachments.push(doc)
              continue
            }

            // Update UI to show spinner on this file
            if (updateAttachmentProcessing) {
              updateAttachmentProcessing(doc.name, 'processing')
            }

            try {
              const res = await serviceHub
                .uploads()
                .ingestFileAttachment(activeThread.id, doc)

              // Add processed document with ID
              processedAttachments.push({
                ...doc,
                id: res.id,
                size: res.size ?? doc.size,
                chunkCount: res.chunkCount ?? doc.chunkCount,
                processing: false,
                processed: true,
              })

              // Update UI to show done state
              if (updateAttachmentProcessing) {
                updateAttachmentProcessing(doc.name, 'done')
              }
            } catch (err) {
              console.error(`Failed to ingest ${doc.name}:`, err)
              if (updateAttachmentProcessing) {
                updateAttachmentProcessing(doc.name, 'error')
              }
              throw err // Re-throw to handle in outer catch
            }
          }
        } catch (err) {
          console.error('Failed to ingest documents:', err)
          const desc = err instanceof Error ? err.message : String(err)
          toast.error('Failed to index attachments', { description: desc })
          // Don't continue with message send if ingestion failed
          return
        }
      }

      // All attachments prepared successfully

      const messages = getMessages(activeThread.id)
      const abortController = new AbortController()
      setAbortController(activeThread.id, abortController)
      updateStreamingContent(emptyThreadContent)
      updatePromptProgress(undefined)
      // Do not add new message on retry
      // All attachments (images + docs) ingested successfully.
      // Build the user content once; use it for both the outbound request
      // and persisting to the store so both are identical.
      if (updateAttachmentProcessing) {
        updateAttachmentProcessing('__CLEAR_ALL__' as any, 'clear_all')
      }
      const userContent = newUserThreadContent(
        activeThread.id,
        message,
        processedAttachments
      )
      if (troubleshooting) {
        addMessage(userContent)
      }
      updateThreadTimestamp(activeThread.id)
      usePrompt.getState().setPrompt('')
      const selectedModel = useModelProvider.getState().selectedModel
      try {
        if (selectedModel?.id) {
          updateLoadingModel(true)
          await serviceHub.models().startModel(activeProvider, selectedModel.id)
          updateLoadingModel(false)
        }
        const currentAssistant = useAssistant.getState().currentAssistant
        const builder = new CompletionMessagesBuilder(
          messages,
          currentAssistant
            ? renderInstructions(currentAssistant.instructions)
            : undefined
        )
        // Using addUserMessage to respect legacy code. Should be using the userContent above.
        if (troubleshooting) builder.addUserMessage(userContent)

        let isCompleted = false

        // Filter tools based on model capabilities and available tools for this thread
        let availableTools = selectedModel?.capabilities?.includes('tools')
          ? useAppState.getState().tools.filter((tool) => {
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
            currentAssistant?.parameters?.stream === false ? false : true,
            {
              ...modelSettings,
              ...(currentAssistant?.parameters || {}),
            } as unknown as Record<string, object>
          )

          if (!completion) throw new Error('No completion received')
          let accumulatedText = ''
          const currentCall: ChatCompletionMessageToolCall | null = null
          const toolCalls: ChatCompletionMessageToolCall[] = []
          const timeToFirstToken = Date.now()
          let tokenUsage: CompletionUsage | undefined = undefined
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
              if ('usage' in completion) {
                tokenUsage = completion.usage
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
                  if (tokenUsage) {
                    setTokenSpeed(
                      currentContent,
                      tokenUsage.completion_tokens /
                        Math.max((Date.now() - timeToFirstToken) / 1000, 1),
                      tokenUsage.completion_tokens
                    )
                  } else if (pendingDeltaCount > 0) {
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
                if (tokenUsage) {
                  setTokenSpeed(
                    currentContent,
                    tokenUsage.completion_tokens /
                      Math.max((Date.now() - timeToFirstToken) / 1000, 1),
                    tokenUsage.completion_tokens
                  )
                } else if (pendingDeltaCount > 0) {
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

                  // Handle prompt progress if available
                  if ('prompt_progress' in part && part.prompt_progress) {
                    // Force immediate state update to ensure we see intermediate values
                    flushSync(() => {
                      updatePromptProgress(part.prompt_progress)
                    })
                    // Add a small delay to make progress visible
                    await new Promise((resolve) => setTimeout(resolve, 100))
                  }

                  // Error message
                  if (!part.choices) {
                    throw new Error(
                      'message' in part
                        ? (part.message as string)
                        : (JSON.stringify(part) ?? '')
                    )
                  }

                  if ('usage' in part && part.usage) {
                    tokenUsage = part.usage
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
            activeProvider?.provider === 'llamacpp'
          ) {
            await serviceHub
              .models()
              .stopModel(activeThread.model.id, 'llamacpp')
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
            useToolApproval.getState().approvedTools,
            allowAllMCPPermissions ? undefined : showApprovalModal,
            allowAllMCPPermissions
          )
          addMessage(updatedMessage ?? finalContent)
          updateStreamingContent(emptyThreadContent)
          updatePromptProgress(undefined)
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
        updatePromptProgress(undefined)
      }
    },
    [
      getCurrentThread,
      resetTokenSpeed,
      getProviderByName,
      getMessages,
      setAbortController,
      updateStreamingContent,
      updatePromptProgress,
      addMessage,
      updateThreadTimestamp,
      updateLoadingModel,
      getDisabledToolsForThread,
      allowAllMCPPermissions,
      showApprovalModal,
      updateTokenSpeed,
      showIncreaseContextSizeModal,
      increaseModelContextSize,
      toggleOnContextShifting,
      setModelLoadError,
      serviceHub,
      setTokenSpeed,
    ]
  )

  return useMemo(() => sendMessage, [sendMessage])
}
