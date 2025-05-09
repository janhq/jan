import { useCallback, useMemo } from 'react'
import { createFileRoute, useParams } from '@tanstack/react-router'
import HeaderPage from '@/containers/HeaderPage'

import { useThreads } from '@/hooks/useThreads'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import ChatInput from '@/containers/ChatInput'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { usePrompt } from '@/hooks/usePrompt'
import {
  newAssistantThreadContent,
  newUserThreadContent,
} from '@/helpers/threads'
import { useModelProvider } from '@/hooks/useModelProvider'
import { models, TokenJS } from 'token.js'

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
  component: ThreadDetail,
})

function ThreadDetail() {
  const { threadId } = useParams({ from: Route.id })
  const { prompt, setPrompt } = usePrompt()
  const { getProviderByName, selectedProvider } = useModelProvider()
  const { getThreadById, addThreadContent, updateThreadContents } = useThreads()

  const thread = getThreadById(threadId)

  const provider = useMemo(() => {
    return getProviderByName(selectedProvider)
  }, [selectedProvider, getProviderByName])

  const sendMessage = useCallback(async () => {
    const userContent = newUserThreadContent(prompt)
    addThreadContent(threadId, userContent)
    setPrompt('')

    if (!thread?.model?.id || !provider || !provider.api_key) return

    let providerName = provider.provider as unknown as keyof typeof models

    if (!Object.keys(models).some((key) => key === providerName))
      providerName = 'openai-compatible'

    const tokenJS = new TokenJS({
      apiKey: provider.api_key,
      baseURL: provider.base_url,
    })

    const completion = await tokenJS.chat.completions.create({
      stream: true,
      provider: providerName,
      model: thread.model?.id,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    })
    const newContent = newAssistantThreadContent('')
    const contents = thread.content || []
    for await (const part of completion) {
      newContent.text!.value += part.choices[0]?.delta?.content || ''
      updateThreadContents(threadId, [...contents, userContent, newContent])
    }
  }, [
    addThreadContent,
    threadId,
    prompt,
    thread,
    provider,
    setPrompt,
    updateThreadContents,
  ])

  const threadContent = useMemo(() => thread?.content, [thread])
  const threadModel = useMemo(() => thread?.model, [thread])

  if (!threadContent || !threadModel) return null

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <DropdownModelProvider model={threadModel} />
      </HeaderPage>
      <div className="flex flex-col h-[calc(100%-40px)] ">
        <div className="flex flex-col h-full w-full p-4 overflow-auto">
          <div className="max-w-none w-4/6 mx-auto">
            {threadContent &&
              threadContent.map((item, index) => {
                return (
                  <div key={index} className="mb-4">
                    {item.type === 'text' &&
                      item.text &&
                      item.role === 'user' && (
                        <div className="flex justify-end w-full">
                          <div className="bg-accent text-accent-fg p-2 rounded-md inline-block">
                            <p>{item.text.value}</p>
                          </div>
                        </div>
                      )}
                    {item.type === 'text' &&
                      item.text &&
                      item.role !== 'user' && (
                        <RenderMarkdown
                          content={item.text.value}
                          components={{
                            a: ({ ...props }) => (
                              <a
                                {...props}
                                target="_blank"
                                rel="noopener noreferrer"
                              />
                            ),
                          }}
                        />
                      )}
                    {item.type === 'image_url' && item.image_url && (
                      <div>
                        <img
                          src={item.image_url.url}
                          alt={item.image_url.detail || 'Thread image'}
                          className="max-w-full rounded-md"
                        />
                        {item.image_url.detail && (
                          <p className="text-sm mt-1">
                            {item.image_url.detail}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
        <div className="w-4/6 mx-auto py-2 shrink-0">
          <ChatInput handleSubmit={sendMessage} />
        </div>
      </div>
    </div>
  )
}
