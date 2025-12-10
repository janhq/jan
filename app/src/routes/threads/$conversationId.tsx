import { createFileRoute, useParams } from '@tanstack/react-router'
import { useEffect } from 'react'
// import { useConversations } from '@/hooks/use-conversations'
import ChatInput from '@/components/chat-input'
import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'

function ThreadPageContent() {
  const { conversationId } = useParams({ strict: false }) as {
    conversationId: string
  }
  // const { conversations, currentConversation, setCurrentConversation } =
  //   useConversations()

  // Set current conversation when component mounts or conversationId changes
  // useEffect(() => {
  //   const conversation = conversations.find((c) => c.id === conversationId)
  //   if (conversation) {
  //     setCurrentConversation(conversation)
  //   }
  // }, [conversationId, conversations, setCurrentConversation])

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
          <ChatInput />
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
