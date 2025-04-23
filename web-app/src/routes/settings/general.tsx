import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { CardSetting, CardSettingItem } from '@/containers/CardSetting'

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
        <SettingsMenu />

        <div className="p-4 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-2 w-full">
            {/* General */}
            <CardSetting title="General">
              <CardSettingItem
                title="Start Automatically on boot"
                actions={<Switch />}
              />
              <CardSettingItem
                title="Automatic download new updates"
                actions={<Switch />}
              />
            </CardSetting>

            {/* Data folder */}
            <CardSetting title="Data Folder">
              <CardSettingItem
                title="App Data"
                description="Default location for messages and other user data."
                actions={<></>}
              />
              <CardSettingItem
                title="App Logs"
                description="Default location App Logs"
                actions={<></>}
              />
            </CardSetting>

            {/* Other */}
            <CardSetting title="Others">
              <CardSettingItem
                title="Spell Check"
                description="Turn on to enable spell check chat input."
                actions={<Switch />}
              />
              <CardSettingItem
                title="Reset To Factory Settings"
                description="Restore application to its initial state, erasing all models and chat history. This action is irreversible and recommended only if the application is corrupted."
                actions={
                  <Button variant="destructive" size="sm">
                    Reset
                  </Button>
                }
              />
            </CardSetting>
          </div>
        </div>
      </div>
    </div>
  )
}
