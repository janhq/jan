import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'

import ChatInput from '@/components/chat-input'
import { useEffect } from 'react'
import { useModels } from '@/stores/models-store'
import { useLastUsedModel } from '@/stores/last-used-model-store'
import { usePrivateChat } from './stores/private-chat-store'
import { HatGlassesIcon } from 'lucide-react'

function AppPageContent() {
  const models = useModels((state) => state.models)
  const setSelectedModel = useModels((state) => state.setSelectedModel)
  const lastUsedModelId = useLastUsedModel((state) => state.lastUsedModelId)
  const isPrivateChat = usePrivateChat((state) => state.isPrivateChat)
  const setLastUsedModelId = useLastUsedModel(
    (state) => state.setLastUsedModelId
  )

  useEffect(() => {
    if (lastUsedModelId) {
      const lastUsedModel = models.find((m) => m.id === lastUsedModelId)
      if (lastUsedModel) {
        setSelectedModel(lastUsedModel)
      }
    } else {
      setSelectedModel(models[0])
      setLastUsedModelId(models[0]?.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.length])

  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <NavHeader />
        <div className="flex flex-1 flex-col items-center justify-center h-full gap-4 px-4 py-10 max-w-3xl w-full mx-auto ">
          <div className="mx-auto flex justify-center items-center h-full w-full rounded-xl">
            <div className="w-full text-center">
              {isPrivateChat ? (
                <>
                  <div className="flex items-center justify-center mb-3">
                    <div className="bg-foreground size-10 rounded-full flex items-center justify-center">
                      <HatGlassesIcon className="text-background/80 size-6" />
                    </div>
                    <div className="bg-foreground h-10 px-4 w-auto rounded-full flex items-center justify-center">
                      <span className="text-background/80 text-2xl font-medium">
                        private
                      </span>
                    </div>
                    <div className="bg-foreground h-10 px-4 w-auto rounded-full flex items-center justify-center">
                      <span className="text-background/80 text-2xl font-medium">
                        chat
                      </span>
                    </div>
                    <div className="bg-foreground h-10 px-4 w-auto rounded-full flex items-center justify-center">
                      <div className="flex items-center justify-center gap-1">
                        <div className="size-3 bg-background/80 rounded-full" />
                        <div className="size-3 bg-background/80 rounded-full" />
                        <div className="size-3 bg-background/80 rounded-full" />
                      </div>
                    </div>
                  </div>
                  <p className="w-full text-muted-foreground md:w-3/5 mx-auto mb-6">
                    This is a temporary chat. It won’t be saved to your
                    conversation history, can’t use memory, and will be deleted
                    when you close it.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-medium mb-6 font-studio">
                    How can I help you today?
                  </h2>
                </>
              )}
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
