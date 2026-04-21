import HeaderPage from '@/containers/HeaderPage'
import {
  createFileRoute,
  useParams,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import {
  IconArrowLeft,
  IconDownload,
  IconHeart,
  IconClock,
  IconFile,
  IconPlayerPlay,
  IconLoader2,
  IconChevronRight,
  IconFolder,
} from '@tabler/icons-react'
import { route } from '@/constants/routes'
import { useModelScopeDetail } from '@/hooks/useModelScope'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { Loader } from 'lucide-react'
import { sanitizeModelId, toGigabytes, cn } from '@/lib/utils'
import type { ModelScopeFileListResult } from '@/services/models/types'
import {
  selectBestGgufFile,
  buildFileTree,
  countFileNodes,
  extractQuantVersions,
  type FileTreeNode,
} from './lib/modelFileUtils'
import { DownloadDialog } from '@/components/marketplace/DownloadDialog'
import { QuantSelector } from '@/components/marketplace/QuantSelector'
import { logError } from '@/lib/logger'
import { toast } from 'sonner'

type SearchParams = {
  repo?: string
}

export const Route = createFileRoute('/marketplace/$modelId' as any)({
  component: MarketplaceModelDetailContent,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
  }),
})

function MarketplaceModelDetailContent() {
  const { modelId } = useParams({ from: Route.id as any })
  const navigate = useNavigate()
  const search = useSearch({ from: Route.id as any })
  const serviceHub = useServiceHub()

  const { getProviderByName } = useModelProvider()
  const llamaProvider = getProviderByName('llamacpp')
  const {
    downloads,
    localDownloadingModels,
    addLocalDownloadingModel,
    removeLocalDownloadingModel,
  } = useDownloadStore()

  const [token, setTokenState] = useState<string | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [showTokenDialog, setShowTokenDialog] = useState(false)
  const [fileList, setFileList] = useState<ModelScopeFileListResult | null>(null)
  const [filesLoading, setFilesLoading] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false)
  const [downloadDialogQuant, setDownloadDialogQuant] = useState<string | null>(null)
  const [defaultDownloadDir, setDefaultDownloadDir] = useState('')

  const { detail, loading, error, needsAuth, fetchDetail } =
    useModelScopeDetail()

  // Fetch token
  useEffect(() => {
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke<string | null>('get_modelscope_token')
        .then((t) => setTokenState(t))
        .catch(() => setTokenState(null))
    })
  }, [])

  // Fetch default download directory
  useEffect(() => {
    import('@tauri-apps/api/path').then(({ downloadDir }) => {
      downloadDir().then((dir) => setDefaultDownloadDir(dir))
    })
  }, [])

  // Parse owner/repo from modelId
  const parts = (search.repo || modelId || '').split('/')
  const owner = parts[0] || ''
  const repoName = parts.slice(1).join('/') || ''

  // Fetch detail when token or modelId changes
  useEffect(() => {
    if (owner && repoName) {
      fetchDetail(owner, repoName, token)
    }
  }, [owner, repoName, token, fetchDetail])

  // Fetch file list when model is available
  const model = detail?.model

  useEffect(() => {
    if (!model) {
      setFileList(null)
      return
    }
    console.log('[MarketplaceDetail] model.id:', model.id)
    setFilesLoading(true)
    serviceHub
      .models()
      .fetchModelScopeFiles(model.id)
      .then((list: ModelScopeFileListResult | null) => {
        console.log('[MarketplaceDetail] raw fileList:', list)
        // Diagnostic: check field names
        if (list) {
          console.log('[MarketplaceDetail] list keys:', Object.keys(list))
          const files = (list as any).Files ?? (list as any).files
          console.log('[MarketplaceDetail] files array length:', files?.length)
          if (files?.length > 0) {
            console.log('[MarketplaceDetail] first file keys:', Object.keys(files[0]))
            console.log('[MarketplaceDetail] first file:', files[0])
          }
        }
        setFileList(list)
      })
      .catch((err) => {
        console.error('[MarketplaceDetail] fetchModelScopeFiles failed:', err)
        setFileList(null)
      })
      .finally(() => setFilesLoading(false))
  }, [model, serviceHub])

  // Show token dialog when auth is required
  const showTokenDialogRef = useRef(showTokenDialog)
  showTokenDialogRef.current = showTokenDialog
  useEffect(() => {
    if (needsAuth && !showTokenDialogRef.current) {
      setShowTokenDialog(true)
    }
  }, [needsAuth])

  const handleSaveToken = useCallback(() => {
    if (!tokenInput.trim()) return
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('save_modelscope_token', {
        token: tokenInput.trim(),
      }).then(() => {
        setTokenState(tokenInput.trim())
        setShowTokenDialog(false)
        setTokenInput('')
        // Re-fetch detail with new token
        if (owner && repoName) {
          fetchDetail(owner, repoName, tokenInput.trim())
        }
      })
    })
  }, [tokenInput, owner, repoName, fetchDetail])

  // Determine the best GGUF file to download
  const bestFile = useMemo(() => {
    const result = selectBestGgufFile(fileList)
    console.log('[MarketplaceDetail] bestFile:', result)
    return result
  }, [fileList])

  // Build hierarchical file tree from flat API response.
  const fileTree = useMemo(() => {
    const files = (fileList as any)?.Files ?? (fileList as any)?.files
    if (!Array.isArray(files)) return []
    const normalized = files.map((f: any) => ({
      Name: f.Name ?? f.name ?? '',
      Path: f.Path ?? f.path ?? '',
      Size: f.Size ?? f.size ?? 0,
      Sha256: f.Sha256 ?? f.sha256 ?? null,
      IsLFS: f.IsLFS ?? f.isLFS ?? f.is_lfs ?? false,
      Type: f.Type ?? f.type ?? 'blob',
    }))
    return buildFileTree(normalized)
  }, [fileList])

  const fileCount = useMemo(() => countFileNodes(fileTree), [fileTree])

  const quants = useMemo(() => extractQuantVersions(fileTree), [fileTree])

  const handleBatchDownload = useCallback(
    async (quantDir: string | null, saveDir: string) => {
      if (!model) return
      const batchModelId = `${model.id}${quantDir ? `-${quantDir}` : ''}`
      addLocalDownloadingModel(batchModelId)
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('download_modelscope_model', {
          request: {
            model_id: model.id,
            quant_dir: quantDir,
            save_dir: saveDir,
          },
        })
        toast.success('批量下载完成')
        // Try to register the first .gguf file found in the downloaded quant dir
        // so the model appears in the local model list.
        try {
          const { getJanDataFolderPath } = await import('@janhq/core')
          const janData = await getJanDataFolderPath()
          const searchDir = quantDir
            ? `${janData}/llamacpp/models/${model.id}/${quantDir}`
            : `${janData}/llamacpp/models/${model.id}`
          const entries = await invoke<string[]>('readdir_sync', {
            args: [searchDir],
          })
          const firstGguf = entries.find((e: string) =>
            e.toLowerCase().endsWith('.gguf')
          )
          if (firstGguf) {
            const ggufName = firstGguf.split(/[\\/]/).pop() || ''
            const relativePath = quantDir
              ? `llamacpp/models/${model.id}/${quantDir}/${ggufName}`
              : `llamacpp/models/${model.id}/${ggufName}`
            const ggufModelId = `${model.id.split('/')[0]}/${sanitizeModelId(
              ggufName.replace(/\.gguf$/i, '')
            )}`
            await serviceHub
              .models()
              .pullModel(
                ggufModelId,
                relativePath
              )
            toast.success(`模型 ${ggufModelId} 已注册`)
          }
        } catch (regErr: any) {
          logError(`Batch download model registration failed: ${regErr.message || String(regErr)}`, {
            modelId: model.id,
            quantDir,
            saveDir,
          })
          toast.error('下载完成但注册模型失败: ' + (regErr.message || String(regErr)))
        }
      } catch (err: any) {
        const errMsg = err instanceof Error ? err.message : String(err)
        logError(`Marketplace batch download failed: ${errMsg}`, {
          modelId: model.id,
          quantDir,
          saveDir,
        })
        toast.error('批量下载失败: ' + errMsg)
        console.error('Batch download failed:', err)
      } finally {
        removeLocalDownloadingModel(batchModelId)
      }
    },
    [model, serviceHub, addLocalDownloadingModel, removeLocalDownloadingModel]
  )

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  // Auto-expand directory when a quant version is selected
  useEffect(() => {
    if (!downloadDialogQuant || fileTree.length === 0) return
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      const findPath = (nodes: FileTreeNode[]): string | null => {
        for (const n of nodes) {
          if (n.type === 'dir' && n.name === downloadDialogQuant) return n.path
          if (n.children) {
            const found = findPath(n.children)
            if (found) return found
          }
        }
        return null
      }
      const path = findPath(fileTree)
      if (path) next.add(path)
      return next
    })
  }, [downloadDialogQuant, fileTree])

  const downloadProcesses = useMemo(
    () =>
      Object.values(downloads).map((download) => ({
        id: download.name,
        name: download.name,
        progress: download.progress,
        current: download.current,
        total: download.total,
      })),
    [downloads]
  )

  const handleDownloadFile = useCallback(
    async (file: { Name: string; Path: string }) => {
      if (!model) return
      const isGguf = file.Name.toLowerCase().endsWith('.gguf')
      const ns = model.id.split('/')[0]
      const fileModelId = `${ns}/${sanitizeModelId(file.Name.replace(/\.gguf$/i, ''))}`

      if (isGguf) {
        addLocalDownloadingModel(fileModelId)
        try {
          // Use our ModelScope native download command to avoid
          // HEAD-request 500 errors from the generic download_files path.
          const { getJanDataFolderPath } = await import('@janhq/core')
          const janData = await getJanDataFolderPath()
          const saveDir = `${janData}/llamacpp/models/${fileModelId}`

          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('download_modelscope_model', {
            request: {
              model_id: model.id,
              file_path: file.Path,
              save_name: 'model.gguf',
              save_dir: saveDir,
            },
          })

          // Register the model with local path so llamacpp-extension
          // skips its own download (and the buggy HEAD preflight).
          await serviceHub
            .models()
            .pullModel(
              fileModelId,
              `llamacpp/models/${fileModelId}/model.gguf`
            )
          toast.success(`模型 ${fileModelId} 下载完成`)
        } catch (err: any) {
          const errMsg = err instanceof Error ? err.message : String(err)
          logError(`Marketplace single-file download failed: ${errMsg}`, {
            modelId: model.id,
            filePath: file.Path,
            fileModelId,
          })
          toast.error('下载失败: ' + errMsg)
          console.error('Download failed:', err)
        } finally {
          removeLocalDownloadingModel(fileModelId)
        }
      } else {
        // For non-GGUF files, we currently only support browsing.
        console.warn(
          `[MarketplaceDetail] Non-GGUF file download not yet supported: ${file.Name}`
        )
      }
    },
    [model, addLocalDownloadingModel, removeLocalDownloadingModel, serviceHub]
  )

  const renderFileTree = useCallback(
    (nodes: FileTreeNode[], depth = 0): React.ReactNode => {
      return nodes.map((node) => {
        const paddingLeft = depth * 16 + 4

        if (node.type === 'dir') {
          const isExpanded = expandedDirs.has(node.path)
          return (
            <div key={node.path}>
              <div
                className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-muted/50 rounded px-1 group"
                style={{ paddingLeft: `${paddingLeft}px` }}
                onClick={() => toggleDir(node.path)}
              >
                <IconFolder size={16} className="text-amber-500 shrink-0" />
                <span className="text-sm font-medium flex-1">{node.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDownloadDialogQuant(node.name)
                    setDownloadDialogOpen(true)
                  }}
                >
                  <IconDownload size={14} />
                  下载此版本
                </Button>
                <IconChevronRight
                  size={14}
                  className={cn(
                    'ml-auto text-muted-foreground transition-transform',
                    isExpanded && 'rotate-90'
                  )}
                />
              </div>
              {isExpanded && node.children && (
                <div>{renderFileTree(node.children, depth + 1)}</div>
              )}
            </div>
          )
        }

        // File node
        const isGguf = node.name.toLowerCase().endsWith('.gguf')
        const isMmproj = node.name.toLowerCase().includes('mmproj')
        const isRunnable = isGguf && !isMmproj
        const isBest = bestFile?.Name === node.name
        const fileModelId = model
          ? `${model.id.split('/')[0]}/${sanitizeModelId(
              node.name.replace(/\.gguf$/i, '')
            )}`
          : ''
        const fileIsDownloading = fileModelId
          ? localDownloadingModels.has(fileModelId) ||
            downloadProcesses.some((e) => e.id === fileModelId)
          : false
        const fileDownloadProgress = fileModelId
          ? downloadProcesses.find((e) => e.id === fileModelId)?.progress || 0
          : 0
        const fileIsDownloaded = fileModelId
          ? llamaProvider?.models.some(
              (m: { id: string }) => m.id === fileModelId
            ) ?? false
          : false

        return (
          <div
            key={node.path}
            className="flex items-center justify-between gap-3 py-1.5 hover:bg-muted/30 rounded px-1"
            style={{ paddingLeft: `${paddingLeft}px` }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <IconFile
                size={16}
                className={
                  isRunnable
                    ? 'text-primary shrink-0'
                    : 'text-muted-foreground shrink-0'
                }
              />
              <div className="flex flex-col min-w-0">
                <span className="text-sm text-foreground truncate">
                  {node.name}
                  {isBest && (
                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-600">
                      推荐
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {node.size && node.size > 0
                    ? toGigabytes(node.size)
                    : '大小未知'}
                  {!isRunnable && (
                    <span className="ml-2 text-amber-500">
                      暂不支持本地推理
                    </span>
                  )}
                </span>
              </div>
            </div>
            <div className="shrink-0">
              {isRunnable ? (
                fileIsDownloading ? (
                  <div className="flex items-center gap-3 w-40">
                    <Progress
                      value={fileDownloadProgress * 100}
                      className="h-2 flex-1"
                    />
                    <span className="text-xs text-muted-foreground font-mono w-10 text-right">
                      {Math.round(fileDownloadProgress * 100)}%
                    </span>
                  </div>
                ) : fileIsDownloaded ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      if (!fileModelId) return
                      navigate({
                        to: route.home,
                        params: {},
                        search: {
                          threadModel: {
                            id: fileModelId,
                            provider: 'llamacpp',
                          },
                        },
                      })
                    }}
                  >
                    <IconPlayerPlay size={14} />
                    使用
                  </Button>
                ) : (
                  <Button
                    variant={isBest ? 'default' : 'outline'}
                    size="sm"
                    className="gap-1"
                    onClick={() =>
                      handleDownloadFile({
                        Name: node.name,
                        Path: node.path,
                      })
                    }
                  >
                    <IconDownload size={14} />
                    下载
                  </Button>
                )
              ) : (
                <span className="text-xs text-muted-foreground px-2">
                  仅供浏览
                </span>
              )}
            </div>
          </div>
        )
      })
    },
    [
      expandedDirs,
      toggleDir,
      bestFile,
      model,
      handleDownloadFile,
      localDownloadingModels,
      downloadProcesses,
      llamaProvider,
      navigate,
    ]
  )

  const formatDate = (dateString?: string) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    if (diffDays < 7) return `${diffDays} 天前`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} 月前`
    return `${Math.floor(diffDays / 365)} 年前`
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <Button
            onClick={() => navigate({ to: route.marketplace.index })}
            aria-label="返回"
            variant="ghost"
            size="sm"
            className="relative z-20"
          >
            <IconArrowLeft size={18} className="text-muted-foreground" />
            <span className="text-foreground">返回模型市场</span>
          </Button>
          {token && (
            <span className="text-xs px-2 py-0.5 rounded border border-green-500/30 text-green-600 bg-green-500/10">
              Token 已配置
            </span>
          )}
        </div>
      </HeaderPage>

      {/* Token dialog */}
      {showTokenDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg p-6 w-[420px] max-w-[90vw]">
            <h3 className="text-lg font-medium mb-2">
              需要 ModelScope 访问令牌
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              查看此模型的详情需要 ModelScope 访问令牌。
              <br />
              你可以前往{' '}
              <a
                href="https://www.modelscope.cn/my/myaccesstoken"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                魔搭控制台
              </a>{' '}
              获取令牌。
            </p>
            <input
              type="text"
              placeholder="输入 ModelScope Access Token"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="w-full px-3 py-2 rounded border border-border bg-background text-sm mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowTokenDialog(false)
                  setTokenInput('')
                }}
              >
                暂不配置
              </Button>
              <Button size="sm" onClick={handleSaveToken}>
                保存并查看
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="md:w-4/5 mx-auto">
          <div className="max-w-4xl mx-auto p-6">
            {loading && !model ? (
              <div className="flex items-center justify-center py-12">
                <Loader className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : error && !model ? (
              <div className="text-center py-12">
                <p className="text-destructive mb-2">加载失败</p>
                <p className="text-sm text-muted-foreground">{error}</p>
                {needsAuth && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => setShowTokenDialog(true)}
                  >
                    配置访问令牌
                  </Button>
                )}
              </div>
            ) : model ? (
              <>
                {/* Model Header */}
                <div className="mb-8">
                  <h1 className="text-2xl font-semibold capitalize wrap-break-word line-clamp-2 mb-4">
                    {model.display_name ||
                      model.id.split('/').pop() ||
                      model.id}
                  </h1>

                  {/* Stats */}
                  <div className="flex items-center gap-4 text-sm text-foreground mb-4 flex-wrap">
                    <span>By {model.id.split('/')[0]}</span>
                    <div className="flex items-center gap-1">
                      <IconDownload size={16} />
                      <span>{model.downloads.toLocaleString()} 下载</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <IconHeart size={16} />
                      <span>{model.likes.toLocaleString()} 喜欢</span>
                    </div>
                    {model.created_at && (
                      <div className="flex items-center gap-1">
                        <IconClock size={16} />
                        <span>更新于 {formatDate(model.created_at)}</span>
                      </div>
                    )}
                  </div>

                  {/* Tasks */}
                  {model.tasks && model.tasks.length > 0 && (
                    <div className="flex gap-2 flex-wrap mb-4">
                      {model.tasks.map((task) => (
                        <span
                          key={task}
                          className="px-3 py-1 text-sm bg-secondary rounded-md"
                        >
                          {task}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* License */}
                  {model.license && (
                    <div className="text-sm text-muted-foreground mb-4">
                      许可证: {model.license}
                    </div>
                  )}

                  {/* Description */}
                  {model.description && (
                    <div className="text-muted-foreground mb-4">
                      <RenderMarkdown
                        className="select-none reset-heading"
                        components={{
                          a: ({ ...props }: any) => (
                            <a
                              {...props}
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          ),
                        }}
                        content={model.description}
                      />
                    </div>
                  )}

                  {/* Download Section */}
                  <div className="rounded-lg border border-border bg-card p-4 mt-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-foreground">
                        模型文件
                        {fileCount > 0 && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            共 {fileCount} 个文件
                          </span>
                        )}
                      </h3>
                      {quants.length > 0 && (
                        <QuantSelector
                          quants={quants}
                          selected={downloadDialogQuant ?? 'all'}
                          onSelect={(value) => {
                            if (value === 'all') {
                              setDownloadDialogQuant(null)
                            } else {
                              setDownloadDialogQuant(value)
                            }
                          }}
                          onDownload={() => setDownloadDialogOpen(true)}
                        />
                      )}
                    </div>
                    {filesLoading ? (
                      <div className="flex items-center gap-2 py-2">
                        <IconLoader2
                          size={16}
                          className="animate-spin text-muted-foreground"
                        />
                        <span className="text-sm text-muted-foreground">
                          正在获取文件列表...
                        </span>
                      </div>
                    ) : fileList === null ? (
                      <div className="flex flex-col gap-1 py-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <IconFile size={16} />
                          <span>获取文件列表失败，请打开控制台查看详细错误</span>
                        </div>
                      </div>
                    ) : fileTree.length > 0 ? (
                      <div className="flex flex-col">
                        {renderFileTree(fileTree, 0)}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                        <IconFile size={16} />
                        <span>暂无文件</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* README */}
                {model.readme ? (
                  <div className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                      <h2 className="text-lg font-semibold text-foreground">
                        README
                      </h2>
                    </div>
                    <div className="prose prose-invert max-w-none">
                      <RenderMarkdown
                        components={{
                          a: ({ ...props }: any) => (
                            <a
                              {...props}
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          ),
                        }}
                        content={model.readme}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mb-8 p-4 rounded bg-muted/50 text-center text-muted-foreground text-sm">
                    暂无 README 内容
                    {!token && (
                      <div className="mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowTokenDialog(true)}
                        >
                          配置令牌查看完整信息
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* ModelScope link */}
                <div className="flex items-center justify-center py-4">
                  <a
                    href={`https://www.modelscope.cn/models/${model.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    在 ModelScope 上查看此模型 →
                  </a>
                </div>

                <DownloadDialog
                  open={downloadDialogOpen}
                  modelName={model?.id ?? ''}
                  fileTree={fileTree}
                  defaultSaveDir={`${defaultDownloadDir}/RongxinAI/Models/${model?.id ?? ''}`}
                  defaultQuant={downloadDialogQuant}
                  onClose={() => setDownloadDialogOpen(false)}
                  onConfirm={(quantDir, saveDir) => {
                    setDownloadDialogOpen(false)
                    handleBatchDownload(quantDir, saveDir)
                  }}
                />
              </>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                模型未找到
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
