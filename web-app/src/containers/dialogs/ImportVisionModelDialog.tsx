import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { buildModelIdFromPath } from '@/lib/buildModelIdFromPath'
import { fs } from '@janhq/core'
import {
  IconLoader2,
  IconEye,
  IconCheck,
  IconAlertTriangle,
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
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [mmprojValidationError, setMmprojValidationError] = useState<
    string | null
  >(null)
  const [isValidatingMmproj, setIsValidatingMmproj] = useState(false)
  const [importMode, setImportMode] = useState<'file' | 'directory'>('file')
  const [modelDirectory, setModelDirectory] = useState<string | null>(null)
  const [discoveredModelFiles, setDiscoveredModelFiles] = useState<string[]>([])
  const [folderImportProgress, setFolderImportProgress] = useState<{
    current: number
    total: number
  } | null>(null)

  const validateGgufFile = useCallback(
    async (filePath: string, fileType: 'model' | 'mmproj'): Promise<void> => {
      if (fileType === 'model') {
        setIsValidating(true)
        setValidationError(null)
      } else {
        setIsValidatingMmproj(true)
        setMmprojValidationError(null)
      }

      try {
        // Handle validation differently for model files vs mmproj files
        if (fileType === 'model') {
          // For model files, use the standard validateGgufFile method
          if (typeof serviceHub.models().validateGgufFile === 'function') {
            const result = await serviceHub.models().validateGgufFile(filePath)

            if (result.metadata) {
              // Check architecture from metadata
              const architecture =
                result.metadata.metadata?.['general.architecture']

              setModelName(await serviceHub.path().basename(filePath))

              // Model files should NOT be clip
              if (architecture === 'clip') {
                const errorMessage =
                  'This model has CLIP architecture and cannot be imported as a text generation model. CLIP models are designed for vision tasks and require different handling.'
                setValidationError(errorMessage)
                console.error(
                  'CLIP architecture detected in model file:',
                  architecture
                )
              }
            }

            if (!result.isValid) {
              setValidationError(result.error || 'Model validation failed')
              console.error('Model validation failed:', result.error)
            }
          }
        } else {
          // For mmproj files, we need to manually validate since validateGgufFile rejects CLIP models
          try {
            // Import the readGgufMetadata function directly from Tauri
            const { invoke } = await import('@tauri-apps/api/core')

            const metadata = await invoke(
              'plugin:llamacpp|read_gguf_metadata',
              {
                path: filePath,
              }
            )

            // Check if architecture matches expected type
            const architecture = (
              metadata as { metadata?: Record<string, string> }
            ).metadata?.['general.architecture']

            // MMProj files MUST be clip
            if (architecture !== 'clip') {
              const errorMessage = `This MMProj file has "${architecture}" architecture but should have "clip" architecture. MMProj files must be CLIP models for vision processing.`
              setMmprojValidationError(errorMessage)
              console.error(
                'Non-CLIP architecture detected in mmproj file:',
                architecture
              )
            }
          } catch (directError) {
            console.error(
              'Failed to validate mmproj file directly:',
              directError
            )
            const errorMessage = `Failed to read MMProj metadata: ${
              directError instanceof Error
                ? directError.message
                : 'Unknown error'
            }`
            setMmprojValidationError(errorMessage)
          }
        }
      } catch (error) {
        console.error(`Failed to validate ${fileType} file:`, error)
        const errorMessage = `Failed to read ${fileType} metadata: ${error instanceof Error ? error.message : 'Unknown error'}`

        if (fileType === 'model') {
          setValidationError(errorMessage)
        } else {
          setMmprojValidationError(errorMessage)
        }
      } finally {
        if (fileType === 'model') {
          setIsValidating(false)
        } else {
          setIsValidatingMmproj(false)
        }
      }
    },
    [serviceHub]
  )

  const validateModelFile = useCallback(
    async (filePath: string): Promise<void> => {
      await validateGgufFile(filePath, 'model')
    },
    [validateGgufFile]
  )

  const validateMmprojFile = useCallback(
    async (filePath: string): Promise<void> => {
      await validateGgufFile(filePath, 'mmproj')
    },
    [validateGgufFile]
  )

  const handleFileSelect = async (type: 'model' | 'mmproj') => {
    setImportMode('file')
    setModelDirectory(null)
    setDiscoveredModelFiles([])
    const selectedFile = await serviceHub.dialog().open({
      multiple: false,
      directory: false,
    })

    if (selectedFile && typeof selectedFile === 'string') {
      const fileName = selectedFile.split(/[\\/]/).pop() || ''

      if (type === 'model') {
        setModelFile(selectedFile)
        // Set temporary model name from filename (will be overridden by baseName from metadata if available)
        const sanitizedName = fileName
          .replace(/\s/g, '-')
          .replace(/\.(gguf|GGUF)$/, '')
          .replace(/[^a-zA-Z0-9/_.-]/g, '') // Remove any characters not allowed in model IDs
        setModelName(sanitizedName)

        // Validate the selected model file (this will update model name with baseName from metadata)
        await validateModelFile(selectedFile)
      } else {
        setMmProjFile(selectedFile)
        // Validate the selected mmproj file
        await validateMmprojFile(selectedFile)
      }
    }
  }

  const handleDirectorySelect = async () => {
    setImportMode('directory')
    setModelFile(null)
    setMmProjFile(null)
    setModelName('')
    setValidationError(null)
    setMmprojValidationError(null)
    setIsValidating(false)
    setIsValidatingMmproj(false)

    const selectedDirectory = await serviceHub.dialog().open({
      multiple: false,
      directory: true,
    })

    if (!selectedDirectory || typeof selectedDirectory !== 'string') return

    try {
      const modelFiles = await fs.getGgufFiles([selectedDirectory])
      setModelDirectory(selectedDirectory)
      setDiscoveredModelFiles(modelFiles)
      if (modelFiles.length === 0) {
        toast.error('No GGUF models found in folder')
      }
    } catch (error) {
      setModelDirectory(selectedDirectory)
      setDiscoveredModelFiles([])
      toast.error('Failed to scan model folder', {
        description:
          error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  }

  const handleImport = async () => {
    if (importMode === 'directory') {
      if (!modelDirectory) {
        toast.error('Please select a model folder')
        return
      }
      if (discoveredModelFiles.length === 0) {
        toast.error('No GGUF models found in selected folder')
        return
      }
      if (isVisionModel) {
        toast.error('Folder import only supports text GGUF models')
        return
      }

      setImporting(true)
      setFolderImportProgress({ current: 0, total: discoveredModelFiles.length })
      try {
        const existingIds = new Set(provider.models.map((model) => model.id))
        const seenIds = new Set<string>()
        let importedCount = 0
        let skippedCount = 0
        let emptyModelIdCount = 0
        const failures: { path: string; message: string }[] = []

        for (let i = 0; i < discoveredModelFiles.length; i++) {
          const filePath = discoveredModelFiles[i]
          setFolderImportProgress({
            current: i + 1,
            total: discoveredModelFiles.length,
          })

          const modelId = buildModelIdFromPath(filePath)
          if (!modelId) {
            emptyModelIdCount += 1
            skippedCount += 1
            console.warn(
              'Skipping GGUF file: could not derive a model id from filename:',
              filePath
            )
            continue
          }
          if (existingIds.has(modelId) || seenIds.has(modelId)) {
            skippedCount += 1
            continue
          }

          try {
            await serviceHub.models().pullModel(modelId, filePath)
            seenIds.add(modelId)
            importedCount += 1
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Unknown error occurred'
            failures.push({ path: filePath, message })
            console.error('Folder import failed for file:', filePath, err)
          }
        }

        if (importedCount > 0 && failures.length === 0) {
          toast.success('Folder import completed', {
            description: [
              `Imported ${importedCount} model${importedCount > 1 ? 's' : ''}`,
              skippedCount > 0 ? `, skipped ${skippedCount}` : '',
              emptyModelIdCount > 0
                ? ` (${emptyModelIdCount} could not get a valid id from filename)`
                : '',
            ].join(''),
          })
          resetForm()
          setOpen(false)
          onSuccess?.()
        } else if (importedCount > 0 && failures.length > 0) {
          toast.warning('Folder import partially completed', {
            description: `Imported ${importedCount} model${importedCount > 1 ? 's' : ''}; ${failures.length} failed. First error: ${failures[0].message}`,
          })
          resetForm()
          setOpen(false)
          onSuccess?.()
        } else if (failures.length > 0) {
          toast.error('Failed to import models from folder', {
            description: `${failures.length} error(s). First: ${failures[0].message}`,
          })
        } else if (emptyModelIdCount > 0) {
          toast.warning('Some files were skipped', {
            description: `${emptyModelIdCount} file(s) could not be assigned a valid model id from their names.`,
          })
        } else {
          toast.error('No models imported', {
            description: 'All discovered models already exist or are invalid.',
          })
        }
      } catch (error) {
        console.error('Folder import error:', error)
        toast.error('Failed to import models from folder', {
          description:
            error instanceof Error ? error.message : 'Unknown error occurred',
        })
      } finally {
        setImporting(false)
        setFolderImportProgress(null)
      }
      return
    }

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
    setValidationError(null)
    setIsValidating(false)
    setMmprojValidationError(null)
    setIsValidatingMmproj(false)
    setImportMode('file')
    setModelDirectory(null)
    setDiscoveredModelFiles([])
    setFolderImportProgress(null)
  }

  // Re-validate MMProj file when model name changes
  useEffect(() => {
    if (mmProjFile && modelName && isVisionModel) {
      validateMmprojFile(mmProjFile)
    }
  }, [modelName, mmProjFile, isVisionModel, validateMmprojFile])

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
      <DialogContent
        onInteractOutside={(e) => {
          e.preventDefault()
        }}
      >
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
          <div className="border  rounded-lg p-4 space-y-3">
            <div className="flex items-start space-x-3">
              <div className="shrink-0 mt-0.5">
                <IconEye size={20} className="text-muted-foreground" />
              </div>
              <div className="flex-1">
                <h3 className="font-medium">
                  Vision Model Support
                </h3>
                <p className="text-sm text-muted-foreground leading-normal">
                  Enable if your model supports image understanding (requires
                  MMPROJ file)
                </p>
              </div>
              <Switch
                id="vision-model"
                checked={isVisionModel}
                onCheckedChange={(checked) => {
                  setIsVisionModel(checked)
                  if (!checked) {
                    setMmProjFile(null)
                    setMmprojValidationError(null)
                    setIsValidatingMmproj(false)
                  }
                }}
                className="mt-1"
              />
            </div>
          </div>

          {/* Model Name Preview */}
          {modelName && !validationError && (
            <div className=" rounded-lg p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Model will be saved as:
                </span>
              </div>
              <p className="text-sm font-mono mt-1">
                {modelName}
              </p>
            </div>
          )}

          {/* File Selection Area */}
          <div className="space-y-4">
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">Import Mode</h3>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={importMode === 'file' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setImportMode('file')}
                    disabled={importing}
                  >
                    Single File
                  </Button>
                  <Button
                    type="button"
                    variant={importMode === 'directory' ? 'default' : 'outline'}
                    size="sm"
                    onClick={handleDirectorySelect}
                    disabled={importing || isVisionModel}
                  >
                    Import Folder
                  </Button>
                </div>
              </div>
              {isVisionModel && (
                <p className="text-xs text-muted-foreground">
                  Folder import is disabled when Vision Model Support is enabled.
                </p>
              )}
            </div>

            {importMode === 'directory' && (
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">Model Folder</h3>
                  <span className="text-xs bg-secondary px-2 py-1 rounded-sm">
                    Required
                  </span>
                </div>
                {modelDirectory ? (
                  <div className="space-y-2">
                    <div className="border rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <IconCheck size={16} />
                          <span className="text-sm font-medium truncate">
                            {modelDirectory}
                          </span>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleDirectorySelect}
                          disabled={importing}
                        >
                          Change
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Found {discoveredModelFiles.length} importable GGUF
                      model{discoveredModelFiles.length === 1 ? '' : 's'}.
                    </p>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    onClick={handleDirectorySelect}
                    disabled={importing}
                    className="w-full h-12 border border-dashed text-muted-foreground"
                  >
                    Select Model Folder
                  </Button>
                )}
              </div>
            )}

            {/* Model File Selection */}
            {importMode === 'file' && (
              <div className="border  rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">
                    Model File (GGUF)
                  </h3>
                  <span className="text-xs bg-secondary px-2 py-1 rounded-sm">
                    Required
                  </span>
                </div>

                {modelFile ? (
                <div className="space-y-2">
                  <div className="border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isValidating ? (
                          <IconLoader2
                            size={16}
                            className="animate-spin"
                          />
                        ) : validationError ? (
                          <IconAlertTriangle
                            size={16}
                            className="text-destructive"
                          />
                        ) : (
                          <IconCheck size={16}  />
                        )}
                        <span className="text-sm font-medium">
                          {modelFile.split(/[\\/]/).pop()}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleFileSelect('model')}
                        disabled={importing || isValidating}
                      >
                        Change
                      </Button>
                    </div>
                  </div>

                  {/* Validation Error Display */}
                  {validationError && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <IconAlertTriangle
                          size={16}
                          className="text-destructive mt-0.5 shrink-0"
                        />
                        <div>
                          <p className="text-sm font-medium text-destructive">
                            Model Validation Error
                          </p>
                          <p className="text-sm text-destructive/90 mt-1">
                            {validationError}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Validation Loading State */}
                  {isValidating && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <IconLoader2
                          size={16}
                          className="text-blue-500 animate-spin"
                        />
                        <p className="text-sm text-blue-700">
                          Validating model file...
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <Button
                  type="button"
                  variant="link"
                  onClick={() => handleFileSelect('model')}
                  disabled={importing}
                  className="w-full h-12 border border-dashed text-muted-foreground"
                >
                  Select GGUF File
                </Button>
              )}
              </div>
            )}

            {/* MMPROJ File Selection - only show if vision model is enabled */}
            {isVisionModel && importMode === 'file' && (
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">MMPROJ File</h3>
                  <span className="text-xs bg-secondary px-2 py-1 rounded-sm">
                    Required for Vision
                  </span>
                </div>

                {mmProjFile ? (
                  <div className="space-y-2">
                    <div className="bg-accent/10 border rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isValidatingMmproj ? (
                            <IconLoader2
                              size={16}
                              className="animate-spin"
                            />
                          ) : mmprojValidationError ? (
                            <IconAlertTriangle
                              size={16}
                              className="text-destructive"
                            />
                          ) : (
                            <IconCheck size={16} />
                          )}
                          <span className="text-sm font-medium">
                            {mmProjFile.split(/[\\/]/).pop()}
                          </span>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleFileSelect('mmproj')}
                          disabled={importing || isValidatingMmproj}
                        >
                          Change
                        </Button>
                      </div>
                    </div>

                    {/* MMProj Validation Error Display */}
                    {mmprojValidationError && (
                      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <IconAlertTriangle
                            size={16}
                            className="text-destructive mt-0.5 shrink-0"
                          />
                          <div>
                            <p className="text-sm font-medium text-destructive">
                              MMProj Validation Error
                            </p>
                            <p className="text-sm text-destructive/90 mt-1">
                              {mmprojValidationError}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* MMProj Validation Loading State */}
                    {isValidatingMmproj && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <IconLoader2
                            size={16}
                            className="text-blue-500 animate-spin"
                          />
                          <p className="text-sm text-blue-700">
                            Validating MMProj file...
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => handleFileSelect('mmproj')}
                    disabled={importing}
                    className="w-full h-12 border border-dashed text-muted-foreground"
                  >
                    Select MMPROJ File
                  </Button>
                )}
              </div>
            )}
          </div>
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
            disabled={
              importing ||
              (importMode === 'file' &&
                (!modelFile ||
                  !modelName ||
                  (isVisionModel && !mmProjFile))) ||
              (importMode === 'directory' &&
                (!modelDirectory || discoveredModelFiles.length === 0)) ||
              validationError !== null ||
              isValidating ||
              mmprojValidationError !== null ||
              isValidatingMmproj
            }
          >
            {importing && <IconLoader2 className="mr-2 size-4 animate-spin" />}
            {importing ? (
              importMode === 'directory' &&
              folderImportProgress &&
              folderImportProgress.total > 0 ? (
                `Importing ${folderImportProgress.current} / ${folderImportProgress.total}...`
              ) : (
                'Importing...'
              )
            ) : (
              <>
                Import{' '}
                {importMode === 'directory'
                  ? 'Folder'
                  : `${isVisionModel ? 'Vision ' : ''}Model`}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
