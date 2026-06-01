import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
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
import { ApiKeyInput } from '@/containers/ApiKeyInput'
import { CopyButton } from '@/containers/CopyButton'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { LogViewer } from '@/components/LogViewer'
import { ensureModelForServer } from '@/utils/ensureModelForServer'
import {
  hydrateActiveModelsForRunningServer,
  syncActiveModelsFromEngines,
} from '@/utils/activeModelsSync'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import {
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconLoader2,
  IconSettings2,
} from '@tabler/icons-react'

/**
 * Self-contained Local API Server control surface: start/stop, default model,
 * status, configuration popover, and server log. Renders no page chrome
 * (no HeaderPage / SettingsMenu) so it can be embedded both on the Launch
 * page and on the standalone settings route.
 */
export function LocalApiServerPanel() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const {
    corsEnabled,
    setCorsEnabled,
    verboseLogs,
    setVerboseLogs,
    serverHost,
    serverPort,
    setServerPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    proxyTimeout,
    setLastServerModels,
    defaultModelLocalApiServer,
  } = useLocalApiServer()

  const { serverStatus, setServerStatus } = useAppState()
  const [showApiKeyError, setShowApiKeyError] = useState(false)
  const localServerUrl = `http://127.0.0.1:${serverPort}${apiPrefix}`

  useEffect(() => {
    const checkServerStatus = async () => {
      try {
        const running = await serviceHub.app().getServerStatus()
        if (running) {
          setServerStatus('running')
          await hydrateActiveModelsForRunningServer(serviceHub.models())
        }
      } catch (error) {
        console.error('Failed to check server status:', error)
      }
    }
    checkServerStatus()

    const handleFocus = () => checkServerStatus()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [serviceHub, setServerStatus])

  const [isModelLoading, setIsModelLoading] = useState(false)

  const isServerRunning = serverStatus !== 'stopped'

  const toggleAPIServer = async () => {
    if (serverStatus === 'stopped') {
      toast.info('Starting server...', {
        description: `Attempting to start server on port ${serverPort}`,
      })

      setShowApiKeyError(false)
      setServerStatus('pending')

      ensureModelForServer({
        modelsService: serviceHub.models(),
        modelOverride: defaultModelLocalApiServer,
        onLoadStart: () => setIsModelLoading(true),
        onLoadEnd: () => setIsModelLoading(false),
      })
        .then(async (result) => {
          if (result.status === 'no_model_available') {
            throw new Error('No model available to load')
          }

          const activeModels = await serviceHub.models().getActiveModels()
          if (activeModels && activeModels.length > 0) {
            const allProviders = useModelProvider.getState().providers
            const serverModels = activeModels.flatMap((id: string) => {
              const p = allProviders.find((p) =>
                p?.models?.some((m: { id: string }) => m.id === id)
              )
              return p ? [{ model: id, provider: p.provider }] : []
            })
            if (serverModels.length > 0) setLastServerModels(serverModels)
          }

          const models = await serviceHub.models().getActiveModels()
          syncActiveModelsFromEngines(models || [])
        })
        .then(() => {
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
          if (actualPort && actualPort !== serverPort) {
            setServerPort(actualPort)
          }
          setServerStatus('running')
        })
        .catch((error: unknown) => {
          console.error('Error starting server or model:', error)
          setServerStatus('stopped')
          setIsModelLoading(false)
          toast.dismiss()

          const errorMsg =
            error && typeof error === 'object' && 'message' in error
              ? String(error.message)
              : String(error)

          if (errorMsg.includes('Address already in use')) {
            toast.error('Port has been occupied', {
              description: `Port ${serverPort} is already in use. Please try a different port.`,
            })
          } else if (
            errorMsg.includes('Invalid or inaccessible model path')
          ) {
            toast.error('Invalid or inaccessible model path', {
              description: errorMsg,
            })
          } else if (errorMsg.includes('model')) {
            toast.error('Failed to start model', {
              description: errorMsg,
            })
          } else {
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

  const getButtonContent = () => {
    if (isModelLoading || serverStatus === 'pending') {
      return (
        <>
          <IconLoader2 size={14} className="animate-spin" />
          {isModelLoading
            ? t('settings:localApiServer.loadingModel')
            : t('settings:localApiServer.startingServer')}
        </>
      )
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

  const configurationPopover = (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <IconSettings2 size={16} />
          {t('settings:localApiServer.serverConfiguration')}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[480px] max-h-[70vh] overflow-y-auto"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="font-semibold text-sm">
              {t('settings:localApiServer.serverConfiguration')}
            </h2>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t('settings:localApiServer.serverHost')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('settings:localApiServer.serverHostDesc')}
                </p>
              </div>
              <div>
                <ServerHostSwitcher isServerRunning={isServerRunning} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t('settings:localApiServer.serverPort')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('settings:localApiServer.serverPortDesc')}
                </p>
              </div>
              <PortInput isServerRunning={isServerRunning} />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t('settings:localApiServer.apiPrefix')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('settings:localApiServer.apiPrefixDesc')}
                </p>
              </div>
              <ApiPrefixInput isServerRunning={isServerRunning} />
            </div>
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium">
                {t('settings:localApiServer.apiKey')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('settings:localApiServer.apiKeyDesc')}
              </p>
              <div className="pt-1">
                <ApiKeyInput
                  isServerRunning={isServerRunning}
                  showError={showApiKeyError}
                />
              </div>
            </div>
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium">
                {t('settings:localApiServer.trustedHosts')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('settings:localApiServer.trustedHostsDesc')}
              </p>
              <div className="pt-1">
                <TrustedHostsInput isServerRunning={isServerRunning} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t('settings:localApiServer.proxyTimeout')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('settings:localApiServer.proxyTimeoutDesc')}
                </p>
              </div>
              <ProxyTimeoutInput isServerRunning={isServerRunning} />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-4 mt-4">
            <h2 className="font-semibold text-sm">
              {t('settings:localApiServer.advancedSettings')}
            </h2>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t('settings:localApiServer.cors')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('settings:localApiServer.corsDesc')}
                </p>
              </div>
              <Switch
                checked={corsEnabled}
                onCheckedChange={setCorsEnabled}
                disabled={isServerRunning}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t('settings:localApiServer.verboseLogs')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('settings:localApiServer.verboseLogsDesc')}
                </p>
              </div>
              <Switch
                checked={verboseLogs}
                onCheckedChange={setVerboseLogs}
                disabled={isServerRunning}
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )

  return (
    <div className="flex flex-col gap-4 gap-y-3 w-full">
      <Card
        header={
          <div className="mb-3 flex w-full items-center border-b pb-2">
            <div className="w-full space-y-2">
              <h1 className="text-base font-medium text-foreground font-studio">
                {t('settings:localApiServer.title')}
              </h1>
              <p className="text-muted-foreground mb-2">
                {t('settings:localApiServer.description')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {configurationPopover}
              <Button
                onClick={toggleAPIServer}
                variant={isServerRunning ? 'destructive' : 'default'}
                size="sm"
                disabled={serverStatus === 'pending' || isModelLoading}
              >
                {getButtonContent()}
              </Button>
            </div>
          </div>
        }
      >
        <CardItem
          title={t('settings:localApiServer.defaultModel')}
          description={
            <>
              {t('settings:localApiServer.defaultModelDesc')}{' '}
              {t('settings:localApiServer.defaultModelDescHint')}
              {defaultModelLocalApiServer?.provider ? (
                <Link
                  to={route.settings.providers}
                  params={{
                    providerName: defaultModelLocalApiServer.provider,
                  }}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {t('settings:localApiServer.defaultModelDescProvidersLink')}
                </Link>
              ) : (
                <Link
                  to={route.settings.model_providers}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {t('settings:localApiServer.defaultModelDescProvidersLink')}
                </Link>
              )}
              .
            </>
          }
          actions={
            <span className="text-sm text-muted-foreground truncate max-w-60">
              {defaultModelLocalApiServer?.model ??
                t('settings:localApiServer.defaultModelPlaceholder')}
            </span>
          }
        />
      </Card>

      <Card>
        <CardItem
          title="Server Status"
          description={
            isServerRunning ? (
              <div className="space-y-1">
                <div>The server is currently running.</div>
                <div className="text-xs font-mono flex items-center gap-1">
                  <a
                    href={localServerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {localServerUrl}
                  </a>
                  <CopyButton text={localServerUrl} />
                </div>
              </div>
            ) : (
              'The server is stopped.'
            )
          }
        />
      </Card>

      <Card>
        <Collapsible defaultOpen={false}>
          <div className="flex items-center justify-between">
            <CollapsibleTrigger className="flex items-center gap-2 hover:no-underline data-[state=open]:[&>svg.chevron-down]:hidden data-[state=closed]:[&>svg.chevron-up]:hidden">
              <IconChevronDown size={16} className="chevron-down" />
              <IconChevronUp size={16} className="chevron-up" />
              <span className="font-medium text-sm">Server Log</span>
            </CollapsibleTrigger>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenLogs}
              className="text-muted-foreground hover:text-foreground"
            >
              <IconExternalLink size={14} className="mr-1" />
              Open in New Window
            </Button>
          </div>
          <CollapsibleContent>
            <div className="pt-3">
              <div className="h-[200px]">
                <LogViewer />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  )
}
