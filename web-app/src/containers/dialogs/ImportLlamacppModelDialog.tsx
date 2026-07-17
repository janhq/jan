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
import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import {
  IconLoader2,
  IconSparkles,
  IconPhoto,
  IconMicrophone,
  IconCheck,
  IconAlertTriangle,
  IconCodeCircle2,
  IconBolt,
} from '@tabler/icons-react'

type DetectedModalities = { vision: boolean; audio: boolean }

const EMBEDDING_GGUF_ARCHS = new Set([
  'bert',
  'nomic-bert',
  'nomic-bert-moe',
  'jina-bert-v2',
  'jina-bert-v3',
  'xlm-roberta',
  'mpnet',
  't5encoder',
  'gemma-embedding',
  'pangu-embedded',
  'llama-embed',
])

// Mirrors llama.cpp's common_speculative_are_compatible (common/speculative.cpp):
// draft/target compatibility is decided by tokenizer type, BOS/EOS ids, and
// vocab size - never by comparing general.architecture strings, which are
// legitimately different for MTP draft heads (e.g. "gemma4-assistant" vs "gemma4").
const SPEC_VOCAB_MAX_SIZE_DIFFERENCE = 128

type TokenizerInfo = {
  tokenizerModel?: string
  addBos?: boolean
  addEos?: boolean
  bosTokenId?: number
  eosTokenId?: number
  vocabSize?: number
}

