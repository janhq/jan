import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.modelProviders as any)({
  component: ModelProviders,
})

function ModelProviders() {
  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">Settings</h1>
      </HeaderPage>
      <div className="flex h-full">
        <div className="flex h-full w-48 shrink-0 px-1.5 pt-3 border-r border-neutral-800">
          <SettingsMenu />
        </div>
        <div className="p-4">
          <p>Model Providers</p>
        </div>
      </div>
    </div>
  )
}
