import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ServerHostSwitcher } from '@/containers/ServerHostSwitcher'
import { PortInput } from '@/containers/PortInput'
import { ApiPrefixInput } from '@/containers/ApiPrefixInput'
import { TrustedHostsInput } from '@/containers/TrustedHostsInput'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useAppState } from '@/hooks/useAppState'
import { windowKey } from '@/constants/windows'
import { IconLogs } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { ApiKeyInput } from '@/containers/ApiKeyInput'
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

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
    runOnStartup,
    setRunOnStartup,
    serverHost,
    serverPort,
    apiPrefix,
    apiKey,
    trustedHosts,
  } = useLocalApiServer()

  const { serverStatus, setServerStatus } = useAppState()
  const [showApiKeyError, setShowApiKeyError] = useState(false)
  const [isApiKeyEmpty, setIsApiKeyEmpty] = useState(
    !apiKey || apiKey.toString().trim().length === 0
  )

  useEffect(() => {
    const checkServerStatus = async () => {
      invoke('get_server_status').then((running) => {
        if (running) {
          setServerStatus('running')
        }
      })
    }
    checkServerStatus()
  }, [setServerStatus])

  const handleApiKeyValidation = (isValid: boolean) => {
    setIsApiKeyEmpty(!isValid)
  }

  const toggleAPIServer = async () => {
    // Validate API key before starting server
    if (serverStatus === 'stopped') {
      if (!apiKey || apiKey.toString().trim().length === 0) {
        setShowApiKeyError(true)
        return
      }
      setShowApiKeyError(false)
    }

    setServerStatus('pending')
    if (serverStatus === 'stopped') {
      window.core?.api
        ?.startServer({
          host: serverHost,
          port: serverPort,
          prefix: apiPrefix,
          apiKey,
          trustedHosts,
          isCorsEnabled: corsEnabled,
          isVerboseEnabled: verboseLogs,
        })
        .then(() => {
          setServerStatus('running')
        })
        .catch((error: unknown) => {
          console.error('Error starting server:', error)
          setServerStatus('stopped')
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
        windowKey.logsWindowLocalApiServer
      )

      if (existingWindow) {
        // If window exists, focus it
        await existingWindow.setFocus()
        console.log('Focused existing logs window')
      } else {
        // Create a new logs window using Tauri v2 WebviewWindow API
        const logsWindow = new WebviewWindow(
          windowKey.logsWindowLocalApiServer,
          {
            url: route.localApiServerlogs,
            title: 'Local API server Logs - Jan',
            width: 800,
            height: 600,
            resizable: true,
            center: true,
          }
        )

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

  const isServerRunning = serverStatus === 'running'

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common:settings')}</h1>
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
                    <h1 className="text-base font-medium">
                      {t('settings:localApiServer.title')}
                    </h1>
                    <p className="text-main-view-fg/70 mb-2">
                      {t('settings:localApiServer.description')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={toggleAPIServer}
                      variant={isServerRunning ? 'destructive' : 'default'}
                      size="sm"
                    >
                      {isServerRunning
                        ? t('settings:localApiServer.stopServer')
                        : t('settings:localApiServer.startServer')}
                    </Button>
                  </div>
                </div>
              }
            >
              <CardItem
                title={t('settings:localApiServer.serverLogs')}
                description={t('settings:localApiServer.serverLogsDesc')}
                actions={
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0"
                    onClick={handleOpenLogs}
                    title={t('settings:localApiServer.serverLogs')}
                  >
                    <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                      <IconLogs size={18} className="text-main-view-fg/50" />
                      <span>{t('settings:localApiServer.openLogs')}</span>
                    </div>
                  </Button>
                }
              />
            </Card>

            {/* Startup Configuration */}
            <Card title={t('settings:localApiServer.startupConfiguration')}>
              <CardItem
                title={t('settings:localApiServer.runOnStartup')}
                description={t('settings:localApiServer.runOnStartupDesc')}
                actions={
                  <Switch
                    checked={runOnStartup}
                    onCheckedChange={(checked) => {
                      if (!apiKey || apiKey.toString().trim().length === 0) {
                        setShowApiKeyError(true)
                        return
                      }
                      setRunOnStartup(checked)
                    }}
                  />
                }
              />
            </Card>

            {/* Server Configuration */}
            <Card title={t('settings:localApiServer.serverConfiguration')}>
              <CardItem
                title={t('settings:localApiServer.serverHost')}
                description={t('settings:localApiServer.serverHostDesc')}
                className={cn(
                  isServerRunning && 'opacity-50 pointer-events-none'
                )}
                actions={<ServerHostSwitcher />}
              />
              <CardItem
                title={t('settings:localApiServer.serverPort')}
                description={t('settings:localApiServer.serverPortDesc')}
                className={cn(
                  isServerRunning && 'opacity-50 pointer-events-none'
                )}
                actions={<PortInput />}
              />
              <CardItem
                title={t('settings:localApiServer.apiPrefix')}
                description={t('settings:localApiServer.apiPrefixDesc')}
                className={cn(
                  isServerRunning && 'opacity-50 pointer-events-none'
                )}
                actions={<ApiPrefixInput />}
              />
              <CardItem
                title={t('settings:localApiServer.apiKey')}
                description={t('settings:localApiServer.apiKeyDesc')}
                className={cn(
                  'flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2',
                  isServerRunning && 'opacity-50 pointer-events-none',
                  isApiKeyEmpty && showApiKeyError && 'pb-6'
                )}
                classNameWrapperAction="w-full sm:w-auto"
                actions={
                  <ApiKeyInput
                    showError={showApiKeyError}
                    onValidationChange={handleApiKeyValidation}
                  />
                }
              />
              <CardItem
                title={t('settings:localApiServer.trustedHosts')}
                description={t('settings:localApiServer.trustedHostsDesc')}
                className={cn(
                  'flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2',
                  isServerRunning && 'opacity-50 pointer-events-none'
                )}
                classNameWrapperAction="w-full sm:w-auto"
                actions={<TrustedHostsInput />}
              />
            </Card>

            {/* Advanced Settings */}
            <Card title={t('settings:localApiServer.advancedSettings')}>
              <CardItem
                title={t('settings:localApiServer.cors')}
                description={t('settings:localApiServer.corsDesc')}
                className={cn(
                  isServerRunning && 'opacity-50 pointer-events-none'
                )}
                actions={
                  <Switch
                    checked={corsEnabled}
                    onCheckedChange={setCorsEnabled}
                  />
                }
              />
              <CardItem
                title={t('settings:localApiServer.verboseLogs')}
                description={t('settings:localApiServer.verboseLogsDesc')}
                className={cn(
                  isServerRunning && 'opacity-50 pointer-events-none'
                )}
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
