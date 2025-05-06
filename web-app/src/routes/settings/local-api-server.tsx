import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { CardSetting, CardSettingItem } from '@/containers/CardSetting'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import { ServerHostSwitcher } from '@/containers/ServerHostSwitcher'
import { PortInput } from '@/containers/PortInput'
import { ApiPrefixInput } from '@/containers/ApiPrefixInput'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.local_api_server as any)({
  component: LocalAPIServer,
})

function LocalAPIServer() {
  const { t } = useTranslation()
  const {
    runOnStartup,
    setRunOnStartup,
    corsEnabled,
    setCorsEnabled,
    verboseLogs,
    setVerboseLogs,
  } = useLocalApiServer()

  const handleOpenLogs = () => {
    // This would be implemented to open the logs
    console.log('Open logs clicked')
  }

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* General Settings */}
            <CardSetting
              header={
                <div className="mb-4 space-y-2">
                  <h1 className="text-base font-medium">Local API Server</h1>
                  <p className="text-main-view-fg/70 mb-2">
                    Configure the local API server settings to integrate with
                    external applications.
                  </p>
                </div>
              }
            >
              <CardSettingItem
                title="Run on Startup"
                description="Automatically start the local API server when the application opens"
                actions={
                  <Switch
                    checked={runOnStartup}
                    onCheckedChange={setRunOnStartup}
                  />
                }
              />
              <CardSettingItem
                title="Server Logs"
                description="View detailed logs of the local API server"
                actions={
                  <Button size="sm" onClick={handleOpenLogs}>
                    Open Logs
                  </Button>
                }
              />
            </CardSetting>

            {/* Server Configuration */}
            <CardSetting title="Server Configuration">
              <CardSettingItem
                title="Server Host"
                description="Choose between 127.0.0.1 or 0.0.0.0"
                actions={<ServerHostSwitcher />}
              />
              <CardSettingItem
                title="Server Port"
                description="Set the port number for the API server"
                actions={<PortInput />}
              />
              <CardSettingItem
                title="API Prefix"
                description="Set the API endpoint prefix"
                actions={<ApiPrefixInput />}
              />
            </CardSetting>

            {/* Advanced Settings */}
            <CardSetting title="Advanced Settings">
              <CardSettingItem
                title="Cross-Origin Resource Sharing (CORS)"
                description="Allow requests from different origins to access the API"
                actions={
                  <Switch
                    checked={corsEnabled}
                    onCheckedChange={setCorsEnabled}
                  />
                }
              />
              <CardSettingItem
                title="Verbose Server Logs"
                description="Enable detailed logging for debugging purposes"
                actions={
                  <Switch
                    checked={verboseLogs}
                    onCheckedChange={setVerboseLogs}
                  />
                }
              />
            </CardSetting>
          </div>
        </div>
      </div>
    </div>
  )
}
