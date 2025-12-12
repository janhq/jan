/* eslint-disable react-hooks/refs */
import { createFileRoute, useParams } from '@tanstack/react-router'
import ChatInput from '@/components/chat-input'
import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'
import { useChat } from '@/hooks/use-chat'
import { janProvider } from '@/lib/api-client'

import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'

import { MessageCircleMore, Plus, PencilIcon, Upload } from 'lucide-react'
import { useModels } from '@/stores/models-store'
import { useEffect, useRef, useState } from 'react'
import { useProjects } from '@/stores/projects-store'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

function ProjectPageContent() {
  const params = useParams({ strict: false })
  const projectId = params.projectId as string | undefined
  const selectedModel = useModels((state) => state.selectedModel)
  const getProject = useProjects((state) => state.getProject)
  const [project, setProject] = useState<Project | null>(null)
  const reasoningContainerRef = useRef<HTMLDivElement>(null)

  const provider = janProvider()

  const { messages, status, sendMessage } = useChat(
    provider(selectedModel?.id),
    {
      onFinish: () => {
        // After finishing a message
      },
    }
  )

  const handleSubmit = (message: PromptInputMessage) => {
    sendMessage({
      text: message.text || 'Sent with attachments',
      files: message.files,
    })
  }

  useEffect(() => {
    if (projectId) {
      getProject(projectId)
        .then((projectData) => {
          setProject(projectData)
        })
        .catch((error) => {
          console.error('Failed to load project:', error)
        })
    }
  }, [projectId, getProject])

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (status === 'streaming' && reasoningContainerRef.current) {
      reasoningContainerRef.current.scrollTop =
        reasoningContainerRef.current.scrollHeight
    }
  }, [status, reasoningContainerRef.current?.textContent])

  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <NavHeader />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-20 mt-4 w-full px-4 md:px-10 pt-2 size-full overflow-y-auto max-h-[100vh-56px]">
          <div className="col-span-full lg:col-span-8 flex flex-col h-full">
            <div className="size-full mx-auto flex flex-col">
              <div>
                <h1 className="text-xl font-semibold">{project?.name}</h1>
                <p className="mt-2 text-muted-foreground">
                  A short description about the project goes here
                </p>
                <div className="py-4 max-w-3xl mx-auto w-full">
                  <ChatInput submit={handleSubmit} status={status} />
                </div>
              </div>
              <Separator className="my-4" />
              <div className="size-full flex pb-4">
                <div className="size-full flex flex-col gap-4">
                  <span className="text-base font-semibold mt-4 inline-block">
                    Conversation
                  </span>

                  {messages.length === 0 ? (
                    <div
                      className={cn(
                        'relative rounded-2xl h-full overflow-y-auto bg-muted flex items-center justify-center text-center'
                      )}
                    >
                      <div className="px-8 w-full md:w-1/2 mx-auto">
                        <MessageCircleMore className="text-muted-foreground size-6 mx-auto mb-2" />
                        <p className="text-base mb-2">No conversations yet</p>
                        <p className="text-sm text-muted-foreground">
                          Start a chat to keep conversations organized and
                          re-use project knowledge.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div></div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="size-full flex flex-col pb-4 col-span-1 lg:col-span-4">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold inline-block">
                  Instructions
                </span>
                <Button variant="outline" size="sm" className="rounded-full">
                  {project?.instruction ? (
                    <>
                      <PencilIcon />
                      <span>Edit</span>
                    </>
                  ) : (
                    <>
                      <Plus />
                      <span>Setup</span>
                    </>
                  )}
                </Button>
              </div>
              {project?.instruction ? (
                <p className="text-sm text-muted-foreground line-clamp-3 mt-3">
                  {project.instruction}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground line-clamp-3 mt-3">
                  Customize tone and style of response
                </p>
              )}
            </div>

            <Separator className="my-6" />

            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold inline-block">
                  Files
                </span>
                <Button variant="outline" size="sm" className="rounded-full">
                  <Upload className="text-muted-foreground" />
                  <span>Upload</span>
                </Button>
              </div>
              <p className="mt-3 h-full bg-muted rounded-2xl flex items-center justify-center text-center px-4 py-6 text-sm ">
                <div className="px-8 w-full ">
                  <MessageCircleMore className="text-muted-foreground size-6 mx-auto mb-2" />
                  <p className="text-base mb-2">Add files to this project</p>
                  <p className="text-sm text-muted-foreground">
                    Upload documents that provide Jan with context for more
                    accurate answers
                  </p>
                </div>
              </p>
            </div>
          </div>
        </div>

        {/* <div className="flex flex-1 flex-col h-full overflow-hidden max-h-[calc(100vh-56px)] w-full "> */}
        {/* <div className="w-full mx-auto">
            <h1 className="text-lg font-semibold">{project?.name}</h1>
            <p>A short description about the project goes here</p>
          </div> */}

        {/* <div className="w-full mx-auto">
            <h1 className="text-lg font-semibold">{project?.name}</h1>
            {project?.instruction && (
              <p className="text-sm text-muted-foreground mt-1">
                {project.instruction}
              </p>
            )}

            <div className="px-4 py-4 max-w-3xl mx-auto w-full">
              <ChatInput submit={handleSubmit} status={status} />
            </div>
          </div>

          <div className="flex-1 relative">
            <Conversation className="absolute inset-0 text-start">
              <ConversationContent className="max-w-3xl mx-auto">
                {messages.length === 0 && (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-muted-foreground">
                      <p className="text-base mb-2">No conversations yet</p>
                      <p className="text-sm">
                        Start a chat to keep conversations organized and re-use
                        project knowledge.
                      </p>
                    </div>
                  </div>
                )}
                {messages.map((message, messageIndex) => (
                  <div key={message.id}>
                    {message.parts.map((part, i) => {
                      const isLastMessage = messageIndex === messages.length - 1
                      const isLastPart = i === message.parts.length - 1

                      switch (part.type) {
                        case 'text':
                          return (
                            <Message
                              key={`${message.id}-${i}`}
                              from={message.role}
                            >
                              <MessageContent className="leading-relaxed">
                                <MessageResponse>{part.text}</MessageResponse>
                              </MessageContent>
                              {message.role === 'assistant' &&
                                isLastMessage &&
                                isLastPart && (
                                  <MessageActions className="mt-1 gap-0">
                                    <MessageAction
                                      onClick={() =>
                                        navigator.clipboard.writeText(part.text)
                                      }
                                      label="Copy"
                                    >
                                      <CopyIcon className="text-muted-foreground size-3" />
                                    </MessageAction>
                                    <MessageAction
                                      onClick={() => regenerate()}
                                      label="Retry"
                                    >
                                      <RefreshCcwIcon className="text-muted-foreground size-3" />
                                    </MessageAction>
                                    <MessageAction label="Like">
                                      <ThumbsUpIcon className="text-muted-foreground size-3" />
                                    </MessageAction>
                                    <MessageAction label="Dislike">
                                      <ThumbsDownIcon className="text-muted-foreground size-3" />
                                    </MessageAction>
                                  </MessageActions>
                                )}
                            </Message>
                          )
                        case 'reasoning':
                          return (
                            <Reasoning
                              key={`${message.id}-${i}`}
                              className="w-full text-muted-foreground"
                              isStreaming={
                                status === 'streaming' &&
                                isLastPart &&
                                isLastMessage
                              }
                              defaultOpen={
                                status === 'streaming' && isLastMessage
                              }
                            >
                              <ReasoningTrigger />
                              <div className="relative">
                                {status === 'streaming' && isLastMessage && (
                                  <div className="absolute top-0 left-0 right-0 h-8 bg-linear-to-br from-background to-transparent pointer-events-none z-10" />
                                )}
                                <div
                                  ref={
                                    status === 'streaming' && isLastMessage
                                      ? reasoningContainerRef
                                      : null
                                  }
                                  className={twMerge(
                                    'w-full overflow-auto relative',
                                    status === 'streaming' && isLastMessage
                                      ? 'max-h-32 opacity-70 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
                                      : 'h-auto opacity-100'
                                  )}
                                >
                                  <ReasoningContent>
                                    {part.text}
                                  </ReasoningContent>
                                </div>
                              </div>
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
          </div> */}
        {/* </div> */}
      </SidebarInset>
    </>
  )
}

function ProjectPage() {
  return (
    <SidebarProvider>
      <ProjectPageContent />
    </SidebarProvider>
  )
}

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectPage,
})
