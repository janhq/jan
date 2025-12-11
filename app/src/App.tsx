import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { NavHeader } from '@/components/sidebar/nav-header'

import ChatInput from '@/components/chat-input'
import { useEffect } from 'react'
import { useModels } from '@/stores/models-store'
import { useLastUsedModel } from '@/stores/last-used-model-store'

function AppPageContent() {
  const models = useModels((state) => state.models)
  const setSelectedModel = useModels((state) => state.setSelectedModel)
  const lastUsedModelId = useLastUsedModel((state) => state.lastUsedModelId)
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
