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
    vision: false,
    tools: false,
  })

  // Initialize with the provided model ID or the first model if available
  useEffect(() => {
    if (isOpen && !selectedModelId || !isOpen) {
      if (modelId) {
        setSelectedModelId(modelId)
      } else if (provider.models && provider.models.length > 0) {
        setSelectedModelId(provider.models[0].id)
      }
    }
  }, [modelId, isOpen, selectedModelId, provider.models])

  // Get the currently selected model
  const selectedModel = provider.models.find(
    (m: Model) => m.id === selectedModelId
  )

  // Helper function to convert capabilities array to object
  const capabilitiesToObject = (capabilitiesList: string[]) => ({
    vision: capabilitiesList.includes('vision'),
    tools: capabilitiesList.includes('tools'),
  })

  // Initialize capabilities and display name from selected model
  useEffect(() => {
    if (selectedModel) {
      const modelCapabilities = selectedModel.capabilities || []
      const capsObject = capabilitiesToObject(modelCapabilities)

      setCapabilities(capsObject)
      setOriginalCapabilities(capsObject)

      // Use existing displayName if available, otherwise fall back to model ID
      const displayNameValue = (selectedModel as Model & { displayName?: string }).displayName || selectedModel.id
      setDisplayName(displayNameValue)
      setOriginalDisplayName(displayNameValue)
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
      const nameChanged = displayName !== originalDisplayName
      const capabilitiesChanged = JSON.stringify(capabilities) !== JSON.stringify(originalCapabilities)

      // Build the update object for the selected model
      const modelUpdate: Partial<Model> & { _userConfiguredCapabilities?: boolean } = {}

      if (nameChanged) {
        modelUpdate.displayName = displayName
      }

      if (capabilitiesChanged) {
        modelUpdate.capabilities = Object.entries(capabilities)
          .filter(([, isEnabled]) => isEnabled)
          .map(([capName]) => capName)
        modelUpdate._userConfiguredCapabilities = true
      }

      // Update the model in the provider models array
      const updatedModels = provider.models.map((m: Model) =>
        m.id === selectedModelId ? { ...m, ...modelUpdate } : m
      )

      // Update the provider with the updated models
      updateProvider(provider.provider, {
        ...provider,
        models: updatedModels,
      })

      // Update original values
      if (nameChanged) setOriginalDisplayName(displayName)
      if (capabilitiesChanged) setOriginalCapabilities(capabilities)

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

  // Handle dialog close - reset to original values if not saved
  const handleDialogChange = (open: boolean) => {
    if (!open && hasUnsavedChanges()) {
      // Reset to original values when closing without saving
      setDisplayName(originalDisplayName)
      setCapabilities(originalCapabilities)
    }
    setIsOpen(open)
  }

  // Handle keyboard events for Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && hasUnsavedChanges() && !isLoading) {
      e.preventDefault()
      handleSaveChanges()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogChange}>
      <DialogTrigger asChild>
        <div className="size-6 cursor-pointer flex items-center justify-center rounded transition-all duration-200 ease-in-out">
          <IconPencil size={18} className="text-muted-foreground" />
        </div>
      </DialogTrigger>
      <DialogContent onKeyDown={handleKeyDown}>
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
          <p className="text-xs text-muted-foreground mt-1">
            This is the name that will be shown in the interface. The original model file remains unchanged.
          </p>
        </div>

        {/* Warning Banner */}
        <div className="bg-secondary border  rounded-md p-3">
          <div className="flex items-start space-x-3">
            <IconAlertTriangle className="size-5 text-yellow-600 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium mb-1">
                {t('providers:editModel.warning.title')}
              </p>
              <p className="text-muted-foreground">
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
                <IconTool className="size-4 text-muted-foreground" />
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
                <IconEye className="size-4 text-muted-foreground" />
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
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-4">
          <Button
            onClick={handleSaveChanges}
            disabled={!hasUnsavedChanges() || isLoading}
            size="sm"
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
