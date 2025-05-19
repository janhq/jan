import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import { ServerHostSwitcher } from '@/containers/ServerHostSwitcher'
import { PortInput } from '@/containers/PortInput'
import { ApiPrefixInput } from '@/containers/ApiPrefixInput'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useAppState } from '@/hooks/useAppState'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.local_api_server as any)({
  component: LocalAPIServer,
})

function LocalAPIServer() {
  const { t } = useTranslation()
  const {
    corsEnabled,
    setCorsEnabled,
    verboseLogs,
    setVerboseLogs,
    serverHost,
    serverPort,
    apiPrefix,
  } = useLocalApiServer()

  const { serverStatus, setServerStatus } = useAppState()

  const toggleAPIServer = async () => {
    setServerStatus('pending')
    if (serverStatus === 'stopped') {
      window.core?.api
        ?.startServer({
          host: serverHost,
          port: serverPort,
          prefix: apiPrefix,
          isCorsEnabled: corsEnabled,
          isVerboseEnabled: verboseLogs,
        })
        .then(() => {
          setServerStatus('running')
        })
    } else {
      window.core?.api
        ?.stopServer()
        .then(() => {
          setServerStatus('stopped')
        })
        .catch((error: unknown) => {
          console.error('Error stopping server:', error)
          setServerStatus('stopped')
        })
    }
  }

  const handleOpenLogs = async () => {
    try {
      // Check if logs window already exists
      const existingWindow = await WebviewWindow.getByLabel(
        'logs-window-local-api-server'
      )

      if (existingWindow) {
        // If window exists, focus it
        await existingWindow.setFocus()
        console.log('Focused existing logs window')
      } else {
        // Create a new logs window using Tauri v2 WebviewWindow API
        const logsWindow = new WebviewWindow('logs-window-local-api-server', {
          url: '/local-api-server/logs',
          title: 'Local API server Logs - Jan',
          width: 800,
          height: 600,
          resizable: true,
          center: true,
        })

        // Listen for window creation
        logsWindow.once('tauri://created', () => {
          console.log('Logs window created')
        })

        // Listen for window errors
        logsWindow.once('tauri://error', (e) => {
          console.error('Error creating logs window:', e)
        })
      }
    } catch (error) {
      console.error('Failed to open logs window:', error)
    }
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
            <Card
              header={
                <div className="mb-3 flex w-full items-center border-b border-main-view-fg/4 pb-2">
                  <div className="w-full space-y-2">
                    <h1 className="text-base font-medium">Local API Server</h1>
                    <p className="text-main-view-fg/70 mb-2">
                      Start an OpenAI-compatible local HTTP server.
                    </p>
                  </div>
                  <Button onClick={toggleAPIServer}>
                    {`${serverStatus === 'running' ? 'Stop' : 'Start'}`} Server
                  </Button>
                </div>
              }
            >
              <CardItem
                title="Server Logs"
                description="View detailed logs of the local API server"
                actions={
                  <Button variant="link" size="sm" onClick={handleOpenLogs}>
                    Open Logs
                  </Button>
                }
              />
            </Card>

            {/* Server Configuration */}
            <Card title="Server Configuration">
              <CardItem
                title="Server Host"
                description="Choose between 127.0.0.1 or 0.0.0.0"
                actions={<ServerHostSwitcher />}
              />
              <CardItem
                title="Server Port"
                description="Set the port number for the API server"
                actions={<PortInput />}
              />
              <CardItem
                title="API Prefix"
                description="Set the API endpoint prefix"
                actions={<ApiPrefixInput />}
              />
            </Card>

            {/* Advanced Settings */}
            <Card title="Advanced Settings">
              <CardItem
                title="Cross-Origin Resource Sharing (CORS)"
                description="Allow requests from different origins to access the API"
                actions={
                  <Switch
                    checked={corsEnabled}
                    onCheckedChange={setCorsEnabled}
                  />
                }
              />
              <CardItem
                title="Verbose Server Logs"
                description="Enable detailed logging for debugging purposes"
                actions={
                  <Switch
                    checked={verboseLogs}
                    onCheckedChange={setVerboseLogs}
                  />
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
