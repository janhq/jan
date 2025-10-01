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
  const { updateProvider } = useModelProvider()
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [displayName, setDisplayName] = useState<string>('')
  const [originalDisplayName, setOriginalDisplayName] = useState<string>('')
  const [originalCapabilities, setOriginalCapabilities] = useState<
    Record<string, boolean>
  >({})
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
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
    // Only set the selected model ID if the dialog is not open to prevent switching during downloads
    if (!isOpen) {
      if (modelId) {
        setSelectedModelId(modelId)
      } else if (provider.models && provider.models.length > 0) {
        setSelectedModelId(provider.models[0].id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, isOpen]) // Add isOpen dependency to prevent switching when dialog is open

  // Handle dialog opening - set the initial model selection
  useEffect(() => {
    if (isOpen && !selectedModelId) {
      if (modelId) {
        setSelectedModelId(modelId)
      } else if (provider.models && provider.models.length > 0) {
        setSelectedModelId(provider.models[0].id)
      }
    }
  }, [isOpen, selectedModelId, modelId, provider.models])

  // Get the currently selected model
  const selectedModel = provider.models.find(
    (m: Model) => m.id === selectedModelId
  )

  // Initialize capabilities and display name from selected model
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
      // Use existing displayName if available, otherwise fall back to model ID
      const displayNameValue = (selectedModel as Model & { displayName?: string }).displayName || selectedModel.id
      setDisplayName(displayNameValue)
      setOriginalDisplayName(displayNameValue)

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

  // Handle display name change
  const handleDisplayNameChange = (newName: string) => {
    setDisplayName(newName)
  }

  // Check if there are unsaved changes
  const hasUnsavedChanges = () => {
    const nameChanged = displayName !== originalDisplayName
    const capabilitiesChanged =
      JSON.stringify(capabilities) !== JSON.stringify(originalCapabilities)
    return nameChanged || capabilitiesChanged
  }

  // Handle save changes
  const handleSaveChanges = async () => {
    if (!selectedModel?.id || isLoading) return

    setIsLoading(true)
    try {
      let updatedModels = provider.models

      // Update display name if changed
      if (displayName !== originalDisplayName) {
        // Update the model in the provider models array with displayName
        updatedModels = updatedModels.map((m: Model) => {
          if (m.id === selectedModelId) {
            return {
              ...m,
              displayName: displayName,
            }
          }
          return m
        })
        setOriginalDisplayName(displayName)
      }

      // Update capabilities if changed
      if (
        JSON.stringify(capabilities) !== JSON.stringify(originalCapabilities)
      ) {
        const updatedCapabilities = Object.entries(capabilities)
          .filter(([, isEnabled]) => isEnabled)
          .map(([capName]) => capName)

        // Find and update the model in the provider
        updatedModels = updatedModels.map((m: Model) => {
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

        setOriginalCapabilities(capabilities)
      }

      // Update the provider with the updated models
      updateProvider(provider.provider, {
        ...provider,
        models: updatedModels,
      })

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

        {/* Model Display Name Section */}
        <div className="py-1">
          <label
            htmlFor="display-name"
            className="text-sm font-medium mb-3 block"
          >
            Display Name
          </label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => handleDisplayNameChange(e.target.value)}
            placeholder="Enter display name"
            className="w-full"
            disabled={isLoading}
          />
          <p className="text-xs text-main-view-fg/60 mt-1">
            This is the name that will be shown in the interface. The original model file remains unchanged.
          </p>
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
