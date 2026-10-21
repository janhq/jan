/**
 * Import a model for a local CPU engine (LiteRT-LM, OpenVINO).
 *
 * The models these engines use are not GGUF, so llama.cpp's import dialog
 * does not apply: the user points at a model file (LiteRT-LM) or a model
 * folder (OpenVINO), or pastes a URL to download one from.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useState } from 'react'
import { toast } from 'sonner'
import { IconCheck, IconLoader2 } from '@tabler/icons-react'
import { ExtensionManager } from '@/lib/extension'

type ImportLocalEngineModelDialogProps = {
  provider: ModelProvider
  trigger?: React.ReactNode
  onSuccess?: (importedModelName?: string) => void
}

/** The engines this dialog serves, and what a model looks like for them. */
const ENGINE_LAYOUT: Record<string, { directory: boolean; fileName: string }> = {
  'litert-lm': { directory: false, fileName: 'LiteRT-LM model (.litertlm)' },
  openvino: { directory: true, fileName: 'OpenVINO model folder' },
}

export const ImportLocalEngineModelDialog = ({
  provider,
  trigger,
  onSuccess,
}: ImportLocalEngineModelDialogProps) => {
  const serviceHub = useServiceHub()
  const [open, setOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [modelName, setModelName] = useState('')
  const [url, setUrl] = useState('')

  const layout = ENGINE_LAYOUT[provider.provider] ?? {
    directory: false,
    fileName: 'Model file',
  }

  const handleFileSelect = async () => {
    const result = await serviceHub.dialog().open({
      multiple: false,
      directory: layout.directory,
    })

    if (result && typeof result === 'string') {
      setSelectedPath(result)
      const pathParts = result.split(/[\\/]/)
      const nameFromPath = pathParts[pathParts.length - 1] || 'local-model'
      setModelName(
        nameFromPath
          .replace(/\s/g, '-')
          //eslint-disable-next-line
          .replace(/[^a-zA-Z0-9/_.\-]/g, '')
      )
    }
  }

  const handleImport = async () => {
    if (!selectedPath && !url) {
      toast.error('Please select a model or enter a download URL')
      return
    }
    if (!modelName) {
      toast.error('Please enter a model name')
      return
    }
    //eslint-disable-next-line
    if (!/^[a-zA-Z0-9/_.\-]+$/.test(modelName)) {
      toast.error(
        'Invalid model name. Only alphanumeric and _ - . characters are allowed.'
      )
      return
    }
    if (provider.models.some((model) => model.id === modelName)) {
      toast.error('Model already exists', {
        description: `${modelName} already imported`,
      })
      return
    }

    setImporting(true)
    try {
      const engine = ExtensionManager.getInstance().getEngine(provider.provider)
      if (!engine) {
        throw new Error(`The ${provider.provider} engine is not available`)
      }

      await engine.import(modelName, {
        modelPath: url.trim() || (selectedPath as string),
      })

      toast.success('Model imported successfully', {
        description: `${modelName} has been imported`,
      })

      setSelectedPath(null)
      setModelName('')
      setUrl('')
      setOpen(false)
      onSuccess?.(modelName)
    } catch (error) {
      toast.error('Failed to import model', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setImporting(false)
    }
  }

  const resetForm = () => {
    setSelectedPath(null)
    setModelName('')
    setUrl('')
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (importing) return
    setOpen(newOpen)
    if (!newOpen) resetForm()
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
            Import {provider.provider} model
          </DialogTitle>
          <DialogDescription>
            Import a local model for the {provider.provider} engine, or point
            Jan at a download URL. The model stays on this machine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">Model Name</label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="my-model"
              className="w-full px-3 py-2 bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <p className="text-xs text-muted-foreground">
              Only alphanumeric and _ - . characters are allowed
            </p>
          </div>

          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">{layout.fileName}</h3>
              <span className="text-xs bg-secondary px-2 py-1 rounded-sm">
                Local file
              </span>
            </div>

            {displayPath ? (
              <div className="bg-accent/10 border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <IconCheck size={16} className="text-accent" />
                    <span className="text-sm font-medium">{displayPath}</span>
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
                {layout.directory ? 'Select Model Folder' : 'Select Model File'}
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              ...or download from a URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://huggingface.co/.../model.litertlm"
              className="w-full px-3 py-2 bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <p className="text-xs text-muted-foreground">
              The file is downloaded into Jan's data folder.
            </p>
          </div>

          {modelName && (
            <div className="rounded-lg p-3">
              <span className="text-sm font-medium text-muted-foreground">
                Model will be saved as:
              </span>
              <p className="text-sm font-mono mt-1">
                {provider.provider}/models/{modelName}/
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
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
            disabled={importing || (!selectedPath && !url) || !modelName}
          >
            {importing && <IconLoader2 className="mr-2 size-4 animate-spin" />}
            {importing ? 'Importing...' : 'Import Model'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
