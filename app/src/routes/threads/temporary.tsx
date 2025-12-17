import { createFileRoute } from '@tanstack/react-router'
import { SidebarProvider } from '@/components/ui/sidebar'
import { usePrivateChat } from '@/stores/private-chat-store'
import { cn } from '@/lib/utils'
import { ThreadPageContent } from '@/components/threads/thread-page-content'

function ThreadPage() {
  const isPrivateChat = usePrivateChat((state) => state.isPrivateChat)

  return (
    <SidebarProvider
      className={cn(
        isPrivateChat &&
          '**:data-[slot="sidebar"]:opacity-0 **:data-[slot="sidebar"]:-translate-x-full **:data-[slot="sidebar-gap"]:w-0 **:data-[slot="sidebar"]:transition-all **:data-[slot="sidebar-gap"]:transition-all **:data-[slot="sidebar"]:duration-300 **:data-[slot="sidebar-gap"]:duration-300'
      )}
    >
      <ThreadPageContent isPrivateChat={isPrivateChat} />
    </SidebarProvider>
  )
}

export const Route = createFileRoute('/threads/temporary')({
  component: ThreadPage,
})
