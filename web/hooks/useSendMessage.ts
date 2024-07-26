import { useCallback, useRef } from 'react'

import {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  LocalEngines,
  Message,
  MessageContent,
  TextContentBlock,
  Thread,
} from '@janhq/core'

import { useAtomValue, useSetAtom } from 'jotai'

import { currentPromptAtom, editPromptAtom } from '@/containers/Providers/Jotai'

import { toaster } from '@/containers/Toast'

import { useActiveModel } from './useActiveModel'
import useCortex from './useCortex'

import useMessageCreateMutation from './useMessageCreateMutation'
import useMessageUpdateMutation from './useMessageUpdateMutation'

import {
  addNewMessageAtom,
  getCurrentChatMessagesAtom,
  updateMessageAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import {
  activeModelsAtom,
  getSelectedModelAtom,
} from '@/helpers/atoms/Model.atom'
import {
  activeThreadAtom,
  addThreadIdShouldAnimateTitleAtom,
  isGeneratingResponseAtom,
  updateThreadTitleAtom,
} from '@/helpers/atoms/Thread.atom'

// TODO: NamH add this back
// const normalizeMessages = (messages: Message[]): Message[] => {
//   const stack = new Stack<Message>()
//   for (const message of messages) {
//     if (stack.isEmpty()) {
//       stack.push(message)
//       continue
//     }
//     const topMessage = stack.peek()

//     if (message.role === topMessage.role) {
//       // add an empty message
//       stack.push({
//         role: topMessage.role === 'user' ? 'assistant' : 'user',
//         content: '.', // some model requires not empty message
//       })
//     }
//     stack.push(message)
//   }

//   return stack.reverseOutput()
// }

const useSendMessage = () => {
  const createMessage = useMessageCreateMutation()
  const updateMessage = useMessageUpdateMutation()
  const addNewMessage = useSetAtom(addNewMessageAtom)
  const {
    chatCompletionStreaming,
    chatCompletionNonStreaming,
    updateThread,
    getEngineStatus,
    initializeEngine,
  } = useCortex()
  const updateMessageState = useSetAtom(updateMessageAtom)
  const setIsGeneratingResponse = useSetAtom(isGeneratingResponseAtom)
  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const setEditPrompt = useSetAtom(editPromptAtom)
  const updateThreadTitle = useSetAtom(updateThreadTitleAtom)
  const addThreadIdShouldAnimateTitle = useSetAtom(
    addThreadIdShouldAnimateTitleAtom
  )

  const activeThread = useAtomValue(activeThreadAtom)
  const activeModels = useAtomValue(activeModelsAtom)
  const currentMessages = useAtomValue(getCurrentChatMessagesAtom)
  const selectedModel = useAtomValue(getSelectedModelAtom)
  const { startModel } = useActiveModel()
  const abortControllerRef = useRef<AbortController | undefined>(undefined)

  const stopInference = useCallback(() => {
    abortControllerRef.current?.abort()
  }, [])

  const summarizeThread = useCallback(
    async (messages: string[], modelId: string, thread: Thread) => {
      const maxWordForThreadTitle = 10
      const summarizeMessages: ChatCompletionMessageParam[] = [
        {
          role: 'user',
          content: `Summarize in a ${maxWordForThreadTitle}-word title the following conversation:\n\n${messages.join('\n')}`,
        },
      ]

      const summarizeParams: ChatCompletionCreateParamsNonStreaming = {
        messages: summarizeMessages,
        model: modelId,
        max_tokens: 150,
        temperature: 0.5,
      }
      const summarizeStream = await chatCompletionNonStreaming(summarizeParams)
      const summarizedText = (
        summarizeStream.choices[0].message.content ?? 'New Thread'
      ).replace(/"/g, '')

      addThreadIdShouldAnimateTitle(thread.id)
      updateThread({ ...thread, title: summarizedText })
      updateThreadTitle(thread.id, summarizedText)
    },
    [
      addThreadIdShouldAnimateTitle,
      chatCompletionNonStreaming,
      updateThreadTitle,
      updateThread,
    ]
  )

  const resendMessage = useCallback(async () => {
    if (!activeThread) {
      console.error('No active thread')
      return
    }
    if (!selectedModel) {
      console.error('No selected model')
      return
    }
    try {
      if (selectedModel.model !== activeThread.assistants[0].model) {
        activeThread.assistants[0].model = selectedModel.model
        await updateThread(activeThread)
      }
    } catch (err) {
      console.error(`Failed to update thread ${activeThread.id}, error: ${err}`)
      toaster({
        title: 'Failed to update thread',
        description: 'Please try select model for this thread again!',
        type: 'error',
      })
    }

    const modelId = activeThread.assistants[0].model

    try {
      // start model if not yet started
      if (LocalEngines.find((e) => e === selectedModel.engine) != null) {
        // start model if local and not started
        if (!activeModels.map((model) => model.model).includes(modelId)) {
          await startModel(modelId)
        }
      }
    } catch (err) {
      console.error(`Failed to start model ${modelId}, error: ${err}`)
      toaster({
        title: 'Failed to start model',
        description: `Failed to start model ${modelId}`,
        type: 'error',
      })
    }

    setIsGeneratingResponse(true)

    // building messages
    const systemMessage: ChatCompletionMessageParam = {
      role: 'system',
      content: activeThread.assistants[0].instructions ?? '',
    }

    const messages: ChatCompletionMessageParam[] = currentMessages
      .map((msg) => {
        switch (msg.role) {
          case 'user':
          case 'assistant':
            return {
              role: msg.role,
              content: (msg.content[0] as TextContentBlock).text.value,
            }

          // we will need to support other roles in the future
          default:
            break
        }
      })
      .filter((msg) => msg != null) as ChatCompletionMessageParam[]
    messages.unshift(systemMessage)

    const modelOptions: Record<string, string | number> = {}
    if (selectedModel.frequency_penalty) {
      modelOptions.frequency_penalty = selectedModel.frequency_penalty
    }
    if (selectedModel.presence_penalty) {
      modelOptions.presence_penalty = selectedModel.presence_penalty
    }
    try {
      let assistantResponseMessage = ''
      if (selectedModel.stream === true) {
        const stream = await chatCompletionStreaming({
          messages,
          model: selectedModel.model,
          stream: true,
          max_tokens: selectedModel.max_tokens,
          stop: selectedModel.stop,
          temperature: selectedModel.temperature ?? 1,
          top_p: selectedModel.top_p ?? 1,
          ...modelOptions,
        })

        abortControllerRef.current = stream.controller

        const assistantMessage = await createMessage.mutateAsync({
          threadId: activeThread.id,
          createMessageParams: {
            role: 'assistant',
            content: '',
          },
        })

        const responseMessage: Message = {
          id: assistantMessage.id,
          thread_id: activeThread.id,
          assistant_id: activeThread.id,
          role: 'assistant',
          content: [],
          status: 'in_progress',
          created_at: assistantMessage.created_at,
          metadata: undefined,
          attachments: null,
          completed_at: Date.now(),
          incomplete_at: null,
          incomplete_details: null,
          object: 'thread.message',
          run_id: null,
        }

        addNewMessage(responseMessage)

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || ''
          assistantResponseMessage += content
          const messageContent: MessageContent = {
            type: 'text',
            text: {
              value: assistantResponseMessage,
              annotations: [],
            },
          }
          responseMessage.content = [messageContent]
          updateMessageState(
            responseMessage.id,
            responseMessage.thread_id,
            responseMessage.content,
            responseMessage.status
          )
        }

        abortControllerRef.current = undefined

        responseMessage.status = 'completed'
        updateMessageState(
          responseMessage.id,
          responseMessage.thread_id,
          responseMessage.content,
          responseMessage.status
        )

        updateMessage.mutateAsync({
          threadId: activeThread.id,
          messageId: responseMessage.id,
          data: {
            content: responseMessage.content,
          },
        })
      } else {
        const abortController = new AbortController()
        const response = await chatCompletionNonStreaming(
          {
            messages,
            model: selectedModel.model,
            stream: false,
            max_tokens: selectedModel.max_tokens,
            stop: selectedModel.stop,
            temperature: selectedModel.temperature ?? 1,
            top_p: selectedModel.top_p ?? 1,
            ...modelOptions,
          },
          {
            signal: abortController.signal,
          }
        )

        assistantResponseMessage = response.choices[0].message.content ?? ''
        const assistantMessage = await createMessage.mutateAsync({
          threadId: activeThread.id,
          createMessageParams: {
            role: 'assistant',
            content: assistantResponseMessage,
          },
        })

        const responseMessage: Message = {
          id: assistantMessage.id,
          thread_id: activeThread.id,
          assistant_id: activeThread.id,
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: {
                value: assistantResponseMessage,
                annotations: [],
              },
            },
          ],
          status: 'completed',
          created_at: assistantMessage.created_at,
          metadata: undefined,
          attachments: null,
          completed_at: Date.now(),
          incomplete_at: null,
          incomplete_details: null,
          object: 'thread.message',
          run_id: null,
        }
        updateMessage.mutate({
          threadId: activeThread.id,
          messageId: responseMessage.id,
          data: {
            content: responseMessage.content,
          },
        })
        addNewMessage(responseMessage)
      }
    } catch (err) {
      console.error(err)

      toaster({
        title: 'Failed to generate response',
        type: 'error',
      })
    }

    setIsGeneratingResponse(false)
  }, [
    activeThread,
    activeModels,
    currentMessages,
    selectedModel,
    updateMessage,
    createMessage,
    startModel,
    updateMessageState,
    addNewMessage,
    updateThread,
    chatCompletionNonStreaming,
    chatCompletionStreaming,
    setIsGeneratingResponse,
  ])

  const sendMessage = useCallback(
    async (message: string) => {
      if (!activeThread) {
        console.error('No active thread')
        return
      }
      if (!selectedModel) {
        console.error('No selected model')
        return
      }
      if (selectedModel.model !== activeThread.assistants[0].model) {
        activeThread.assistants[0].model = selectedModel.model
        await updateThread(activeThread)
      }
      const engine = selectedModel.engine
      if (!engine) {
        toaster({
          title: 'Start model failed',
          description: `Model ${selectedModel.model} does not have an engine`,
          type: 'error',
        })
        console.error(`Model ${selectedModel.model} does not have an engine`)
        return
      }

      const engineStatus = await getEngineStatus(engine)
      if (!engineStatus) {
        toaster({
          title: 'Start model failed',
          description: `Cannot get engine status for ${engine}`,
          type: 'error',
        })
        console.error(`Cannot get engine status for ${engine}`)
        return
      }
      if (engineStatus.status !== 'ready') {
        toaster({
          title: 'Please wait for engine to initialize',
          description: `Please retry after engine ${engine} is installed.`,
          type: 'default',
        })
        initializeEngine(engine)
        return
      }

      let shouldSummarize =
        activeThread.title === 'New Thread' || activeThread.title.trim() === ''
      const modelId = activeThread.assistants[0].model

      setCurrentPrompt('')
      setEditPrompt('')

      const userMessage = await createMessage.mutateAsync({
        threadId: activeThread.id,
        createMessageParams: {
          role: 'user',
          content: message,
        },
      })
      // Push to states
      addNewMessage(userMessage)

      try {
        // start model if not yet started
        if (LocalEngines.find((e) => e === selectedModel.engine) != null) {
          // start model if local and not started
          if (!activeModels.map((model) => model.model).includes(modelId)) {
            await startModel(modelId)
          }
        }
      } catch (err) {
        console.error(`Failed to start model ${modelId}, error: ${err}`)
      }

      setIsGeneratingResponse(true)

      // building messages
      const systemMessage: ChatCompletionMessageParam = {
        role: 'system',
        content: activeThread.assistants[0].instructions ?? '',
      }

      const messages: ChatCompletionMessageParam[] = currentMessages
        .map((msg) => {
          switch (msg.role) {
            case 'user':
            case 'assistant':
              return {
                role: msg.role,
                content: (msg.content[0] as TextContentBlock).text.value,
              }

            // we will need to support other roles in the future
            default:
              break
          }
        })
        .filter((msg) => msg != null) as ChatCompletionMessageParam[]
      messages.push({
        role: 'user',
        content: message,
      })
      messages.unshift(systemMessage)
      const modelOptions: Record<string, string | number> = {}
      if (selectedModel.frequency_penalty) {
        modelOptions.frequency_penalty = selectedModel.frequency_penalty
      }
      if (selectedModel.presence_penalty) {
        modelOptions.presence_penalty = selectedModel.presence_penalty
      }
      let assistantResponseMessage = ''
      try {
        if (selectedModel.stream === true) {
          const stream = await chatCompletionStreaming({
            messages,
            model: selectedModel.model,
            stream: true,
            max_tokens: selectedModel.max_tokens,
            stop: selectedModel.stop,
            temperature: selectedModel.temperature ?? 1,
            top_p: selectedModel.top_p ?? 1,
            ...modelOptions,
          })

          abortControllerRef.current = stream.controller

          const assistantMessage = await createMessage.mutateAsync({
            threadId: activeThread.id,
            createMessageParams: {
              role: 'assistant',
              content: '',
            },
          })

          const responseMessage: Message = {
            id: assistantMessage.id,
            thread_id: activeThread.id,
            assistant_id: activeThread.id,
            role: 'assistant',
            content: [],
            status: 'in_progress',
            created_at: assistantMessage.created_at,
            metadata: undefined,
            attachments: null,
            completed_at: Date.now(),
            incomplete_at: null,
            incomplete_details: null,
            object: 'thread.message',
            run_id: null,
          }

          if (responseMessage) {
            setIsGeneratingResponse(false)
          }

          addNewMessage(responseMessage)

          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || ''
            assistantResponseMessage += content
            const messageContent: MessageContent = {
              type: 'text',
              text: {
                value: assistantResponseMessage,
                annotations: [],
              },
            }
            responseMessage.content = [messageContent]
            updateMessageState(
              responseMessage.id,
              responseMessage.thread_id,
              responseMessage.content,
              responseMessage.status
            )
          }

          abortControllerRef.current = undefined

          responseMessage.status = 'completed'
          updateMessageState(
            responseMessage.id,
            responseMessage.thread_id,
            responseMessage.content,
            responseMessage.status
          )
          updateMessage.mutateAsync({
            threadId: activeThread.id,
            messageId: responseMessage.id,
            data: {
              content: responseMessage.content,
            },
          })
        } else {
          const abortController = new AbortController()
          const response = await chatCompletionNonStreaming(
            {
              messages,
              model: selectedModel.model,
              stream: false,
              max_tokens: selectedModel.max_tokens,
              stop: selectedModel.stop,
              temperature: selectedModel.temperature ?? 1,
              top_p: selectedModel.top_p ?? 1,
              ...modelOptions,
            },
            {
              signal: abortController.signal,
            }
          )

          assistantResponseMessage = response.choices[0].message.content ?? ''
          const assistantMessage = await createMessage.mutateAsync({
            threadId: activeThread.id,
            createMessageParams: {
              role: 'assistant',
              content: assistantResponseMessage,
            },
          })

          const responseMessage: Message = {
            id: assistantMessage.id,
            thread_id: activeThread.id,
            assistant_id: activeThread.id,
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: {
                  value: assistantResponseMessage,
                  annotations: [],
                },
              },
            ],
            status: 'completed',
            created_at: assistantMessage.created_at,
            metadata: undefined,
            attachments: null,
            completed_at: Date.now(),
            incomplete_at: null,
            incomplete_details: null,
            object: 'thread.message',
            run_id: null,
          }
          updateMessage.mutateAsync({
            threadId: activeThread.id,
            messageId: responseMessage.id,
            data: {
              content: responseMessage.content,
            },
          })

          if (responseMessage) {
            setIsGeneratingResponse(false)
          }

          addNewMessage(responseMessage)
        }
      } catch (err) {
        console.error(err)
        setIsGeneratingResponse(false)
        shouldSummarize = false

        toaster({
          title: 'Failed to generate response',
          type: 'error',
        })
      }

      try {
        if (!shouldSummarize) return
        // summarize if needed
        const textMessages: string[] = messages
          .map((msg) => {
            if (typeof msg.content === 'string') return msg.content
          })
          .filter((msg) => msg != null) as string[]
        textMessages.push(assistantResponseMessage)
        summarizeThread(textMessages, modelId, activeThread)
      } catch (err) {
        console.error(`Failed to summarize thread: ${err}`)
      }
    },
    [
      activeThread,
      activeModels,
      currentMessages,
      selectedModel,
      updateMessage,
      createMessage,
      updateThread,
      setCurrentPrompt,
      setEditPrompt,
      setIsGeneratingResponse,
      updateMessageState,
      addNewMessage,
      startModel,
      chatCompletionNonStreaming,
      chatCompletionStreaming,
      summarizeThread,
      getEngineStatus,
      initializeEngine,
    ]
  )

  return { resendMessage, sendMessage, stopInference }
}

export default useSendMessage
