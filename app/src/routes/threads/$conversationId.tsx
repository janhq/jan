import { createFileRoute, useParams } from '@tanstack/react-router'
import { SidebarProvider } from '@/components/ui/sidebar'
import { ThreadPageContent } from '@/components/threads/thread-page-content'

function ThreadPage() {
  const params = useParams({ strict: false })
  const conversationId = params.conversationId as string | undefined

  return (
    <SidebarProvider>
      <ThreadPageContent conversationId={conversationId} />
    </SidebarProvider>
  )
}

export const Route = createFileRoute('/threads/$conversationId')({
  component: ThreadPage,
})
