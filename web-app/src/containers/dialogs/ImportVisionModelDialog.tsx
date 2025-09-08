import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  IconFileImport,
  IconLoader2,
  IconEye,
  IconCheck,
} from '@tabler/icons-react'

type ImportVisionModelDialogProps = {
  provider: ModelProvider
  trigger?: React.ReactNode
  onSuccess?: (importedModelName?: string) => void
}

export const ImportVisionModelDialog = ({
  provider,
  trigger,
  onSuccess,
}: ImportVisionModelDialogProps) => {
  const serviceHub = useServiceHub()
  const [open, setOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [isVisionModel, setIsVisionModel] = useState(false)
  const [modelFile, setModelFile] = useState<string | null>(null)
  const [mmProjFile, setMmProjFile] = useState<string | null>(null)
  const [modelName, setModelName] = useState('')

  const handleFileSelect = async (type: 'model' | 'mmproj') => {
    const selectedFile = await serviceHub.dialog().open({
      multiple: false,
      directory: false,
    })

    if (selectedFile && typeof selectedFile === 'string') {
      const fileName = selectedFile.split(/[\\/]/).pop() || ''

      if (type === 'model') {
        setModelFile(selectedFile)
        // Auto-generate model name from GGUF file
        const sanitizedName = fileName
          .replace(/\s/g, '-')
          .replace(/\.(gguf|GGUF)$/, '')
          .replace(/[^a-zA-Z0-9/_.-]/g, '') // Remove any characters not allowed in model IDs
        setModelName(sanitizedName)
      } else {
        setMmProjFile(selectedFile)
      }
    }
  }

  const handleImport = async () => {
    if (!modelFile) {
      toast.error('Please select a model file')
      return
    }

    if (isVisionModel && !mmProjFile) {
      toast.error('Please select both model and MMPROJ files for vision models')
      return
    }

    if (!modelName) {
      toast.error('Unable to determine model name from file')
      return
    }

    // Check if model already exists
    const modelExists = provider.models.some(
      (model) => model.name === modelName
    )

    if (modelExists) {
      toast.error('Model already exists', {
        description: `${modelName} already imported`,
      })
      return
    }

    setImporting(true)

    try {
      if (isVisionModel && mmProjFile) {
        // Import vision model with both files - let backend calculate SHA256 and sizes
        await serviceHub.models().pullModel(
          modelName,
          modelFile,
          undefined, // modelSha256 - calculated by backend
          undefined, // modelSize - calculated by backend
          mmProjFile // mmprojPath
          // mmprojSha256 and mmprojSize omitted - calculated by backend
        )
      } else {
        // Import regular model - let backend calculate SHA256 and size
        await serviceHub.models().pullModel(modelName, modelFile)
      }

      toast.success('Model imported successfully', {
        description: `${modelName} has been imported`,
      })

      // Reset form and close dialog
      resetForm()
      setOpen(false)
      onSuccess?.(modelName)
    } catch (error) {
      console.error('Import model error:', error)
      toast.error('Failed to import model', {
        description:
          error instanceof Error ? error.message : 'Unknown error occurred',
      })
    } finally {
      setImporting(false)
    }
  }

  const resetForm = () => {
    setModelFile(null)
    setMmProjFile(null)
    setModelName('')
    setIsVisionModel(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!importing) {
      setOpen(newOpen)
      if (!newOpen) {
        resetForm()
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Import Model
          </DialogTitle>
          <DialogDescription>
            Import a GGUF model file to add it to your collection. Enable vision
            support for models that work with images.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Vision Model Toggle Card */}
          <div className="border border-main-view-fg/10 rounded-lg p-4 space-y-3 bg-main-view-fg/5">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 mt-0.5">
                <IconEye size={20} className="text-accent" />
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-main-view-fg">
                  Vision Model Support
                </h3>
                <p className="text-sm text-main-view-fg/70">
                  Enable if your model supports image understanding (requires
                  MMPROJ file)
                </p>
              </div>
              <Switch
                id="vision-model"
                checked={isVisionModel}
                onCheckedChange={setIsVisionModel}
                className="mt-1"
              />
            </div>
          </div>

          {/* Model Name Preview */}
          {modelName && (
            <div className="bg-main-view-fg/5 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-main-view-fg/80">
                  Model will be saved as:
                </span>
              </div>
              <p className="text-base font-mono mt-1 text-main-view-fg">
                {modelName}
              </p>
            </div>
          )}

          {/* File Selection Area */}
          <div className="space-y-4">
            {/* Model File Selection */}
            <div className="border border-main-view-fg/10 rounded-lg p-4 space-y-3 bg-main-view-fg/5">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-main-view-fg">
                  Model File (GGUF)
                </h3>
                <span className="text-xs bg-main-view-fg/10 text-main-view-fg/70 px-2 py-1 rounded">
                  Required
                </span>
              </div>

              {modelFile ? (
                <div className="bg-accent/10 border border-accent/20 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <IconCheck size={16} className="text-accent" />
                      <span className="text-sm font-medium text-main-view-fg">
                        {modelFile.split(/[\\/]/).pop()}
                      </span>
                    </div>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => handleFileSelect('model')}
                      disabled={importing}
                      className="text-accent hover:text-accent/80"
                    >
                      Change
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => handleFileSelect('model')}
                  disabled={importing}
                  className="w-full h-12 border border-dashed border-main-view-fg/10 bg-main-view"
                >
                  Select GGUF File
                </Button>
              )}
            </div>

            {/* MMPROJ File Selection - only show if vision model is enabled */}
            {isVisionModel && (
              <div className="border border-main-view-fg/10 rounded-lg p-4 space-y-3 bg-main-view-fg/5">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-main-view-fg">MMPROJ File</h3>
                  <span className="text-xs bg-accent/10 text-accent px-2 py-1 rounded">
                    Required for Vision
                  </span>
                </div>

                {mmProjFile ? (
                  <div className="bg-accent/10 border border-accent/20 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <IconCheck size={16} className="text-accent" />
                        <span className="text-sm font-medium text-main-view-fg">
                          {mmProjFile.split(/[\\/]/).pop()}
                        </span>
                      </div>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => handleFileSelect('mmproj')}
                        disabled={importing}
                        className="text-accent hover:text-accent/80"
                      >
                        Change
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => handleFileSelect('mmproj')}
                    disabled={importing}
                    className="w-full h-12 border border-dashed border-main-view-fg/10 bg-main-view"
                  >
                    <IconFileImport size={18} className="mr-2" />
                    Select MMPROJ File
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex gap-2 pt-4">
          <Button
            variant="link"
            onClick={() => handleOpenChange(false)}
            disabled={importing}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={
              importing ||
              !modelFile ||
              !modelName ||
              (isVisionModel && !mmProjFile)
            }
            className="flex-1"
          >
            {importing && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
            {importing ? (
              'Importing...'
            ) : (
              <>Import {isVisionModel ? 'Vision ' : ''}Model</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
