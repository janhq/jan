import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelSources } from '@/hooks/useModelSources'
import { cn, fuzzySearch, toGigabytes } from '@/lib/utils'
import { useState, useMemo, useEffect, ChangeEvent, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useModelProvider } from '@/hooks/useModelProvider'
import { Card, CardItem } from '@/containers/Card'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { extractModelName, extractDescription } from '@/lib/models'
import { IconDownload, IconFileCode, IconSearch } from '@tabler/icons-react'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { downloadModel } from '@/services/models'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { Progress } from '@/components/ui/progress'

type ModelProps = {
  model: {
    id: string
    models: {
      id: string
    }[]
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.hub as any)({
  component: Hub,
})

const sortOptions = [
  { value: 'newest', name: 'Newest' },
  { value: 'most-downloaded', name: 'Most downloaded' },
]

function Hub() {
  const { sources, fetchSources, loading } = useModelSources()
  const [searchValue, setSearchValue] = useState('')
  const [sortSelected, setSortSelected] = useState('newest')
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>(
    {}
  )

  const toggleModelExpansion = (modelId: string) => {
    setExpandedModels((prev) => ({
      ...prev,
      [modelId]: !prev[modelId],
    }))
  }

  // Sorting functionality
  const sortedModels = useMemo(() => {
    return [...sources].sort((a, b) => {
      if (sortSelected === 'most-downloaded') {
        return (b.metadata?.downloads || 0) - (a.metadata?.downloads || 0)
      } else {
        return (
          new Date(b.metadata?.createdAt || 0).getTime() -
          new Date(a.metadata?.createdAt || 0).getTime()
        )
      }
    })
  }, [sortSelected, sources])

  // Filtered models
  const filteredModels = useMemo(() => {
    // Apply additional filters here if needed
    return searchValue.length
      ? sortedModels?.filter((e) =>
          fuzzySearch(
            searchValue.replace(/\s+/g, '').toLowerCase(),
            e.id.toLowerCase()
          )
        )
      : sortedModels
  }, [searchValue, sortedModels])

  useEffect(() => {
    fetchSources()
  }, [fetchSources])

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value)
  }

  const { downloads } = useDownloadStore()

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

  const { getProviderByName } = useModelProvider()
  const llamaProvider = getProviderByName('llama.cpp')

  const navigate = useNavigate()

  const handleUseModel = useCallback(
    (modelId: string) => {
      navigate({
        to: route.home,
        params: {},
        search: {
          model: {
            id: modelId,
            provider: 'llama.cpp',
          },
        },
      })
    },
    [navigate]
  )

  const DownloadButtonPlaceholder = useMemo(() => {
    return ({ model }: ModelProps) => {
      const modelId = model.models[0]?.id
      const isDownloading = downloadProcesses.some((e) => e.id === modelId)
      const downloadProgress =
        downloadProcesses.find((e) => e.id === modelId)?.progress || 0
      const isDownloaded = llamaProvider?.models.some(
        (m: { id: string }) => m.id === modelId
      )

      return (
        <>
          {isDownloading ? (
            <div className="flex items-center gap-2 w-20">
              <Progress value={downloadProgress * 100} />
              <span className="text-xs text-center text-main-view-fg/70">
                {Math.round(downloadProgress * 100)}%
              </span>
            </div>
          ) : isDownloaded ? (
            <Button size="sm" onClick={() => handleUseModel(modelId)}>
              Use
            </Button>
          ) : (
            <Button size="sm" onClick={() => downloadModel(modelId)}>
              Download
            </Button>
          )}
        </>
      )
    }
  }, [downloadProcesses, llamaProvider?.models, handleUseModel])

  return (
    <div className="flex h-full w-full">
      <div className="flex flex-col h-full w-full">
        <div className="px-4 py-3 border-b border-main-view-fg/5 h-10 flex items-center justify-between relative z-20">
          <div className="flex items-center gap-2">
            <IconSearch className="text-main-view-fg/60" size={14} />
            <input
              placeholder="Search models..."
              value={searchValue}
              onChange={handleSearchChange}
              className="w-full focus:outline-none"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger>
              <span
                title="Edit Theme"
                className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none text-main-view-fg font-medium"
              >
                {
                  sortOptions.find((option) => option.value === sortSelected)
                    ?.name
                }
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              {sortOptions.map((option) => (
                <DropdownMenuItem
                  className={cn(
                    'cursor-pointer my-0.5',
                    sortSelected === option.value && 'bg-main-view-fg/5'
                  )}
                  key={option.value}
                  onClick={() => setSortSelected(option.value)}
                >
                  {option.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col h-full justify-between gap-4 gap-y-3 w-4/5 mx-auto">
            {loading ? (
              <div className="flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  Loading models...
                </div>
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  No models found
                </div>
              </div>
            ) : (
              <div className="flex flex-col pb-2 mb-2 gap-2">
                {filteredModels.map((model) => (
                  <div key={model.id}>
                    <Card
                      header={
                        <div className="flex items-center justify-between gap-x-2">
                          <Link
                            to={`https://huggingface.co/${model.id}` as string}
                            target="_blank"
                          >
                            <h1 className="text-main-view-fg font-medium text-base capitalize truncate">
                              {extractModelName(model.id) || ''}
                            </h1>
                          </Link>
                          <div className="shrink-0 space-x-3 flex items-center">
                            <span className="text-main-view-fg/70 font-medium text-xs">
                              {toGigabytes(model.models?.[0]?.size)}
                            </span>
                            <DownloadButtonPlaceholder model={model} />
                          </div>
                        </div>
                      }
                    >
                      <div className="line-clamp-2 mt-3 text-main-view-fg/60">
                        <RenderMarkdown
                          components={{
                            a: ({ ...props }) => (
                              <a
                                {...props}
                                target="_blank"
                                rel="noopener noreferrer"
                              />
                            ),
                          }}
                          content={
                            extractDescription(model.metadata.description) || ''
                          }
                        />
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="capitalize text-main-view-fg/80">
                          By {model?.author}
                        </span>
                        <div className="flex items-center gap-4 ml-2">
                          <div className="flex items-center gap-1">
                            <IconDownload
                              size={18}
                              className="text-main-view-fg/50"
                              title="Downloads"
                            />
                            <span className="text-main-view-fg/80">
                              {model.metadata?.downloads || 0}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <IconFileCode
                              size={20}
                              className="text-main-view-fg/50"
                              title="Variants"
                            />
                            <span className="text-main-view-fg/80">
                              {model.models?.length || 0}
                            </span>
                          </div>
                          {model.models.length > 1 && (
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={!!expandedModels[model.id]}
                                onCheckedChange={() =>
                                  toggleModelExpansion(model.id)
                                }
                              />
                              <p className="text-main-view-fg/70">
                                Show variants
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      {expandedModels[model.id] && model.models.length > 0 && (
                        <div className="mt-5">
                          {model.models.slice(1).map((variant) => (
                            <CardItem
                              key={variant.id}
                              title={variant.id}
                              actions={
                                <div className="flex items-center gap-2">
                                  {/* {defaultVariant && <>test</>} */}
                                  <p className="text-main-view-fg/70 font-medium text-xs">
                                    {toGigabytes(variant.size)}
                                  </p>
                                  {(() => {
                                    const isDownloading =
                                      downloadProcesses.some(
                                        (e) => e.id === variant.id
                                      )
                                    const downloadProgress =
                                      downloadProcesses.find(
                                        (e) => e.id === variant.id
                                      )?.progress || 0
                                    const isDownloaded =
                                      llamaProvider?.models.some(
                                        (m: { id: string }) =>
                                          m.id === variant.id
                                      )

                                    if (isDownloading) {
                                      return (
                                        <>
                                          <div className="flex items-center gap-2 w-20">
                                            <Progress
                                              value={downloadProgress * 100}
                                            />
                                            <span className="text-xs text-center text-main-view-fg/70">
                                              {Math.round(
                                                downloadProgress * 100
                                              )}
                                              %
                                            </span>
                                          </div>
                                        </>
                                      )
                                    }

                                    if (isDownloaded) {
                                      return (
                                        <div
                                          className="flex items-center justify-center rounded bg-main-view-fg/10"
                                          title="Use this model"
                                        >
                                          <Button
                                            variant="link"
                                            size="sm"
                                            onClick={() =>
                                              handleUseModel(variant.id)
                                            }
                                          >
                                            Use
                                          </Button>
                                        </div>
                                      )
                                    }

                                    return (
                                      <div
                                        className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                                        title="Download model"
                                        onClick={() =>
                                          downloadModel(variant.id)
                                        }
                                      >
                                        <IconDownload
                                          size={16}
                                          className="text-main-view-fg/80"
                                        />
                                      </div>
                                    )
                                  })()}
                                </div>
                              }
                            />
                          ))}
                        </div>
                      )}
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
