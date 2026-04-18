import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelScope } from '@/hooks/useModelScope'
import { cn } from '@/lib/utils'
import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react'
import {
  IconSearch,
  IconChevronDown,
  IconFilter,
  IconX,
} from '@tabler/icons-react'
import {
  MODELSCOPE_SORT_OPTIONS,
  MODELSCOPE_TASK_OPTIONS,
  MODELSCOPE_LIBRARY_OPTIONS,
  type ListModelScopeModelsParams,
} from '@/services/modelscope/types'
import HeaderPage from '@/containers/HeaderPage'
import { Loader } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ModelCard } from '@/components/marketplace/ModelCard'

// TODO: fix route type inference for marketplace.index
export const Route = createFileRoute(route.marketplace.index as any)({
  component: MarketplaceContent,
})

function MarketplaceContent() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  const {
    models,
    totalCount,
    loading,
    error,
    hasMore,
    params,
    token,
    setToken,
    updateParams,
    loadMore,
    resetFilters,
  } = useModelScope()

  const [searchValue, setSearchValue] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [showTokenDialog, setShowTokenDialog] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const loadMoreCallbackRef = useRef(loadMore)
  loadMoreCallbackRef.current = loadMore

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(() => {
      updateParams({ search: searchValue || undefined })
    }, 400)
    return () => clearTimeout(handler)
  }, [searchValue, updateParams])

  // Infinite scroll observer
  // loadMore is wrapped in a ref to avoid recreating the observer on every state change.
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) {
          loadMoreCallbackRef.current()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [hasMore, loading])

  const activeFilterCount =
    (params.filter_task ? 1 : 0) +
    (params.filter_library ? 1 : 0) +
    (params.filter_model_type ? 1 : 0) +
    (params.filter_custom_tag ? 1 : 0) +
    (params.filter_license ? 1 : 0) +
    (params.filter_deploy ? 1 : 0)

  const activeFilters: {
    key: keyof ListModelScopeModelsParams
    label: string
    value: string
  }[] = []
  if (params.filter_task) {
    const opt = MODELSCOPE_TASK_OPTIONS.find(
      (o) => o.value === params.filter_task
    )
    activeFilters.push({
      key: 'filter_task',
      label: '任务',
      value: opt?.label || params.filter_task,
    })
  }
  if (params.filter_library) {
    const opt = MODELSCOPE_LIBRARY_OPTIONS.find(
      (o) => o.value === params.filter_library
    )
    activeFilters.push({
      key: 'filter_library',
      label: '框架',
      value: opt?.label || params.filter_library,
    })
  }
  if (params.filter_custom_tag) {
    activeFilters.push({
      key: 'filter_custom_tag',
      label: '标签',
      value: params.filter_custom_tag,
    })
  }
  if (params.filter_license) {
    activeFilters.push({
      key: 'filter_license',
      label: '许可证',
      value: params.filter_license,
    })
  }
  if (params.filter_model_type) {
    activeFilters.push({
      key: 'filter_model_type',
      label: '模型类型',
      value: params.filter_model_type,
    })
  }
  if (params.filter_deploy) {
    activeFilters.push({
      key: 'filter_deploy',
      label: '部署',
      value: params.filter_deploy,
    })
  }

  const handleRemoveFilter = useCallback(
    (key: keyof ListModelScopeModelsParams) => {
      const patch: Partial<ListModelScopeModelsParams> = {}
      patch[key] = undefined
      updateParams(patch)
    },
    [updateParams]
  )

  const handleTagClick = useCallback(
    (type: 'task' | 'library' | 'license' | 'params', value: string) => {
      if (type === 'task') {
        updateParams({ filter_task: value })
      } else if (type === 'library') {
        updateParams({ filter_library: value })
      } else if (type === 'license') {
        updateParams({ filter_license: value })
      }
      setShowFilters(true)
    },
    [updateParams]
  )

  const handleSaveToken = useCallback(() => {
    setToken(tokenInput)
      .then(() => {
        setShowTokenDialog(false)
        setTokenInput('')
      })
      .catch((err) => {
        console.error('[Marketplace] Failed to save token:', err)
      })
  }, [tokenInput, setToken])

  const sortLabel =
    MODELSCOPE_SORT_OPTIONS.find((o) => o.value === params.sort)?.label ??
    t('hub:sortLabel') ?? '排序'

  return (
    <div className="flex flex-col h-svh w-full">
      <div className="flex flex-col h-full w-full">
        <HeaderPage>
          <div
            className={cn(
              'pr-3 py-3 min-h-10 w-full flex items-center justify-between relative z-20 flex-wrap gap-y-2',
              !IS_MACOS && 'pr-30'
            )}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <IconSearch
                className="shrink-0 text-muted-foreground"
                size={14}
              />
              <input
                placeholder={
                  t('hub:searchPlaceholder') ?? '搜索模型...'
                }
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className="w-full min-w-0 focus:outline-none bg-transparent"
              />
              {searchValue && (
                <button
                  onClick={() => setSearchValue('')}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <IconX size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {/* Token status */}
              <button
                onClick={() => {
                  if (token) {
                    setToken(null)
                  } else {
                    setShowTokenDialog(true)
                  }
                }}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full border',
                  token
                    ? 'border-green-500/30 text-green-600 bg-green-500/10'
                    : 'border-amber-500/30 text-amber-600 bg-amber-500/10'
                )}
                title={
                  token
                    ? '已配置 ModelScope Token，点击清除'
                    : '未配置 ModelScope Token，点击配置'
                }
              >
                {token ? 'Token 已配置' : 'Token 未配置'}
              </button>

              {/* Sort dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    {sortLabel}
                    <IconChevronDown className="ml-1 size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {MODELSCOPE_SORT_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      className={cn(
                        'cursor-pointer',
                        params.sort === option.value && 'bg-secondary'
                      )}
                      onClick={() =>
                        updateParams({ sort: option.value })
                      }
                    >
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Filter toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters((p) => !p)}
                className={cn(
                  activeFilterCount > 0 && 'border-primary'
                )}
              >
                <IconFilter className="size-3 mr-1" />
                筛选
                {activeFilterCount > 0 && (
                  <span className="ml-1 text-xs bg-primary text-primary-foreground rounded-full px-1.5">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </div>
          </div>
        </HeaderPage>

        {/* Active filters bar */}
        {activeFilterCount > 0 && (
          <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground shrink-0">
              筛选:
            </span>
            {activeFilters.map((f) => (
              <span
                key={f.key}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground"
              >
                {f.value}
                <button
                  onClick={() => handleRemoveFilter(f.key)}
                  className="hover:text-foreground"
                  title="移除筛选"
                >
                  <IconX size={12} />
                </button>
              </span>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground"
              onClick={resetFilters}
            >
              <IconX size={12} className="mr-1" />
              清除筛选
            </Button>
          </div>
        )}

        {/* Filters panel */}
        {showFilters && (
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex flex-wrap gap-3 items-center">
              <FilterSelect
                label="任务"
                value={params.filter_task}
                options={MODELSCOPE_TASK_OPTIONS}
                onChange={(v) => updateParams({ filter_task: v })}
              />
              <FilterSelect
                label="框架"
                value={params.filter_library}
                options={MODELSCOPE_LIBRARY_OPTIONS}
                onChange={(v) => updateParams({ filter_library: v })}
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  标签
                </span>
                <input
                  type="text"
                  placeholder="如: llm, gguf"
                  value={params.filter_custom_tag ?? ''}
                  onChange={(e) =>
                    updateParams({
                      filter_custom_tag:
                        e.target.value || undefined,
                    })
                  }
                  className="text-sm px-2 py-1 rounded border border-border bg-background w-28"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  许可证
                </span>
                <input
                  type="text"
                  placeholder="如: apache-2.0"
                  value={params.filter_license ?? ''}
                  onChange={(e) =>
                    updateParams({
                      filter_license:
                        e.target.value || undefined,
                    })
                  }
                  className="text-sm px-2 py-1 rounded border border-border bg-background w-32"
                />
              </div>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="text-muted-foreground"
                >
                  <IconX className="size-3 mr-1" />
                  清除筛选
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Token dialog */}
        {showTokenDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-card border border-border rounded-lg p-6 w-[400px] max-w-[90vw]">
              <h3 className="text-lg font-medium mb-2">
                配置 ModelScope 访问令牌
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                配置令牌后可以查看模型详情（README、文件列表等）。
                <br />
                列表浏览不需要令牌。
              </p>
              <input
                type="text"
                placeholder="输入你的 ModelScope Access Token"
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
                  取消
                </Button>
                <Button size="sm" onClick={handleSaveToken}>
                  保存
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="p-4 w-full flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-col h-full gap-4 w-full md:w-4/5 xl:w-4/6 mx-auto">
            {/* Stats bar */}
            <div className="flex items-center flex-wrap min-w-0 text-xs text-muted-foreground">
              <span className="min-w-0">
                共 {totalCount.toLocaleString()} 个模型
                {models.length > 0 &&
                  ` · 已加载 ${models.length.toLocaleString()} 个`}
                {' · '}
                按"{sortLabel}"排序
              </span>
            </div>

            {loading && models.length === 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-card border border-border rounded-lg p-4 overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-x-2">
                      <div className="h-4 bg-muted rounded w-1/3" />
                      <div className="h-3 bg-muted rounded w-16" />
                    </div>
                    <div className="mt-3 h-3 bg-muted rounded w-full" />
                    <div className="mt-2 h-3 bg-muted rounded w-2/3" />
                    <div className="mt-3 flex items-center gap-2">
                      <div className="h-3 bg-muted rounded w-12" />
                      <div className="h-3 bg-muted rounded w-16" />
                      <div className="ml-auto h-3 bg-muted rounded w-10" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <p className="text-destructive mb-2">加载失败</p>
                  <p className="text-sm text-muted-foreground">
                    {error}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => updateParams({})}
                  >
                    重试
                  </Button>
                </div>
              </div>
            ) : models.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center text-muted-foreground">
                  {searchValue || activeFilterCount > 0
                    ? '没有找到匹配的模型'
                    : '暂无模型数据'}
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-2">
                  {models.map((model) => (
                    <ModelCard
                      key={model.id}
                      model={model}
                      onClick={(modelId: string) =>
                        navigate({
                          to: route.marketplace.model,
                          params: { modelId },
                          search: { repo: modelId },
                        })
                      }
                      onTagClick={handleTagClick}
                    />
                  ))}
                </div>

                {/* Load more trigger - placed outside grid for stable ref node */}
                <div ref={loadMoreRef} className="py-4 flex justify-center">
                  {loading && models.length > 0 && (
                    <Loader className="size-5 animate-spin text-muted-foreground" />
                  )}
                  {!hasMore && models.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      已加载全部 {models.length.toLocaleString()} 个模型
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value?: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string | undefined) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="text-sm px-2 py-1 rounded border border-border bg-background"
      >
        <option value="">全部</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
