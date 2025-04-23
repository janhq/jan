import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.general as any)({
  component: General,
})

function General() {
  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">Settings</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <div className="flex h-full w-48 shrink-0 px-1.5 pt-3 border-r border-neutral-800">
          <SettingsMenu />
        </div>
        <div className="p-4 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 w-full">
            {/* General */}
            <div className="bg-neutral-800/40 p-4 rounded-lg text-neutral-300 w-full">
              <h1 className="font-medium text-base mb-4">General</h1>
              <div className="flex justify-between items-center mt-2 border-b border-neutral-800 pb-3 last:border-none last:pb-0 gap-8">
                <div>
                  <h1 className="font-medium">Start Automatically on boot</h1>
                </div>
                <div className="shrink-0">
                  <Switch />
                </div>
              </div>
              <div className="flex justify-between items-center mt-2 border-b border-neutral-800 pb-3 last:border-none last:pb-0 gap-8">
                <div>
                  <h1 className="font-medium">
                    Automatic download new updates
                  </h1>
                </div>
                <div className="shrink-0">
                  <Switch />
                </div>
              </div>
            </div>
            {/* Data folder */}
            <div className="bg-neutral-800/40 p-4 rounded-lg text-neutral-300 w-full">
              <h1 className="font-medium text-base mb-4">Data Folder</h1>
              <div className="flex justify-between items-center mt-2 border-b border-neutral-800 pb-3 last:border-none last:pb-0 gap-8">
                <div className="space-y-1">
                  <h1 className="font-medium">App Data</h1>
                  <p className="text-neutral-400 leading-normal">
                    Default location for messages and other user data.
                  </p>
                </div>
                <div className="shrink-0">{/* <Switch /> */}</div>
              </div>
              <div className="flex justify-between items-center mt-2 border-b border-neutral-800 pb-3 last:border-none last:pb-0 gap-8">
                <div className="space-y-1">
                  <h1 className="font-medium">App Logs</h1>
                  <p className="text-neutral-400 leading-normal">
                    Default location App Logs
                  </p>
                </div>
                <div className="shrink-0">{/* <Switch /> */}</div>
              </div>
            </div>
            {/* Other */}
            <div className="bg-neutral-800/40 p-4 rounded-lg text-neutral-300 w-full">
              <h1 className="font-medium text-base mb-4">Others</h1>
              <div className="flex justify-between items-center mt-2 border-b border-neutral-800 pb-3 last:border-none last:pb-0 gap-8">
                <div className="space-y-1">
                  <h1 className="font-medium">Spell Check</h1>
                  <p className="text-neutral-400 leading-normal">
                    Turn on to enable spell check chat input.
                  </p>
                </div>
                <div className="shrink-0">
                  <Switch />
                </div>
              </div>
              <div className="flex justify-between items-center mt-2 border-b border-neutral-800 pb-3 last:border-none last:pb-0 gap-8">
                <div className="space-y-1">
                  <h1 className="font-medium">Reset To Factory Settings</h1>
                  <p className="text-neutral-400 leading-normal">
                    Restore application to its initial state, erasing all models
                    and chat history. This action is irreversible and
                    recommended only if the application is corrupted.
                  </p>
                </div>
                <div className="shrink-0">
                  <Button variant="destructive" size="sm">
                    Reset
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
