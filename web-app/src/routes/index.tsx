import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import ChatInput from '@/containers/ChatInput'
import { getGreeting } from '@/lib/utils'
import HeaderPage from '@/containers/HeaderPage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.home as any)({
  component: Index,
})

function Index() {
  return (
    <div className="flex h-full flex-col flex-justify-center">
      <HeaderPage>
        <h1 className="font-medium">Default Model</h1>
      </HeaderPage>
      <div className="h-full px-8 overflow-y-auto flex flex-col gap-2 justify-center">
        <div className="w-4/6 mx-auto">
          <div className="mb-8 text-center">
            <h1 className="font-editorialnew text-main-view-fg text-4xl">{`Hello, ${getGreeting()}`}</h1>
            <p className="text-main-view-fg/70 text-lg mt-2">
              How can I help you today?
            </p>
          </div>
          <div className="flex-1 shrink-0">
            <ChatInput />
          </div>
        </div>
      </div>
    </div>
  )
}
