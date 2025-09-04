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
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { localStorageKey } from '@/constants/localStorage'
import { IconLogs } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { ApiKeyInput } from '@/containers/ApiKeyInput'
import { useEffect, useState } from 'react'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.local_api_server as any)({
  component: LocalAPIServer,
})

function LocalAPIServer() {
  return (
    <PlatformGuard feature={PlatformFeature.LOCAL_API_SERVER}>
      <LocalAPIServerContent />
    </PlatformGuard>
  )
}

function LocalAPIServerContent() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const {
    corsEnabled,
    setCorsEnabled,
    verboseLogs,
    setVerboseLogs,
    enableOnStartup,
    setEnableOnStartup,
    serverHost,
    serverPort,
    apiPrefix,
    apiKey,
    trustedHosts,
  } = useLocalApiServer()

  const { serverStatus, setServerStatus } = useAppState()
  const { selectedModel, selectedProvider, getProviderByName } =
    useModelProvider()
  const [showApiKeyError, setShowApiKeyError] = useState(false)
  const [isApiKeyEmpty, setIsApiKeyEmpty] = useState(
    !apiKey || apiKey.toString().trim().length === 0
  )

  useEffect(() => {
    const checkServerStatus = async () => {
      serviceHub.app().getServerStatus().then((running) => {
        if (running) {
          setServerStatus('running')
        }
      })
    }
    checkServerStatus()
  }, [serviceHub, setServerStatus])

  const handleApiKeyValidation = (isValid: boolean) => {
    setIsApiKeyEmpty(!isValid)
  }

  const getLastUsedModel = (): { provider: string; model: string } | null => {
    try {
      const stored = localStorage.getItem(localStorageKey.lastUsedModel)
      return stored ? JSON.parse(stored) : null
    } catch (error) {
      console.debug('Failed to get last used model from localStorage:', error)
      return null
    }
  }

  // Helper function to determine which model to start
  const getModelToStart = () => {
    // Use last used model if available
    const lastUsedModel = getLastUsedModel()
    if (lastUsedModel) {
      const provider = getProviderByName(lastUsedModel.provider)
      if (
        provider &&
        provider.models.some((m) => m.id === lastUsedModel.model)
      ) {
        return { model: lastUsedModel.model, provider }
      }
    }

    // Use selected model if available
    if (selectedModel && selectedProvider) {
      const provider = getProviderByName(selectedProvider)
      if (provider) {
        return { model: selectedModel.id, provider }
      }
    }

    // Use first model from llamacpp provider
    const llamacppProvider = getProviderByName('llamacpp')
    if (
      llamacppProvider &&
      llamacppProvider.models &&
      llamacppProvider.models.length > 0
    ) {
      return {
        model: llamacppProvider.models[0].id,
        provider: llamacppProvider,
      }
    }

    return null
  }

  const toggleAPIServer = async () => {
    // Validate API key before starting server
    if (serverStatus === 'stopped') {
      if (!apiKey || apiKey.toString().trim().length === 0) {
        setShowApiKeyError(true)
        return
      }
      setShowApiKeyError(false)

      const modelToStart = getModelToStart()
      // Only start server if we have a model to load
      if (!modelToStart) {
        console.warn(
          'Cannot start Local API Server: No model available to load'
        )
        return
      }

      setServerStatus('pending')

      // Start the model first
      serviceHub.models().startModel(modelToStart.provider, modelToStart.model)
        .then(() => {
          console.log(`Model ${modelToStart.model} started successfully`)

          // Then start the server
          return window.core?.api?.startServer({
            host: serverHost,
            port: serverPort,
            prefix: apiPrefix,
            apiKey,
            trustedHosts,
            isCorsEnabled: corsEnabled,
            isVerboseEnabled: verboseLogs,
          })
        })
        .then(() => {
          setServerStatus('running')
        })
        .catch((error: unknown) => {
          console.error('Error starting server:', error)
          setServerStatus('stopped')
        })
    } else {
      setServerStatus('pending')
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
      await serviceHub.window().openLocalApiServerLogsWindow()
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
                    checked={enableOnStartup}
                    onCheckedChange={(checked) => {
                      if (!apiKey || apiKey.toString().trim().length === 0) {
                        setShowApiKeyError(true)
                        return
                      }
                      setEnableOnStartup(checked)
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
                actions={
                  <ServerHostSwitcher isServerRunning={isServerRunning} />
                }
              />
              <CardItem
                title={t('settings:localApiServer.serverPort')}
                description={t('settings:localApiServer.serverPortDesc')}
                actions={<PortInput isServerRunning={isServerRunning} />}
              />
              <CardItem
                title={t('settings:localApiServer.apiPrefix')}
                description={t('settings:localApiServer.apiPrefixDesc')}
                actions={<ApiPrefixInput isServerRunning={isServerRunning} />}
              />
              <CardItem
                title={t('settings:localApiServer.apiKey')}
                description={t('settings:localApiServer.apiKeyDesc')}
                className={cn(
                  'flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2',
                  isApiKeyEmpty && showApiKeyError && 'pb-6'
                )}
                classNameWrapperAction="w-full sm:w-auto"
                actions={
                  <ApiKeyInput
                    isServerRunning={isServerRunning}
                    showError={showApiKeyError}
                    onValidationChange={handleApiKeyValidation}
                  />
                }
              />
              <CardItem
                title={t('settings:localApiServer.trustedHosts')}
                description={t('settings:localApiServer.trustedHostsDesc')}
                className={cn(
                  'flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2'
                )}
                classNameWrapperAction="w-full sm:w-auto"
                actions={
                  <TrustedHostsInput isServerRunning={isServerRunning} />
                }
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
