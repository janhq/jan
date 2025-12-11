import { createFileRoute, useParams } from '@tanstack/react-router'

import ChatInput from '@/components/chat-input'
import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'

function ThreadPageContent() {
  const params = useParams({ strict: false })
  const conversationId = params.conversationId as string | undefined

  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <NavHeader />
        <div className="flex flex-1 flex-col h-full gap-4 px-4 pt-10 pb-4 max-w-3xl w-full mx-auto">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto">
            <p>
              Lorem ipsum dolor sit amet consectetur, adipisicing elit. Laborum
              distinctio recusandae cupiditate nulla numquam possimus ut
              dolores, facere nihil doloremque sit cumque debitis harum quidem
              obcaecati culpa incidunt aperiam facilis.
            </p>
          </div>

          {/* Chat Input */}
          <ChatInput conversationId={conversationId} />
        </div>
      </SidebarInset>
    </>
  )
}

function ThreadPage() {
  return (
    <SidebarProvider>
      <ThreadPageContent />
    </SidebarProvider>
  )
}

export const Route = createFileRoute('/threads/$conversationId')({
  component: ThreadPage,
})
