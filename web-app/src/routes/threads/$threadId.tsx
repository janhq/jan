import { createFileRoute, useParams } from '@tanstack/react-router'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from 'react-i18next'
import { useThreads } from '@/hooks/useThreads'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import ChatInput from '@/containers/ChatInput'

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
  component: ThreadDetail,
})

function ThreadDetail() {
  const { t } = useTranslation('common', {})
  const { threadId } = useParams({ from: Route.id })
  const { getThreadById } = useThreads()

  const thread = getThreadById(threadId)

  if (!thread) return null

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">
          {thread.title || t('common.thread_not_found')}
        </h1>
      </HeaderPage>
      <div className="flex flex-col h-[calc(100%-32px)] ">
        <div className="flex flex-col h-full w-full p-4 overflow-auto">
          <div className="max-w-none w-4/6 mx-auto">
            {thread.content &&
              thread.content.map((item, index) => (
                <div key={index} className="mb-4">
                  {item.type === 'text' && item.text && (
                    <RenderMarkdown content={item.text.value} />
                  )}
                  {item.type === 'image_url' && item.image_url && (
                    <div>
                      <img
                        src={item.image_url.url}
                        alt={item.image_url.detail || 'Thread image'}
                        className="max-w-full rounded-md"
                      />
                      {item.image_url.detail && (
                        <p className="text-sm text-gray-500 mt-1">
                          {item.image_url.detail}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
        <div className="w-4/6 mx-auto pt-2 pb-4">
          <ChatInput />
        </div>
      </div>
    </div>
  )
}
