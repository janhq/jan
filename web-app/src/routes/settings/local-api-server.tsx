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
import { useClaudeCodeModel } from '@/hooks/useClaudeCodeModel'
import AddEditCustomCliDialog from '@/containers/dialogs/AddEditCustomCliDialog'
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { IconSettings2 } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { ApiKeyInput } from '@/containers/ApiKeyInput'
import { useEffect, useState, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { getModelToStart } from '@/utils/getModelToStart'
import { LogViewer } from '@/components/LogViewer'
import { invoke } from '@tauri-apps/api/core'
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
  IconExternalLink,
  IconPlus,
  IconX,
} from '@tabler/icons-react'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import Capabilities from '@/containers/Capabilities'
import { getModelDisplayName, isLocalProvider } from '@/lib/utils'

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
  const { providers, selectedModel, selectedProvider, getProviderByName } =
    useModelProvider()
  const [showApiKeyError, setShowApiKeyError] = useState(false)
  const [, setIsApiKeyEmpty] = useState(
    !apiKey || apiKey.toString().trim().length === 0
  )
  const { activeModels } = useAppState()
  const setActiveModels = useAppState((state) => state.setActiveModels)

  // Helper card state (persisted to localStorage)
  const {
    models: helperModels,
    setModel: setHelperModel,
    setEnvVars,
    setCustomCli,
  } = useClaudeCodeModel()
  const [isCustomCliDialogOpen, setIsCustomCliDialogOpen] = useState(false)

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

      // if (!apiKey || apiKey.toString().trim().length === 0) {
      //   setShowApiKeyError(true)
      //   return
      // }

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
      return '...loading model'
    }
    if (serverStatus === 'pending' && !isModelLoading) {
      return t('settings:localApiServer.startingServer') 
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

  const handleLaunchClaudeCode = async () => {
    // Do not append apiPrefix to claude code settings
    const apiUrl = `http://${serverHost}:${serverPort}`
    const modelBig = helperModels.big
    const modelMedium = helperModels.medium
    const modelSmall = helperModels.small
    const customEnvVars = helperModels.envVars

    // Helper function to start the server with selected models
    const startServer = async (): Promise<void> => {
      // Get helper models that need to be started
      const helperModelsToStart = [
        { id: helperModels.big, role: 'Big' },
        { id: helperModels.medium, role: 'Medium' },
        { id: helperModels.small, role: 'Small' },
      ]
        .filter((m) => m.id)
        .map((m) => m.id as string)

      // Check which helper models are already loaded
      const loadedModels = (await serviceHub.models().getActiveModels()) || []
      const modelsToStart = helperModelsToStart.filter(
        (m) => !loadedModels.includes(m)
      )

      if (modelsToStart.length > 0) {
        setIsModelLoading(true)
        for (const modelId of modelsToStart) {
          // Find the provider that has this model
          const providerWithModel = providers.find((p) =>
            p.models.some((m) => m.id === modelId)
          )

          if (providerWithModel) {
            await serviceHub
              .models()
              .startModel(providerWithModel, modelId)
              .then(() => {
                console.log(`Model ${modelId} started successfully`)
              })
          }
        }
        setIsModelLoading(false)
        await serviceHub
          .models()
          .getActiveModels()
          .then((models) => setActiveModels(models || []))
        await new Promise((resolve) => setTimeout(resolve, 500))
      } else if (loadedModels.length > 0) {
        console.log(`Using already loaded models: ${loadedModels.join(', ')}`)
      } else if (helperModelsToStart.length === 0) {
        // No helper models selected, start default model if available
        const modelToStart = getModelToStart({
          selectedModel,
          selectedProvider,
          getProviderByName,
        })

        if (modelToStart) {
          setIsModelLoading(true)
          await serviceHub
            .models()
            .startModel(modelToStart.provider, modelToStart.model)
            .then(() => {
              console.log(`Model ${modelToStart.model} started successfully`)
              setIsModelLoading(false)
              serviceHub
                .models()
                .getActiveModels()
                .then((models) => setActiveModels(models || []))
              return new Promise((resolve) => setTimeout(resolve, 500))
            })
        }
      }

      const actualPort = await window.core?.api?.startServer({
        host: serverHost,
        port: serverPort,
        prefix: apiPrefix,
        apiKey,
        trustedHosts,
        isCorsEnabled: corsEnabled,
        isVerboseEnabled: verboseLogs,
        proxyTimeout: proxyTimeout,
      })

      if (actualPort && actualPort !== serverPort) {
        setServerPort(actualPort)
      }
      setServerStatus('running')
    }

    try {
      // If server is not running, start it first
      if (serverStatus === 'stopped') {
        toast.info('Starting server...', {
          description: 'Preparing server for Claude Code',
        })
        await startServer()
      }

      // Now launch Claude Code with config
      await invoke('launch_claude_code_with_config', {
        apiUrl,
        apiKey: apiKey || undefined,
        bigModel: modelBig || undefined,
        mediumModel: modelMedium || undefined,
        smallModel: modelSmall || undefined,
        customEnvVars: customEnvVars.map((env) => ({
          key: env.key,
          value: env.value,
        })),
      })
      toast.success(
        'Environment variables updated. Please try relaunching Claude Code in a new terminal window.',
        {
          duration: 8000,
        }
      )
    } catch (error) {
      console.error('Failed to launch Claude Code:', error)
      const errorMsg = error instanceof Error ? error.message : String(error)
      toast.error('Failed to configure env vars', {
        description: errorMsg,
      })
    }
  }

  const isServerRunning = serverStatus !== 'stopped'

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center justify-between w-full mr-2 pr-4">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="relative z-50">
                <IconSettings2 size={16} />
                Configuration
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
                        onValidationChange={handleApiKeyValidation}
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
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="flex-1 flex flex-col min-h-0 pl-0">
          <div className="flex-1 overflow-y-auto p-4 pt-0">
            <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
              {/* General Settings */}
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
              </Card>

              <Card>
                <CardItem
                  title="Server Status"
                  description={
                    isServerRunning ? (
                      <div className="space-y-1">
                        <div>The server is currently running.</div>
                        <div className="text-xs font-mono">
                          http://{serverHost}:{serverPort}
                          {apiPrefix}
                        </div>
                      </div>
                    ) : (
                      'The server is stopped.'
                    )
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
                      className={cn(
                        isServerRunning ? '' : 'pointer-events-none'
                      )}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!isServerRunning}
                        title={t('settings:localApiServer.swaggerDocs')}
                      >
                        <span>{t('settings:localApiServer.openDocs')}</span>
                      </Button>
                    </a>
                  }
                />
              </Card>

              {/* Helper Card */}
              <Card
                header={
                  <div className="mb-3 flex w-full items-center gap-3">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 99 72"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="shrink-0"
                    >
                      <path
                        d="M9 0H90V54H9V0Z"
                        fill="#D77757"
                      />
                      <path
                        d="M0 18H9V36H0V18Z"
                        fill="#D77757"
                      />
                      <path
                        d="M18 18H27V27H18V18Z"
                        fill="black"
                      />
                      <path
                        d="M72 18H81V27H72V18Z"
                        fill="black"
                      />
                      <path
                        d="M90 18H99V36H90V18Z"
                        fill="#D77757"
                      />
                      <path
                        d="M9 54H18V72H9V54Z"
                        fill="#D77757"
                      />
                      <path
                        d="M63 54H72V72H63V54Z"
                        fill="#D77757"
                      />
                      <path
                        d="M27 54H36V72H27V54Z"
                        fill="#D77757"
                      />
                      <path
                        d="M81 54H90V72H81V54Z"
                        fill="#D77757"
                      />
                    </svg>
                    <h1 className="text-foreground font-studio font-medium text-base">
                      Run with your Claude Code
                    </h1>
                  </div>
                }
              >
                <CardItem
                  title="Large Model"
                  description="Opus"
                  actions={
                    <HelperModelSelector
                      providers={providers}
                      activeModels={activeModels}
                      selectedModel={helperModels.big}
                      onSelect={(model) => setHelperModel('big', model)}
                      placeholder="Select Big Model"
                    />
                  }
                />
                <CardItem
                  title="Medium Model"
                  description="Sonnet"
                  actions={
                    <HelperModelSelector
                      providers={providers}
                      activeModels={activeModels}
                      selectedModel={helperModels.medium}
                      onSelect={(model) => setHelperModel('medium', model)}
                      placeholder="Select Medium Model"
                    />
                  }
                />
                <CardItem
                  title="Small Model"
                  description="Haiku"
                  actions={
                    <HelperModelSelector
                      providers={providers}
                      activeModels={activeModels}
                      selectedModel={helperModels.small}
                      onSelect={(model) => setHelperModel('small', model)}
                      placeholder="Select Small Model"
                    />
                  }
                />
                <div className="flex mt-2 justify-between gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsCustomCliDialogOpen(true)}
                  >
                    <IconPlus className="text-muted-foreground" size={14} />
                    Custom CLI
                  </Button>
                  <Button size="sm" onClick={handleLaunchClaudeCode}>
                    Enable Jan in Claude Code
                  </Button>
                </div>

                {/* Display Custom CLI Configuration */}
                {(helperModels.customCli ||
                  helperModels.envVars.length > 0) && (
                  <div className="mt-3 text-sm text-muted-foreground">
                    {helperModels.customCli && (
                      <div>Command: {helperModels.customCli}</div>
                    )}
                    {helperModels.envVars.length > 0 && (
                      <div className="break-all">
                        Env:{' '}
                        {helperModels.envVars
                          .map((env) => `${env.key}=******`)
                          .join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </div>
          </div>
          <AddEditCustomCliDialog
            open={isCustomCliDialogOpen}
            onOpenChange={setIsCustomCliDialogOpen}
            initialEnvVars={helperModels.envVars}
            initialCustomCli={helperModels.customCli}
            onSave={(envVars, customCli) => {
              setEnvVars(envVars)
              setCustomCli(customCli)
            }}
          />
          <div className="p-4 shrink-0">
            <Card>
              <Collapsible defaultOpen={false}>
                <div className="flex items-center justify-between">
                  <CollapsibleTrigger className="flex items-center gap-2 hover:no-underline">
                    <IconChevronDown
                      size={16}
                      className="transition-transform data-[state=open]:rotate-180"
                    />
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
        </div>
      </div>
    </div>
  )
}

function HelperModelSelector({
  providers,
  activeModels,
  selectedModel,
  onSelect,
  placeholder = 'Select a model',
}: {
  providers: ModelProvider[]
  activeModels: string[]
  selectedModel: string | null
  onSelect: (modelId: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Get available models:
  // - Local providers (llamacpp, mlx): show models (they're downloaded locally)
  // - Remote providers: show models only if API key is configured
  const availableModels = useMemo(() => {
    return providers
      .filter((p) => p.active)
      .flatMap((p) =>
        p.models.map((m) => ({
          ...m,
          providerName: p.provider,
          isLocal: isLocalProvider(p.provider),
          hasApiKey: !!p.api_key?.length,
        }))
      )
      .filter((m) => {
        // Local providers: show all models (they're downloaded locally)
        if (m.isLocal) {
          return m.id
        }
        // Remote providers: only show if API key configured
        return m.hasApiKey
      })
  }, [providers, activeModels])

  // Filter models by search value
  const filteredModels = useMemo(() => {
    if (!searchValue.trim()) return availableModels
    const search = searchValue.toLowerCase()
    return availableModels.filter(
      (m) =>
        m.id.toLowerCase().includes(search) ||
        (m.displayName?.toLowerCase() ?? '').includes(search) ||
        m.providerName.toLowerCase().includes(search)
    )
  }, [availableModels, searchValue])

  // Group by provider
  const groupedModels = useMemo(() => {
    const groups: Record<string, typeof filteredModels> = {}
    filteredModels.forEach((model) => {
      if (!groups[model.providerName]) {
        groups[model.providerName] = []
      }
      groups[model.providerName].push(model)
    })
    return groups
  }, [filteredModels])

  const currentModel = availableModels.find(
    (m) => m.id === selectedModel
  )

  // Format model display name with size
  const formatModelWithSize = (model: NonNullable<typeof currentModel>) => {
    const name = getModelDisplayName(model)
    // Model size is not directly available in provider models
    // Could be extended to show size if available in settings/metadata
    return name
  }

  const handleSelect = (model: (typeof filteredModels)[0]) => {
    onSelect(model.id)
    setOpen(false)
    setSearchValue('')
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (!isOpen) {
      setSearchValue('')
    } else {
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[280px]">
          <span className="flex items-center gap-2 truncate leading-normal">
            {selectedModel && currentModel ? (
              <>
                <span
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-full shrink-0',
                    currentModel.isLocal
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-blue-500/10 text-blue-600'
                  )}
                >
                  {currentModel.isLocal ? 'Local' : 'Remote'}
                </span>
                <span>{formatModelWithSize(currentModel)}</span>
              </>
            ) : (
              placeholder
            )}
          </span>
          <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[280px] p-0 bg-background/95 border"
        align="end"
        sideOffset={8}
      >
        <div className="flex flex-col size-full">
          {/* Search input */}
          <div className="relative p-2 border-b">
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search models..."
              className="text-sm font-normal outline-0 w-full"
            />
            {searchValue.length > 0 && (
              <div className="absolute right-2 top-0 bottom-0 flex items-center justify-center">
                <IconX
                  size={16}
                  className="text-muted-foreground cursor-pointer"
                  onClick={() => setSearchValue('')}
                />
              </div>
            )}
          </div>

          {/* Model list */}
          <div className="max-h-[300px] overflow-y-auto">
            {Object.keys(groupedModels).length === 0 && searchValue ? (
              <div className="py-3 px-4 text-sm text-muted-foreground">
                No models found for "{searchValue}"
              </div>
            ) : (
              <div className="py-1">
                {Object.entries(groupedModels).map(([providerKey, models]) => {
                  const providerInfo = providers.find(
                    (p) => p.provider === providerKey
                  )
                  if (!providerInfo) return null

                  return (
                    <div
                      key={providerKey}
                      className="bg-secondary/30 rounded-sm my-1.5 mx-1.5 first:mt-1 py-1"
                    >
                      {/* Provider header */}
                      <div className="flex items-center gap-1.5 px-2 py-1">
                        <ProvidersAvatar provider={providerInfo} />
                        <span className="capitalize text-sm font-medium text-muted-foreground">
                          {providerKey}
                        </span>
                      </div>

                      {/* Models for this provider */}
                      {models.map((model) => {
                        const isSelected = selectedModel === model.id
                        const capabilities = model.capabilities || []

                        return (
                          <div
                            key={model.id}
                            title={model.id}
                            onClick={() => handleSelect(model)}
                            className={cn(
                              'mx-1 mb-1 px-2 py-1.5 rounded-sm cursor-pointer flex items-center gap-2 transition-all duration-200',
                              'hover:bg-secondary/40',
                              isSelected &&
                                'bg-secondary/60 hover:bg-secondary/60'
                            )}
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span
                                className="text-sm truncate"
                                title={model.id}
                              >
                                {getModelDisplayName(model)}
                              </span>
                              <div className="flex-1"></div>
                              {capabilities.length > 0 && (
                                <div className="shrink-0 -mr-1.5">
                                  <Capabilities capabilities={capabilities} />
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
