import HeaderPage from '@/containers/HeaderPage'
import {
  createFileRoute,
  useParams,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import { IconArrowLeft, IconDownload, IconHeart, IconClock } from '@tabler/icons-react'
import { route } from '@/constants/routes'
import { useModelScopeDetail } from '@/hooks/useModelScope'
// import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { Loader } from 'lucide-react'

export const Route = createFileRoute('/marketplace/$modelId' as any)({
  component: MarketplaceModelDetailContent,
})

function MarketplaceModelDetailContent() {
  const { modelId } = useParams({ from: Route.id as any })
  const navigate = useNavigate()
  const search = useSearch({ from: Route.id as any })
  // const serviceHub = useServiceHub()

  const [token, setTokenState] = useState<string | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [showTokenDialog, setShowTokenDialog] = useState(false)

  const { detail, loading, error, needsAuth, fetchDetail } = useModelScopeDetail()

  // Fetch token
  useEffect(() => {
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke<string | null>('get_modelscope_token')
        .then((t) => setTokenState(t))
        .catch(() => setTokenState(null))
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

  // Show token dialog when auth is required
  useEffect(() => {
    if (needsAuth && !showTokenDialog) {
      setShowTokenDialog(true)
    }
  }, [needsAuth])

  const handleSaveToken = useCallback(() => {
    if (!tokenInput.trim()) return
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('save_modelscope_token', { token: tokenInput.trim() }).then(() => {
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

  const model = detail?.model

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
            <h3 className="text-lg font-medium mb-2">需要 ModelScope 访问令牌</h3>
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
                  <h1 className="text-2xl font-semibold mb-4 capitalize wrap-break-word line-clamp-2">
                    {model.display_name || model.id.split('/').pop() || model.id}
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
                            <a {...props} target="_blank" rel="noopener noreferrer" />
                          ),
                        }}
                        content={model.description}
                      />
                    </div>
                  )}
                </div>

                {/* README */}
                {model.readme ? (
                  <div className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                      <h2 className="text-lg font-semibold text-foreground">README</h2>
                    </div>
                    <div className="prose prose-invert max-w-none">
                      <RenderMarkdown
                        components={{
                          a: ({ ...props }: any) => (
                            <a {...props} target="_blank" rel="noopener noreferrer" />
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
