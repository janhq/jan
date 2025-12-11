import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'

import ChatInput from '@/components/chat-input'

function AppPageContent() {
  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <NavHeader />
        <div className="flex flex-1 flex-col items-center justify-center h-full gap-4 px-4 py-10 max-w-3xl w-full mx-auto ">
          <div className="mx-auto flex justify-center items-center h-full w-full rounded-xl">
            <div className="w-full text-center">
              <h2 className="text-xl font-medium mb-6">
                How can I help you today?
              </h2>
              <ChatInput initialConversation={true} />
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
