import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

import { useModelProvider } from '@/hooks/useModelProvider'
import {
  IconPencil,
  IconEye,
  IconTool,
  IconAlertTriangle,
  IconLoader2,
  // IconWorld,
  // IconAtom,
  // IconCodeCircle2,
} from '@tabler/icons-react'
import { useState, useEffect } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { toast } from 'sonner'

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
  const { updateProvider, setProviders } = useModelProvider()
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [modelName, setModelName] = useState<string>('')
  const [originalModelName, setOriginalModelName] = useState<string>('')
  const [originalCapabilities, setOriginalCapabilities] = useState<
    Record<string, boolean>
  >({})
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const serviceHub = useServiceHub()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]) // Remove 'provider' dependency to prevent model ID changes when provider updates

  // Get the currently selected model
  const selectedModel = provider.models.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m: any) => m.id === selectedModelId
  )

  // Initialize capabilities and model name from selected model
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
      const modelNameValue = selectedModel.id
      setModelName(modelNameValue)
      setOriginalModelName(modelNameValue)

      const originalCaps = {
        completion: modelCapabilities.includes('completion'),
        vision: modelCapabilities.includes('vision'),
        tools: modelCapabilities.includes('tools'),
        embeddings: modelCapabilities.includes('embeddings'),
        web_search: modelCapabilities.includes('web_search'),
        reasoning: modelCapabilities.includes('reasoning'),
      }
      setOriginalCapabilities(originalCaps)
    }
  }, [selectedModel])

  // Update model capabilities - only update local state
  const handleCapabilityChange = (capability: string, enabled: boolean) => {
    setCapabilities((prev) => ({
      ...prev,
      [capability]: enabled,
    }))
  }

  // Handle model name change
  const handleModelNameChange = (newName: string) => {
    setModelName(newName)
  }

  // Check if there are unsaved changes
  const hasUnsavedChanges = () => {
    const nameChanged = modelName !== originalModelName
    const capabilitiesChanged =
      JSON.stringify(capabilities) !== JSON.stringify(originalCapabilities)
    return nameChanged || capabilitiesChanged
  }

  // Handle save changes
  const handleSaveChanges = async () => {
    if (!selectedModel?.id || isLoading) return

    setIsLoading(true)
    try {
      // Update model name if changed
      if (modelName !== originalModelName) {
        await serviceHub
          .models()
          .updateModel(selectedModel.id, { id: modelName })
        setOriginalModelName(modelName)
        await serviceHub.providers().getProviders().then(setProviders)
      }

      // Update capabilities if changed
      if (
        JSON.stringify(capabilities) !== JSON.stringify(originalCapabilities)
      ) {
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

        setOriginalCapabilities(capabilities)
      }

      // Show success toast and close dialog
      toast.success('Model updated successfully')
      setIsOpen(false)
    } catch (error) {
      console.error('Failed to update model:', error)
      toast.error('Failed to update model. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (!selectedModel) {
    return null
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
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

        {/* Model Name Section */}
        <div className="py-1">
          <label
            htmlFor="model-name"
            className="text-sm font-medium mb-3 block"
          >
            Model Name
          </label>
          <Input
            id="model-name"
            value={modelName}
            onChange={(e) => handleModelNameChange(e.target.value)}
            placeholder="Enter model name"
            className="w-full"
            disabled={isLoading}
          />
        </div>

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
                disabled={isLoading}
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
                disabled={isLoading}
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

        {/* Save Button */}
        <div className="flex justify-end pt-4">
          <Button
            onClick={handleSaveChanges}
            disabled={!hasUnsavedChanges() || isLoading}
            className="px-4 py-2"
          >
            {isLoading ? (
              <>
                <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
