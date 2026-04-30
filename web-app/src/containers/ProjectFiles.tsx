import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { FileText, Trash2, UploadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn, formatBytes } from '@/lib/utils'
import { toast } from 'sonner'
import { useServiceHub } from '@/hooks/useServiceHub'
import { createDocumentAttachment, type Attachment } from '@/types/attachment'
import { useAttachments } from '@/hooks/useAttachments'
import { ExtensionTypeEnum, FileStat, VectorDBExtension } from '@janhq/core'
import { ExtensionManager } from '@/lib/extension'
import { IconLoader2, IconPaperclip } from '@tabler/icons-react'

type ProjectFilesProps = {
  projectId: string
  lng: string
}

type ProjectFile = {
  id: string
  name?: string
  path?: string
  type?: string
  size?: number
  chunk_count: number
}

const SUPPORTED_EXTENSIONS = [
  // Documents
  'pdf',
  'docx',
  'txt',
  'md',
  'csv',
  'xlsx',
  'xls',
  'ods',
  'pptx',
  'html',
  'htm',
  'xhtml',
  // JavaScript / TypeScript
  'js',
  'mjs',
  'cjs',
  'ts',
  'mts',
  'cts',
  'jsx',
  'tsx',
  // Python
  'py',
  'pyw',
  'pyi',
  // C / C++
  'c',
  'h',
  'cpp',
  'cc',
  'cxx',
  'hpp',
  'hh',
  // Systems languages
  'rs',
  'go',
  'swift',
  'zig',
  // JVM languages
  'java',
  'kt',
  'kts',
  'scala',
  'groovy',
  // Scripting languages
  'rb',
  'php',
  'lua',
  'pl',
  'r',
  'jl',
  // .NET
  'cs',
  'fs',
  'vb',
  'xaml',
  'csproj',
  'sln',
  // CUDA
  'cu',
  'cuh',
  // Shaders
  'hlsl',
  'glsl',
  'cg',
  'shader',
  // Shell / Scripting
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'bat',
  'cmd',
  'vbs',
  // More languages
  'asm',
  's',
  'm',
  'mm',
  'pas',
  'pp',
  'erl',
  'hrl',
  'ex',
  'exs',
  'clj',
  'cljs',
  'hs',
  'lhs',
  'ml',
  'mli',
  'f',
  'f90',
  // Web
  'css',
  'scss',
  'sass',
  'less',
  'vue',
  'svelte',
  'astro',
  'php',
  'asp',
  'aspx',
  'jsp',
  // Data / config formats
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'xml',
  'ini',
  'cfg',
  'conf',
  'env',
  'properties',
  'dockerfile',
  'makefile',
  'cmake',
  'lock',
  // Query / markup
  'sql',
  'graphql',
  'gql',
  'tex',
  'rst',
  'adoc',
  'textile',
  // Misc text
  'log',
  'diff',
  'patch',
  'gitignore',
]

async function getFilesFromPaths(paths: string[]): Promise<string[]> {
  const files: string[] = []
  const { fs } = await import('@janhq/core')

  for (const path of paths) {
    try {
      const stat: FileStat | undefined = await fs.fileStat(path)
      if (stat?.isDirectory) {
        // Recursively get files from directory
        const dirFiles = await getFilesFromDirectory(path, fs)
        files.push(...dirFiles)
      } else {
        files.push(path)
      }
    } catch (e) {
      console.warn(`Failed to get stat for ${path}:`, e)
      files.push(path)
    }
  }
  return files
}

async function getFilesFromDirectory(
  dirPath: string,
  fs: typeof import('@janhq/core').fs
): Promise<string[]> {
  const files: string[] = []
  try {
    const entries = await fs.readdirSync(dirPath)
    for (const entry of entries) {
      console.log('Reading entry:', entry)
      const stat = await fs.fileStat(entry)
      if (stat?.isDirectory) {
        const nestedFiles = await getFilesFromDirectory(entry, fs)
        files.push(...nestedFiles)
      } else if (!stat?.isDirectory) {
        const ext = entry.split('.').pop()?.toLowerCase()
        if (ext && SUPPORTED_EXTENSIONS.includes(ext)) {
          files.push(entry)
        }
      }
    }
  } catch (e) {
    console.warn(`Failed to read directory ${dirPath}:`, e)
  }
  return files
}

