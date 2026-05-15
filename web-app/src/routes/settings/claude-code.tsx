import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { Card, CardItem } from '@/containers/Card'
import IntegrationModelSelector from '@/containers/IntegrationModelSelector'
import JanCodeRecommendation from '@/containers/JanCodeRecommendation'
import SettingsIntegrationPage from '@/containers/SettingsIntegrationPage'
import { Button } from '@/components/ui/button'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useClaudeCodeModel } from '@/hooks/useClaudeCodeModel'
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import AddEditCustomCliDialog from '@/containers/dialogs/AddEditCustomCliDialog'
import { useState } from 'react'
import { toast } from 'sonner'
import { getModelToStart } from '@/utils/getModelToStart'
import { invoke } from '@tauri-apps/api/core'
import { IconPlus } from '@tabler/icons-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.claude_code as any)({
  component: ClaudeCodeIntegration,
})

function ClaudeCodeIntegration() {
  const serviceHub = useServiceHub()
  const {
    corsEnabled,
    verboseLogs,
    serverHost,
    serverPort,
    setServerPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    proxyTimeout,
    setLastServerModels,
  } = useLocalApiServer()

  const { serverStatus, setServerStatus } = useAppState()
  const { providers, selectedModel, selectedProvider, getProviderByName } =
    useModelProvider()
  const setActiveModels = useAppState((state) => state.setActiveModels)

  const {
    models: helperModels,
    setModel: setHelperModel,
    setEnvVars,
    setCustomCli,
    clearModels,
  } = useClaudeCodeModel()

  const [isCustomCliDialogOpen, setIsCustomCliDialogOpen] = useState(false)
  const [isModelLoading, setIsModelLoading] = useState(false)

  const handleLaunchClaudeCode = async () => {
    const apiUrl = `http://${serverHost}:${serverPort}`
    const modelBig = helperModels.big
    const modelMedium = helperModels.medium
    const modelSmall = helperModels.small
    const customEnvVars = helperModels.envVars

    const startServer = async (): Promise<void> => {
      const helperModelsToStart = [
        { id: helperModels.big, role: 'Big' },
        { id: helperModels.medium, role: 'Medium' },
        { id: helperModels.small, role: 'Small' },
      ]
        .filter((m) => m.id)
        .map((m) => m.id as string)

      const loadedModels = (await serviceHub.models().getActiveModels()) || []
      const modelsToStart = helperModelsToStart.filter(
        (m) => !loadedModels.includes(m)
      )

      if (modelsToStart.length > 0) {
        setIsModelLoading(true)
        for (const modelId of modelsToStart) {
          const providerWithModel = providers.find((p) =>
            p.models.some((m) => m.id === modelId)
          )

          if (providerWithModel) {
            await serviceHub
              .models()
              .startModel(providerWithModel, modelId, true)
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
        const modelToStart = getModelToStart({
          selectedModel,
          selectedProvider,
          getProviderByName,
        })

        if (modelToStart) {
          setIsModelLoading(true)
          await serviceHub
            .models()
            .startModel(modelToStart.provider, modelToStart.model, true)
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

      let actualPort: number | undefined
      try {
        actualPort = await window.core?.api?.startServer({
          host: serverHost,
          port: serverPort,
          prefix: apiPrefix,
          apiKey,
          trustedHosts,
          isCorsEnabled: corsEnabled,
          isVerboseEnabled: verboseLogs,
          proxyTimeout: proxyTimeout,
        })
      } catch (startErr) {
        const msg =
          startErr instanceof Error ? startErr.message : String(startErr)
        if (!msg.includes('already running')) throw startErr
      }

      if (actualPort && actualPort !== serverPort) {
        setServerPort(actualPort)
      }
      setServerStatus('running')

      // Persist whichever models are actually running so next startup can restore them
      const activeModels = await serviceHub.models().getActiveModels().catch(() => [] as string[])
      if (activeModels.length > 0) {
        const serverModels = activeModels.flatMap((id) => {
          const p = providers.find((p) => p?.models?.some((m) => m.id === id))
          return p ? [{ model: id, provider: p.provider }] : []
        })
        if (serverModels.length > 0) setLastServerModels(serverModels)
      }
    }

    try {
      if (serverStatus === 'stopped') {
        toast.info('Starting server...', {
          description: 'Preparing server for Claude Code',
        })
        await startServer()
      }

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

  return (
    <SettingsIntegrationPage
      footer={
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
      }
    >
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
              <path d="M9 0H90V54H9V0Z" fill="#D77757" />
              <path d="M0 18H9V36H0V18Z" fill="#D77757" />
              <path d="M18 18H27V27H18V18Z" fill="black" />
              <path d="M72 18H81V27H72V18Z" fill="black" />
              <path d="M90 18H99V36H90V18Z" fill="#D77757" />
              <path d="M9 54H18V72H9V54Z" fill="#D77757" />
              <path d="M63 54H72V72H63V54Z" fill="#D77757" />
              <path d="M27 54H36V72H27V54Z" fill="#D77757" />
              <path d="M81 54H90V72H81V54Z" fill="#D77757" />
            </svg>
            <h1 className="text-foreground font-studio font-medium text-base">
              Claude Code integration
            </h1>
          </div>
        }
      >
        <CardItem
          title="Large Model"
          description="Opus"
          actions={
            <IntegrationModelSelector
              providers={providers}
              selectedModel={helperModels.big}
              onSelect={(model) => setHelperModel('big', model)}
              placeholder="Select Big Model"
              filterModel={(model) => model.isLocal || model.hasApiKey}
            />
          }
        />
        <CardItem
          title="Medium Model"
          description="Sonnet"
          actions={
            <IntegrationModelSelector
              providers={providers}
              selectedModel={helperModels.medium}
              onSelect={(model) => setHelperModel('medium', model)}
              placeholder="Select Medium Model"
              filterModel={(model) => model.isLocal || model.hasApiKey}
            />
          }
        />
        <CardItem
          title="Small Model"
          description="Haiku"
          actions={
            <IntegrationModelSelector
              providers={providers}
              selectedModel={helperModels.small}
              onSelect={(model) => setHelperModel('small', model)}
              placeholder="Select Small Model"
              filterModel={(model) => model.isLocal || model.hasApiKey}
            />
          }
          descriptionOutside={
            <JanCodeRecommendation
              selectedModel={helperModels.small}
              onSelect={(modelId: string) => setHelperModel('small', modelId)}
            />
          }
        />

        <div className="flex mt-2 justify-between gap-2 border-t pt-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsCustomCliDialogOpen(true)}
          >
            <IconPlus className="text-muted-foreground" size={14} />
            Environment Variables
          </Button>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                clearModels()
                try {
                  await invoke('clear_claude_code_env')
                  toast.success('Claude Code settings cleared')
                } catch (e) {
                  toast.error(`Failed to clear env file: ${e}`)
                }
              }}
            >
              Reset
            </Button>
            <Button
              size="sm"
              onClick={handleLaunchClaudeCode}
              disabled={isModelLoading}
            >
              {isModelLoading ? 'Loading models...' : 'Save & Enable'}
            </Button>
          </div>
        </div>

        {(helperModels.customCli || helperModels.envVars.length > 0) && (
          <div className="mt-3 text-sm text-muted-foreground">
            {helperModels.customCli && <div>Command: {helperModels.customCli}</div>}
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
    </SettingsIntegrationPage>
  )
}
