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
import { ProxyTimeoutInput } from '@/containers/ProxyTimeoutInput'
import { ApiPrefixInput } from '@/containers/ApiPrefixInput'
import { TrustedHostsInput } from '@/containers/TrustedHostsInput'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { IconLogs } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { ApiKeyInput } from '@/containers/ApiKeyInput'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getModelToStart } from '@/utils/getModelToStart'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.local_api_server as any)({
  component: LocalAPIServerContent,
})

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
    setServerPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    proxyTimeout,
  } = useLocalApiServer()

  const { serverStatus, setServerStatus } = useAppState()
  const { selectedModel, selectedProvider, getProviderByName } =
    useModelProvider()
  const [showApiKeyError, setShowApiKeyError] = useState(false)
  const [isApiKeyEmpty, setIsApiKeyEmpty] = useState(
    !apiKey || apiKey.toString().trim().length === 0
  )
  const setActiveModels = useAppState((state) => state.setActiveModels)

  useEffect(() => {
    const checkServerStatus = async () => {
      serviceHub
        .app()
        .getServerStatus()
        .then((running) => {
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

  const [isModelLoading, setIsModelLoading] = useState(false)

  const toggleAPIServer = async () => {
    // Validate API key before starting server
    if (serverStatus === 'stopped') {
      console.log('Starting server with port:', serverPort)
      toast.info('Starting server...', {
        description: `Attempting to start server on port ${serverPort}`,
      })

      if (!apiKey || apiKey.toString().trim().length === 0) {
        setShowApiKeyError(true)
        return
      }
      setShowApiKeyError(false)

      setServerStatus('pending')

      // Check if there's already a loaded model
      serviceHub
        .models()
        .getActiveModels()
        .then((loadedModels) => {
          if (loadedModels && loadedModels.length > 0) {
            console.log(`Using already loaded model: ${loadedModels[0]}`)
            // Model already loaded, just start the server
            return Promise.resolve()
          } else {
            // No loaded model, start one first
            const modelToStart = getModelToStart({
              selectedModel,
              selectedProvider,
              getProviderByName,
            })

            // Only start server if we have a model to load
            if (!modelToStart) {
              console.warn(
                'Cannot start Local API Server: No model available to load'
              )
              throw new Error('No model available to load')
            }

            setIsModelLoading(true) // Start loading state

            // Start the model first
            return serviceHub
              .models()
              .startModel(modelToStart.provider, modelToStart.model)
              .then(() => {
                console.log(`Model ${modelToStart.model} started successfully`)
                setIsModelLoading(false) // Model loaded, stop loading state
                // Refresh active models after starting
                serviceHub
                  .models()
                  .getActiveModels()
                  .then((models) => setActiveModels(models || []))
                // Add a small delay for the backend to update state
                return new Promise((resolve) => setTimeout(resolve, 500))
              })
          }
        })
        .then(() => {
          // Then start the server
          return window.core?.api?.startServer({
            host: serverHost,
            port: serverPort,
            prefix: apiPrefix,
            apiKey,
            trustedHosts,
            isCorsEnabled: corsEnabled,
            isVerboseEnabled: verboseLogs,
            proxyTimeout: proxyTimeout,
          })
        })
        .then((actualPort: number) => {
          // Store the actual port that was assigned (important for mobile with port 0)
          if (actualPort && actualPort !== serverPort) {
            setServerPort(actualPort)
          }
          setServerStatus('running')
        })
        .catch((error: unknown) => {
          console.error('Error starting server or model:', error)
          setServerStatus('stopped')
          setIsModelLoading(false) // Reset loading state on error
          toast.dismiss()

          // Extract error message from various error formats
          const errorMsg =
            error && typeof error === 'object' && 'message' in error
              ? String(error.message)
              : String(error)

          // Port-related errors (highest priority)
          if (errorMsg.includes('Address already in use')) {
            toast.error('Port has been occupied', {
              description: `Port ${serverPort} is already in use. Please try a different port.`,
            })
          }
          // Model-related errors
          else if (errorMsg.includes('Invalid or inaccessible model path')) {
            toast.error('Invalid or inaccessible model path', {
              description: errorMsg,
            })
          } else if (errorMsg.includes('model')) {
            toast.error('Failed to start model', {
              description: errorMsg,
            })
          }
          // Generic server errors
          else {
            toast.error('Failed to start server', {
              description: errorMsg,
            })
          }
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

  const getButtonText = () => {
    if (isModelLoading) {
      return t('settings:localApiServer.loadingModel') // TODO: Update this translation
    }
    if (serverStatus === 'pending' && !isModelLoading) {
      return t('settings:localApiServer.startingServer') // TODO: Update this translation
    }
    return isServerRunning
      ? t('settings:localApiServer.stopServer')
      : t('settings:localApiServer.startServer')
  }

  const handleOpenLogs = async () => {
    try {
      await serviceHub.window().openLocalApiServerLogsWindow()
    } catch (error) {
      console.error('Failed to open logs window:', error)
    }
  }

  const isServerRunning = serverStatus !== 'stopped'

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
                      disabled={serverStatus === 'pending'} // Disable during any loading state
                    >
                      {getButtonText()}
                    </Button>
                  </div>
                </div>
              }
            >
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

              <CardItem
                title={t('settings:localApiServer.swaggerDocs')}
                description={t('settings:localApiServer.swaggerDocsDesc')}
                actions={
                  <a
                    href={`http://${serverHost}:${serverPort}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button
                      asChild
                      variant="link"
                      size="sm"
                      className="p-0 text-main-view-fg/80"
                      disabled={!isServerRunning}
                      title={t('settings:localApiServer.swaggerDocs')}
                    >
                      <div
                        className={cn(
                          'cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1',
                          !isServerRunning && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        <span>{t('settings:localApiServer.openDocs')}</span>
                      </div>
                    </Button>
                  </a>
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
              <CardItem
                title={t('settings:localApiServer.proxyTimeout')}
                description={t('settings:localApiServer.proxyTimeoutDesc')}
                actions={
                  <ProxyTimeoutInput isServerRunning={isServerRunning} />
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
