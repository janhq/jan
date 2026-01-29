import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  IconLoader2,
  IconCheck,
} from '@tabler/icons-react'
import { ExtensionManager } from '@/lib/extension'

type ImportMlxModelDialogProps = {
  provider: ModelProvider
  trigger?: React.ReactNode
  onSuccess?: (importedModelName?: string) => void
}

export const ImportMlxModelDialog = ({
  provider,
  trigger,
  onSuccess,
}: ImportMlxModelDialogProps) => {
  const serviceHub = useServiceHub()
  const [open, setOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [modelName, setModelName] = useState('')

  const handleFileSelect = async () => {
    const result = await serviceHub.dialog().open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: 'Safetensor Files',
          extensions: ['safetensors'],
        },
        {
          name: 'All Files',
          extensions: ['*'],
        },
      ],
    })

    if (result && typeof result === 'string') {
      setSelectedPath(result)

      // Extract model name from path
      const pathParts = result.split(/[\\/]/)
      const nameFromPath = pathParts[pathParts.length - 1] || 'mlx-model'
      const sanitizedName = nameFromPath
        .replace(/\s/g, '-')
        .replace(/[^a-zA-Z0-9/_.\-]/g, '')
      setModelName(sanitizedName)
    }
  }

  const handleImport = async () => {
    if (!selectedPath) {
      toast.error('Please select a safetensor file or folder')
      return
    }

    if (!modelName) {
      toast.error('Please enter a model name')
      return
    }

    // Validate model name - only allow alphanumeric, underscore, hyphen, and dot
    if (!/^[a-zA-Z0-9/_.\-]+$/.test(modelName)) {
      toast.error('Invalid model name. Only alphanumeric and _ - . characters are allowed.')
      return
    }

    // Check if model already exists
    const modelExists = provider.models.some(
      (model) => model.id === modelName
    )

    if (modelExists) {
      toast.error('Model already exists', {
        description: `${modelName} already imported`,
      })
      return
    }

    setImporting(true)

    try {
      console.log('[MLX Import] Starting import:', { modelName, selectedPath })

      // Get the MLX engine and call its import method
      const engine = ExtensionManager.getInstance().getEngine('mlx')
      if (!engine) {
        throw new Error('MLX engine not found')
      }

      console.log('[MLX Import] Calling engine.import()...')
      await engine.import(modelName, {
        modelPath: selectedPath,
      })
      console.log('[MLX Import] Import completed')

      toast.success('Model imported successfully', {
        description: `${modelName} has been imported`,
      })

      // Reset form and close dialog
      setSelectedPath(null)
      setModelName('')
      setOpen(false)
      onSuccess?.(modelName)
    } catch (error) {
      console.error('[MLX Import] Import model error:', error)
      toast.error('Failed to import model', {
        description:
          error instanceof Error ? error.message : String(error),
      })
    } finally {
      setImporting(false)
    }
  }

  const resetForm = () => {
    setSelectedPath(null)
    setModelName('')
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!importing) {
      setOpen(newOpen)
      if (!newOpen) {
        resetForm()
      }
    }
  }

  const displayPath = selectedPath
    ? selectedPath.split(/[\\/]/).pop() || selectedPath
    : null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        onInteractOutside={(e) => {
          e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Import MLX Model
          </DialogTitle>
          <DialogDescription>
            Import a safetensor model file or folder for use with MLX. MLX models
            are typically downloaded from HuggingFace and use the safetensors format.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Model Name Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Model Name
            </label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="my-mlx-model"
              className="w-full px-3 py-2 bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <p className="text-xs text-muted-foreground">
              Only alphanumeric and _ - . characters are allowed
            </p>
          </div>

          {/* File Selection Area */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">
                Safetensor File or Folder
              </h3>
              <span className="text-xs bg-secondary px-2 py-1 rounded-sm">
                Required
              </span>
            </div>

            {displayPath ? (
              <div className="bg-accent/10 border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <IconCheck size={16} className="text-accent" />
                    <span className="text-sm font-medium">
                      {displayPath}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleFileSelect}
                    disabled={importing}
                  >
                    Change
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="link"
                onClick={handleFileSelect}
                disabled={importing}
                className="w-full h-12 border border-dashed text-muted-foreground"
              >
                Select Safetensor File or Folder
              </Button>
            )}
          </div>

          {/* Preview */}
          {modelName && (
            <div className="rounded-lg p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Model will be saved as:
                </span>
              </div>
              <p className="text-sm font-mono mt-1">
                mlx/models/{modelName}/
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-4 justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={importing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            size="sm"
            disabled={importing || !selectedPath || !modelName}
          >
            {importing && <IconLoader2 className="mr-2 size-4 animate-spin" />}
            {importing ? 'Importing...' : 'Import Model'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}