import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'

import { useModelProvider } from '@/hooks/useModelProvider'
import {
  IconPencil,
  IconEye,
  IconTool,
  IconAlertTriangle,
  // IconWorld,
  // IconAtom,
  // IconCodeCircle2,
} from '@tabler/icons-react'
import { useState, useEffect } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'

// No need to define our own interface, we'll use the existing Model type
type DialogEditModelProps = {
  provider: ModelProvider
  modelId?: string // Optional model ID to edit
}

export const DialogEditModel = ({
  provider,
  modelId,
}: DialogEditModelProps) => {
  const { t } = useTranslation()
  const { updateProvider } = useModelProvider()
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({
    completion: false,
    vision: false,
    tools: false,
    reasoning: false,
    embeddings: false,
    web_search: false,
  })

  // Initialize with the provided model ID or the first model if available
  useEffect(() => {
    if (modelId) {
      setSelectedModelId(modelId)
    } else if (provider.models && provider.models.length > 0) {
      setSelectedModelId(provider.models[0].id)
    }
  }, [provider, modelId])

  // Get the currently selected model
  const selectedModel = provider.models.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m: any) => m.id === selectedModelId
  )

  // Initialize capabilities from selected model
  useEffect(() => {
    if (selectedModel) {
      const modelCapabilities = selectedModel.capabilities || []
      setCapabilities({
        completion: modelCapabilities.includes('completion'),
        vision: modelCapabilities.includes('vision'),
        tools: modelCapabilities.includes('tools'),
        embeddings: modelCapabilities.includes('embeddings'),
        web_search: modelCapabilities.includes('web_search'),
        reasoning: modelCapabilities.includes('reasoning'),
      })
    }
  }, [selectedModel])

  // Track if capabilities were updated by user action
  const [capabilitiesUpdated, setCapabilitiesUpdated] = useState(false)

  // Update model capabilities - only update local state
  const handleCapabilityChange = (capability: string, enabled: boolean) => {
    setCapabilities((prev) => ({
      ...prev,
      [capability]: enabled,
    }))
    // Mark that capabilities were updated by user action
    setCapabilitiesUpdated(true)
  }

  // Use effect to update the provider when capabilities are explicitly changed by user
  useEffect(() => {
    // Only run if capabilities were updated by user action and we have a selected model
    if (!capabilitiesUpdated || !selectedModel) return

    // Reset the flag
    setCapabilitiesUpdated(false)

    // Create updated capabilities array from the state
    const updatedCapabilities = Object.entries(capabilities)
      .filter(([, isEnabled]) => isEnabled)
      .map(([capName]) => capName)

    // Find and update the model in the provider
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatedModels = provider.models.map((m: any) => {
      if (m.id === selectedModelId) {
        return {
          ...m,
          capabilities: updatedCapabilities,
          // Mark that user has manually configured capabilities
          _userConfiguredCapabilities: true,
        }
      }
      return m
    })

    // Update the provider with the updated models
    updateProvider(provider.provider, {
      ...provider,
      models: updatedModels,
    })
  }, [
    capabilitiesUpdated,
    capabilities,
    provider,
    selectedModel,
    selectedModelId,
    updateProvider,
  ])

  if (!selectedModel) {
    return null
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <div className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out">
          <IconPencil size={18} className="text-main-view-fg/50" />
        </div>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="line-clamp-1" title={selectedModel.id}>
            {t('providers:editModel.title', { modelId: selectedModel.id })}
          </DialogTitle>
          <DialogDescription>
            {t('providers:editModel.description')}
          </DialogDescription>
        </DialogHeader>

        {/* Warning Banner */}
        <div className="bg-main-view-fg/5 border border-main-view-fg/10 rounded-md p-3">
          <div className="flex items-start space-x-3">
            <IconAlertTriangle className="size-5 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-main-view-fg/80">
              <p className="font-medium mb-1 text-base">
                {t('providers:editModel.warning.title')}
              </p>
              <p className="text-main-view-fg/70">
                {t('providers:editModel.warning.description')}
              </p>
            </div>
          </div>
        </div>

        <div className="py-1">
          <h3 className="text-sm font-medium mb-3">
            {t('providers:editModel.capabilities')}
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <IconTool className="size-4 text-main-view-fg/70" />
                <span className="text-sm">
                  {t('providers:editModel.tools')}
                </span>
              </div>
              <Switch
                id="tools-capability"
                checked={capabilities.tools}
                onCheckedChange={(checked) =>
                  handleCapabilityChange('tools', checked)
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <IconEye className="size-4 text-main-view-fg/70" />
                <span className="text-sm">
                  {t('providers:editModel.vision')}
                </span>
              </div>
              <Switch
                id="vision-capability"
                checked={capabilities.vision}
                onCheckedChange={(checked) =>
                  handleCapabilityChange('vision', checked)
                }
              />
            </div>

            {/* <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <IconCodeCircle2 className="size-4 text-main-view-fg/70" />
                <span className="text-sm">
                  {t('providers:editModel.embeddings')}
                </span>
              </div>
              <Tooltip>
                <TooltipTrigger>
                  <Switch
                    id="embedding-capability"
                    disabled={true}
                    checked={capabilities.embeddings}
                    onCheckedChange={(checked) =>
                      handleCapabilityChange('embeddings', checked)
                    }
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {t('providers:editModel.notAvailable')}
                </TooltipContent>
              </Tooltip>
            </div> */}

            {/* <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <IconWorld className="size-4 text-main-view-fg/70" />
                <span className="text-sm">Web Search</span>
              </div>
              <Switch
                id="web_search-capability"
                checked={capabilities.web_search}
                onCheckedChange={(checked) =>
                  handleCapabilityChange('web_search', checked)
                }
              />
            </div> */}

            {/* <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <IconAtom className="size-4 text-main-view-fg/70" />
                <span className="text-sm">{t('reasoning')}</span>
              </div>
              <Switch
                id="reasoning-capability"
                checked={capabilities.reasoning}
                onCheckedChange={(checked) =>
                  handleCapabilityChange('reasoning', checked)
                }
              />
            </div> */}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