export default function ProjectFiles({ projectId, lng }: ProjectFilesProps) {
  const { t } = useTranslation(lng)
  const serviceHub = useServiceHub()
  const attachmentsEnabled = useAttachments((s) => s.enabled)
  const maxFileSizeMB = useAttachments((s) => s.maxFileSizeMB)

  const [files, setFiles] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const loadProjectFiles = useCallback(async () => {
    setLoading(true)
    try {
      const ext = ExtensionManager.getInstance().get<VectorDBExtension>(
        ExtensionTypeEnum.VectorDB
      )
      if (ext?.listAttachmentsForProject) {
        const projectFiles = await ext.listAttachmentsForProject(projectId)
        setFiles(projectFiles)
      } else {
        setFiles([])
      }
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadProjectFiles()
  }, [loadProjectFiles])

  const processFilePaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return

      // Get files from paths (recursively for directories)
      const filePaths = await getFilesFromPaths(paths)

      const maxFileSizeBytes =
        typeof maxFileSizeMB === 'number' && maxFileSizeMB > 0
          ? maxFileSizeMB * 1024 * 1024
          : undefined

      const preparedAttachments: Attachment[] = []
      for (const p of filePaths) {
        const name = p.split(/[\\/]/).pop() || p
        const fileType = name.split('.').pop()?.toLowerCase()

        // Filter unsupported file types
        if (!fileType || !SUPPORTED_EXTENSIONS.includes(fileType)) {
          toast.warning(
            t('common:toast.unsupportedFileType.title'),
            {
              description: t('common:toast.unsupportedFileType.description', {
                extension: fileType || 'unknown',
              }),
            }
          )
          continue
        }

        let size: number | undefined = undefined
        try {
          const stat = await import('@janhq/core').then((m) => m.fs.fileStat(p))
          size = stat?.size ? Number(stat.size) : undefined
        } catch (e) {
          console.warn('Failed to read file size for', p, e)
        }

        if (maxFileSizeBytes !== undefined && size && size > maxFileSizeBytes) {
          toast.error(t('common:errors.fileTooLarge') ?? 'File too large', {
            description: t('common:errors.fileTooLargeDescription', {
              fileName: name,
              maxFileSizeMB,
            }),
          })
          continue
        }

        preparedAttachments.push(
          createDocumentAttachment({
            name,
            path: p,
            fileType,
            size,
          })
        )
      }

      // Filter duplicates
      const existingPaths = new Set(
        files.filter((f) => f.path).map((f) => f.path)
      )
      const duplicates: string[] = []
      const newAttachments = preparedAttachments.filter((att) => {
        if (existingPaths.has(att.path)) {
          duplicates.push(att.name)
          return false
        }
        return true
      })

      if (duplicates.length > 0) {
        toast.warning(
          t('common:toast.fileAlreadyExists.title') ?? 'File already attached',
          {
            description: duplicates.join(', '),
          }
        )
      }

      if (newAttachments.length === 0) return

      const total = newAttachments.length
      setUploading(true)
      setUploadProgress({ current: 0, total })
      try {
        for (let i = 0; i < newAttachments.length; i++) {
          const att = newAttachments[i]
          const result = await serviceHub
            .uploads()
            .ingestFileAttachmentForProject(projectId, att)
          if (!result.id) {
            throw new Error('Failed to ingest file')
          }
          setUploadProgress({ current: i + 1, total })
        }
        toast.success(
          t('common:toast.fileUploaded.title') ?? 'File uploaded successfully'
        )
        await loadProjectFiles()
      } catch (error) {
        console.error('Failed to upload file:', error)
        toast.error(
          t('common:toast.uploadFailed.title') ?? 'Failed to upload file',
          {
            description:
              error instanceof Error ? error.message : JSON.stringify(error),
          }
        )
      } finally {
        setUploadProgress(null)
        setUploading(false)
      }
    },
    [files, loadProjectFiles, maxFileSizeMB, projectId, serviceHub, t]
  )

  const handleUpload = async () => {
    if (!attachmentsEnabled) {
      toast.info(
        t('common:toast.attachmentsDisabledInfo.title') ??
          'Attachments are disabled in Settings'
      )
      return
    }

    try {
      const selection = await serviceHub.dialog().open({
        multiple: true,
        directory: false,
        filters: [
          {
            name: 'Documents & Code',
            extensions: SUPPORTED_EXTENSIONS,
          },
          {
            name: 'All Files',
            extensions: ['*'],
          },
        ],
      })
      if (!selection) return
      const paths = Array.isArray(selection) ? selection : [selection]
      await processFilePaths(paths)
    } catch (error) {
      console.error('Failed to open file dialog:', error)
      const desc =
        error instanceof Error ? error.message : JSON.stringify(error)
      toast.error(
        t('common:toast.uploadFailed.title') ?? 'Failed to upload file',
        {
          description: desc,
        }
      )
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (!attachmentsEnabled) {
      toast.info(
        t('common:toast.attachmentsDisabledInfo.title') ??
          'Attachments are disabled in Settings'
      )
      return
    }

    // Get file paths from the drop event (Tauri provides paths directly)
    const paths: string[] = []
    const items = e.dataTransfer.items
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file && 'path' in file && typeof file.path === 'string') {
            paths.push(file.path)
          }
        }
      }
    }

    if (paths.length === 0) {
      // Fallback for web: check dataTransfer.files
      const dtFiles = e.dataTransfer.files
      for (let i = 0; i < dtFiles.length; i++) {
        const file = dtFiles[i]
        if ('path' in file && typeof file.path === 'string') {
          paths.push(file.path)
        }
      }
    }

    if (paths.length > 0) {
      await processFilePaths(paths)
    }
  }

  const handleDeleteFile = async (fileId: string) => {
    try {
      const ext = ExtensionManager.getInstance().get<VectorDBExtension>(
        ExtensionTypeEnum.VectorDB
      )
      if (ext?.deleteFileForProject) {
        await ext.deleteFileForProject(projectId, fileId)
        toast.success(
          t('common:toast.fileDeleted.title') ?? 'File deleted successfully'
        )
        await loadProjectFiles()
      }
    } catch (error) {
      console.error('Failed to delete file:', error)
      toast.error(
        t('common:toast.deleteFailed.title') ?? 'Failed to delete file',
        {
          description:
            error instanceof Error ? error.message : JSON.stringify(error),
        }
      )
    }
  }

  const isEmpty = !loading && files.length === 0

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">{t('common:projects.files')}</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUpload}
          disabled={uploading}
        >
          {uploading ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : (
            <UploadIcon className="size-4" />
          )}
          <span>Upload</span>
        </Button>
      </div>

      {uploadProgress && uploadProgress.total > 0 && (
        <div className="mb-3 space-y-1.5">
          <div className="flex justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {t('common:projects.uploadingFiles')}
            </span>
            <span className="tabular-nums shrink-0">
              {uploadProgress.current} / {uploadProgress.total}
            </span>
          </div>
          <Progress
            value={(uploadProgress.current / uploadProgress.total) * 100}
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : isEmpty ? (
        <div
          className={cn(
            'flex flex-col items-center justify-center py-8 px-4 rounded-lg border border-dashed cursor-pointer transition-colors',
            isDragging
              ? 'bg-primary/10 border-primary'
              : 'bg-secondary/30 border-border hover:bg-secondary/50'
          )}
          onClick={handleUpload}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <FileText className="size-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground text-center">
            {t('common:projects.filesDescription')}
          </p>
        </div>
      ) : (
        <div
          className={cn(
            'space-y-2 rounded-lg p-1 -m-1 transition-colors',
            isDragging && 'bg-primary/10 ring-2 ring-primary ring-dashed'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {files.map((file) => (
            <div
              key={file.id}
              className={cn(
                'flex items-center gap-2 p-2 rounded-lg',
                'bg-secondary/30 border border-border/50',
                'group hover:bg-secondary/50 transition-colors'
              )}
            >
              <div className="shrink-0">
                <IconPaperclip className="size-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="text-sm font-medium truncate">{file.name}</p>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">{file.name}</p>
                  </TooltipContent>
                </Tooltip>
                <p className="text-xs text-muted-foreground">
                  {file.size
                    ? formatBytes(file.size, {
                        decimals: (_, unit) => (unit === 'B' ? 0 : 1),
                      })
                    : ''}
                  {file.chunk_count > 0 &&
                    ` · ${t('common:files.chunksCount', { count: file.chunk_count })}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleDeleteFile(file.id)}
              >
                <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          ))}

          <div
          className={cn(
            'flex mt-2 flex-col items-center justify-center py-8 px-4 rounded-lg border border-dashed cursor-pointer transition-colors',
            isDragging
              ? 'bg-primary/10 border-primary'
              : 'bg-secondary/30 border-border hover:bg-secondary/50'
          )}
          onClick={handleUpload}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <FileText className="size-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground text-center">
            {t('common:projects.filesDescription')}
          </p>
        </div>
        </div>
      )}
    </div>
  )
}
