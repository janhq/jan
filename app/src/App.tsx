import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'

import ChatInput from '@/components/chat-input'
import { useState } from 'react'
import type { PromptInputMessage } from './components/ai-elements/prompt-input'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from './components/ai-elements/conversation'
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from './components/ai-elements/message'
import { CopyIcon, Loader, RefreshCcwIcon } from 'lucide-react'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from './components/ai-elements/reasoning'
import { useChat } from './hooks/use-chat'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { useAuth } from './stores/auth-store'

function AppPageContent() {
  const [input, setInput] = useState<string>(
    'This is a placeholder message when ever you send it sends this text.'
  )

  const { accessToken } = useAuth()

  const provider = createOpenAICompatible({
    name: 'janhq',
    apiKey: accessToken ?? '',
    baseURL: 'https://api.jan.ai/v1',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  })

  const { messages, sendMessage, status, regenerate } = useChat(provider('unknown/jan-v2-30b'))

  const handleSubmit = (message: PromptInputMessage) => {
    const hasText = Boolean(message.text)
    const hasAttachments = Boolean(message.files?.length)
    if (!(hasText || hasAttachments)) {
      return
    }
    sendMessage(
      {
        text: message.text || 'Sent with attachments',
        files: message.files,
      },
      {
        body: {
          model: 'unknown/jan-v2-30b',
          // webSearch: webSearch,
        },
      }
    )
    setInput('')
  }

  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <NavHeader />
        <div className="flex flex-1 flex-col items-center justify-center h-full gap-4 px-4 py-10 max-w-3xl w-full mx-auto ">
          <div className="mx-auto flex justify-center items-center h-full w-full rounded-xl">
            <div className="w-full text-center">
              {/* <h2 className="text-xl font-medium mb-6">
                How can I help you today?
              </h2> */}
              <Conversation className="h-full text-start">
                <ConversationContent>
                  {messages.map((message) => (
                    <div key={message.id}>
                      {message.parts.map((part, i) => {
                        switch (part.type) {
                          case 'text':
                            return (
                              <Message
                                key={`${message.id}-${i}`}
                                from={message.role}
                              >
                                <MessageContent>
                                  <MessageResponse>{part.text}</MessageResponse>
                                </MessageContent>
                                {message.role === 'assistant' &&
                                  i === messages.length - 1 && (
                                    <MessageActions>
                                      <MessageAction
                                        onClick={() => regenerate()}
                                        label="Retry"
                                      >
                                        <RefreshCcwIcon className="size-3" />
                                      </MessageAction>
                                      <MessageAction
                                        onClick={() =>
                                          navigator.clipboard.writeText(
                                            part.text
                                          )
                                        }
                                        label="Copy"
                                      >
                                        <CopyIcon className="size-3" />
                                      </MessageAction>
                                    </MessageActions>
                                  )}
                              </Message>
                            )
                          case 'reasoning':
                            return (
                              <Reasoning
                                key={`${message.id}-${i}`}
                                className="w-full"
                                isStreaming={
                                  status === 'streaming' &&
                                  i === message.parts.length - 1 &&
                                  message.id === messages.at(-1)?.id
                                }
                              >
                                <ReasoningTrigger />
                                <ReasoningContent>{part.text}</ReasoningContent>
                              </Reasoning>
                            )
                          default:
                            return null
                        }
                      })}
                    </div>
                  ))}
                  {status === 'submitted' && <Loader />}
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>

              <ChatInput
                initialConversation={true}
                submit={() =>
                  handleSubmit({
                    text: "what's the weather like today?",
                    files: [],
                  })
                }
              />
            </div>
          </div>
        </div>
      </SidebarInset>
    </>
  )
}

export default function AppPage() {
  return (
    <SidebarProvider>
      <AppPageContent />
    </SidebarProvider>
  )
}
