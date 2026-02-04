import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { GatewaySettings } from '@/containers/Gateway'
import HeaderPage from '@/containers/HeaderPage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.gateway as any)({
  component: GatewayPage,
})

function GatewayPage() {
  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">Gateway</span>
        </div>
      </HeaderPage>
      <div className="p-4 pt-0 w-full overflow-y-auto">
        <GatewaySettings />
      </div>
    </div>
  )
}