function extractTokenizerInfo(
  meta: Record<string, string> | undefined
): TokenizerInfo {
  if (!meta) return {}
  const truthy = (v: string | undefined) =>
    typeof v === 'string' && v.toLowerCase() === 'true'
  const num = (v: string | undefined) => {
    if (typeof v !== 'string' || v === '') return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const vocabSizeKey = Object.keys(meta).find((k) =>
    k.endsWith('.vocab_size')
  )
  return {
    tokenizerModel: meta['tokenizer.ggml.model'],
    addBos:
      meta['tokenizer.ggml.add_bos_token'] !== undefined
        ? truthy(meta['tokenizer.ggml.add_bos_token'])
        : undefined,
    addEos:
      meta['tokenizer.ggml.add_eos_token'] !== undefined
        ? truthy(meta['tokenizer.ggml.add_eos_token'])
        : undefined,
    bosTokenId: num(meta['tokenizer.ggml.bos_token_id']),
    eosTokenId: num(meta['tokenizer.ggml.eos_token_id']),
    vocabSize: vocabSizeKey ? num(meta[vocabSizeKey]) : undefined,
  }
}

function findTokenizerMismatch(
  main: TokenizerInfo,
  draft: TokenizerInfo
): string | null {
  if (
    main.tokenizerModel &&
    draft.tokenizerModel &&
    main.tokenizerModel !== draft.tokenizerModel
  ) {
    return `tokenizer type "${draft.tokenizerModel}" does not match the main model's tokenizer type "${main.tokenizerModel}"`
  }
  if (
    main.addBos &&
    draft.addBos &&
    main.bosTokenId !== undefined &&
    draft.bosTokenId !== undefined &&
    main.bosTokenId !== draft.bosTokenId
  ) {
    return `BOS token id ${draft.bosTokenId} does not match the main model's BOS token id ${main.bosTokenId}`
  }
  if (
    main.addEos &&
    draft.addEos &&
    main.eosTokenId !== undefined &&
    draft.eosTokenId !== undefined &&
    main.eosTokenId !== draft.eosTokenId
  ) {
    return `EOS token id ${draft.eosTokenId} does not match the main model's EOS token id ${main.eosTokenId}`
  }
  if (
    main.vocabSize !== undefined &&
    draft.vocabSize !== undefined &&
    Math.abs(main.vocabSize - draft.vocabSize) > SPEC_VOCAB_MAX_SIZE_DIFFERENCE
  ) {
    return `vocab size ${draft.vocabSize} differs from the main model's vocab size ${main.vocabSize} by more than ${SPEC_VOCAB_MAX_SIZE_DIFFERENCE} tokens`
  }
  return null
}

function detectEmbeddingFromMetadata(
  meta: Record<string, string> | undefined
): boolean {
  if (!meta) return false
  const arch = meta['general.architecture']
  if (typeof arch !== 'string') return false
  if (EMBEDDING_GGUF_ARCHS.has(arch)) return true
  if (arch.toLowerCase().includes('embed')) return true
  const poolingRaw = meta[`${arch}.pooling_type`]
  if (typeof poolingRaw === 'string' && poolingRaw.length > 0) {
    const n = Number(poolingRaw)
    if (Number.isFinite(n) && n > 0) return true
  }
  return false
}

type ImportLlamacppModelDialogProps = {
  provider: ModelProvider
  trigger?: React.ReactNode
  onSuccess?: (importedModelName?: string) => void
}

export const ImportLlamacppModelDialog = ({
  provider,
  trigger,
  onSuccess,
}: ImportLlamacppModelDialogProps) => {
  const serviceHub = useServiceHub()
  const [open, setOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [isMultimodal, setIsMultimodal] = useState(false)
  const [modelFile, setModelFile] = useState<string | null>(null)
  const [mmProjFile, setMmProjFile] = useState<string | null>(null)
  const [modelName, setModelName] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [mmprojValidationError, setMmprojValidationError] = useState<
    string | null
  >(null)
  const [isValidatingMmproj, setIsValidatingMmproj] = useState(false)
  const [detectedModalities, setDetectedModalities] =
    useState<DetectedModalities | null>(null)
  const [isEmbeddingModel, setIsEmbeddingModel] = useState(false)
  const [isDraftModel, setIsDraftModel] = useState(false)
  const [draftFile, setDraftFile] = useState<string | null>(null)
  const [draftValidationError, setDraftValidationError] = useState<
    string | null
  >(null)
  const [isValidatingDraft, setIsValidatingDraft] = useState(false)
  const [modelTokenizerInfo, setModelTokenizerInfo] =
    useState<TokenizerInfo | null>(null)

  const validateGgufFile = useCallback(
    async (filePath: string, fileType: 'model' | 'mmproj' | 'draft'): Promise<void> => {
      if (fileType === 'model') {
        setIsValidating(true)
        setValidationError(null)
      } else if (fileType === 'mmproj') {
        setIsValidatingMmproj(true)
        setMmprojValidationError(null)
      } else {
        setIsValidatingDraft(true)
        setDraftValidationError(null)
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
              setModelTokenizerInfo(
                extractTokenizerInfo(result.metadata.metadata)
              )

              const embedding = detectEmbeddingFromMetadata(
                result.metadata.metadata
              )
              setIsEmbeddingModel(embedding)
              if (embedding) {
                setIsMultimodal(false)
                setMmProjFile(null)
                setMmprojValidationError(null)
                setIsValidatingMmproj(false)
                setDetectedModalities(null)
                setIsDraftModel(false)
                setDraftFile(null)
                setDraftValidationError(null)
                setIsValidatingDraft(false)
              }

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
        } else if (fileType === 'mmproj') {
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

            const meta = (
              metadata as { metadata?: Record<string, string> }
            ).metadata
            const architecture = meta?.['general.architecture']

            if (architecture !== 'clip') {
              const errorMessage = `This MMProj file has "${architecture}" architecture but should have "clip" architecture. MMProj files must be CLIP models for vision or audio processing.`
              setMmprojValidationError(errorMessage)
              setDetectedModalities(null)
              console.error(
                'Non-CLIP architecture detected in mmproj file:',
                architecture
              )
            } else {
              const truthy = (v: string | undefined) =>
                typeof v === 'string' && v.toLowerCase() === 'true'
              const vision = truthy(meta?.['clip.has_vision_encoder'])
              const audio = truthy(meta?.['clip.has_audio_encoder'])
              setDetectedModalities(
                vision || audio ? { vision, audio } : { vision: true, audio: false }
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
        } else {
          // Draft (speculative-decoding) models are ordinary causal-LM ggufs,
          // not CLIP - reuse the standard validator and cross-check tokenizer
          // compatibility (not architecture name; see findTokenizerMismatch).
          if (typeof serviceHub.models().validateGgufFile === 'function') {
            const result = await serviceHub.models().validateGgufFile(filePath)
            const architecture =
              result.metadata?.metadata?.['general.architecture']

            if (architecture === 'clip') {
              setDraftValidationError(
                'This file has CLIP architecture and cannot be used as a draft model.'
              )
            } else if (!result.isValid) {
              setDraftValidationError(
                result.error || 'Draft model validation failed'
              )
            } else if (modelTokenizerInfo) {
              const mismatch = findTokenizerMismatch(
                modelTokenizerInfo,
                extractTokenizerInfo(result.metadata?.metadata)
              )
              if (mismatch) {
                setDraftValidationError(
                  `Draft model is not compatible with the main model: ${mismatch}.`
                )
              }
            }
          }
        }
      } catch (error) {
        console.error(`Failed to validate ${fileType} file:`, error)
        const errorMessage = `Failed to read ${fileType} metadata: ${error instanceof Error ? error.message : 'Unknown error'}`

        if (fileType === 'model') {
          setValidationError(errorMessage)
        } else if (fileType === 'mmproj') {
          setMmprojValidationError(errorMessage)
        } else {
          setDraftValidationError(errorMessage)
        }
      } finally {
        if (fileType === 'model') {
          setIsValidating(false)
        } else if (fileType === 'mmproj') {
          setIsValidatingMmproj(false)
        } else {
          setIsValidatingDraft(false)
        }
      }
    },
    [serviceHub, modelTokenizerInfo]
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

  const validateDraftFile = useCallback(
    async (filePath: string): Promise<void> => {
      await validateGgufFile(filePath, 'draft')
    },
    [validateGgufFile]
  )

  const handleFileSelect = async (type: 'model' | 'mmproj' | 'draft') => {
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
      } else if (type === 'mmproj') {
        setMmProjFile(selectedFile)
        // Validate the selected mmproj file
        await validateMmprojFile(selectedFile)
      } else {
        setDraftFile(selectedFile)
        // Validate the selected draft model file
        await validateDraftFile(selectedFile)
      }
    }
  }

  const handleImport = async () => {
    if (!modelFile) {
      toast.error('Please select a model file')
      return
    }

    if (isMultimodal && !mmProjFile) {
      toast.error('Please select both model and MMPROJ files for multimodal models')
      return
    }

    if (isDraftModel && !draftFile) {
      toast.error('Please select a draft model file')
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
      // Let backend calculate SHA256 and sizes for all files
      await serviceHub.models().pullModel(
        modelName,
        modelFile,
        undefined, // modelSha256
        undefined, // modelSize
        isMultimodal && mmProjFile ? mmProjFile : undefined,
        undefined, // mmprojSha256
        undefined, // mmprojSize
        isDraftModel && draftFile ? draftFile : undefined
      )

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
    setIsMultimodal(false)
    setValidationError(null)
    setIsValidating(false)
    setMmprojValidationError(null)
    setIsValidatingMmproj(false)
    setDetectedModalities(null)
    setIsEmbeddingModel(false)
    setModelTokenizerInfo(null)
    setIsDraftModel(false)
    setDraftFile(null)
    setDraftValidationError(null)
    setIsValidatingDraft(false)
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
            Import a GGUF model file to add it to your collection. Enable
            multimodal support to attach an mmproj for image or audio input,
            or draft model support for speculative decoding. Embedding models
            are detected automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="border  rounded-lg p-4 space-y-3">
            <div className="flex items-start space-x-3">
              <div className="shrink-0 mt-0.5">
                <IconSparkles size={20} className="text-muted-foreground" />
              </div>
              <div className="flex-1">
                <h3 className="font-medium">Multimodal Support</h3>
                <p className="text-sm text-muted-foreground leading-normal">
                  Enable if your model uses an mmproj for image or audio input.
                  Modalities are detected from the projector file.
                </p>
              </div>
              <Switch
                id="multimodal"
                checked={isMultimodal}
                disabled={isEmbeddingModel}
                onCheckedChange={(checked) => {
                  setIsMultimodal(checked)
                  if (!checked) {
                    setMmProjFile(null)
                    setMmprojValidationError(null)
                    setIsValidatingMmproj(false)
                    setDetectedModalities(null)
                  }
                }}
                className="mt-1"
              />
            </div>
          </div>

          <div className="border  rounded-lg p-4 space-y-3">
            <div className="flex items-start space-x-3">
              <div className="shrink-0 mt-0.5">
                <IconBolt size={20} className="text-muted-foreground" />
              </div>
              <div className="flex-1">
                <h3 className="font-medium">Draft Model Support</h3>
                <p className="text-sm text-muted-foreground leading-normal">
                  Attach a smaller draft model (including MTP draft heads) for
                  speculative decoding. The draft model must share the main
                  model&apos;s tokenizer and vocabulary.
                </p>
              </div>
              <Switch
                id="draft-model"
                checked={isDraftModel}
                disabled={isEmbeddingModel}
                onCheckedChange={(checked) => {
                  setIsDraftModel(checked)
                  if (!checked) {
                    setDraftFile(null)
                    setDraftValidationError(null)
                    setIsValidatingDraft(false)
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
            {/* Model File Selection */}
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

                  {!isValidating && !validationError && isEmbeddingModel && (
                    <div className="border rounded-lg p-3 flex items-start gap-2">
                      <IconCodeCircle2 size={16} className="mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">
                          Embedding model detected
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          This model will be imported for embeddings only.
                          Multimodal options are disabled.
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

            {isMultimodal && (
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">MMPROJ File</h3>
                  <span className="text-xs bg-secondary px-2 py-1 rounded-sm">
                    Required for Multimodal
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
                      {!isValidatingMmproj &&
                        !mmprojValidationError &&
                        detectedModalities && (
                          <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                            <span className="text-xs text-muted-foreground">
                              Detected:
                            </span>
                            {detectedModalities.vision && (
                              <span className="inline-flex items-center gap-1 text-xs bg-secondary px-2 py-0.5 rounded-sm">
                                <IconPhoto size={12} />
                                Vision
                              </span>
                            )}
                            {detectedModalities.audio && (
                              <span className="inline-flex items-center gap-1 text-xs bg-secondary px-2 py-0.5 rounded-sm">
                                <IconMicrophone size={12} />
                                Audio
                              </span>
                            )}
                          </div>
                        )}
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

            {isDraftModel && (
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">Draft Model File (GGUF)</h3>
                  <span className="text-xs bg-secondary px-2 py-1 rounded-sm">
                    Required for Draft Model
                  </span>
                </div>

                {draftFile ? (
                  <div className="space-y-2">
                    <div className="bg-accent/10 border rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isValidatingDraft ? (
                            <IconLoader2 size={16} className="animate-spin" />
                          ) : draftValidationError ? (
                            <IconAlertTriangle
                              size={16}
                              className="text-destructive"
                            />
                          ) : (
                            <IconCheck size={16} />
                          )}
                          <span className="text-sm font-medium">
                            {draftFile.split(/[\\/]/).pop()}
                          </span>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleFileSelect('draft')}
                          disabled={importing || isValidatingDraft}
                        >
                          Change
                        </Button>
                      </div>
                    </div>

                    {draftValidationError && (
                      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <IconAlertTriangle
                            size={16}
                            className="text-destructive mt-0.5 shrink-0"
                          />
                          <div>
                            <p className="text-sm font-medium text-destructive">
                              Draft Model Validation Error
                            </p>
                            <p className="text-sm text-destructive/90 mt-1">
                              {draftValidationError}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {isValidatingDraft && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <IconLoader2
                            size={16}
                            className="text-blue-500 animate-spin"
                          />
                          <p className="text-sm text-blue-700">
                            Validating draft model file...
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => handleFileSelect('draft')}
                    disabled={importing}
                    className="w-full h-12 border border-dashed text-muted-foreground"
                  >
                    Select Draft GGUF File
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
              !modelFile ||
              !modelName ||
              (isMultimodal && !mmProjFile) ||
              (isDraftModel && !draftFile) ||
              validationError !== null ||
              isValidating ||
              mmprojValidationError !== null ||
              isValidatingMmproj ||
              draftValidationError !== null ||
              isValidatingDraft
            }
          >
            {importing && <IconLoader2 className="mr-2 size-4 animate-spin" />}
            {importing ? 'Importing...' : 'Import Model'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
