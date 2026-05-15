import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { JAN_CODE_HF_REPO } from '@/constants/models'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { formatBytes } from '@/lib/utils'
import type { CatalogModel } from '@/services/models/types'

export default function JanCodeRecommendation({
  selectedModel,
  onSelect,
}: {
  selectedModel: string | null
  onSelect: (modelId: string) => void
}) {
  const serviceHub = useServiceHub()
  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore()
  const { getProviderByName } = useModelProvider()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const [janCodeCatalog, setJanCodeCatalog] = useState<CatalogModel | null>(
    null
  )

  useEffect(() => {
    serviceHub
      .models()
      .fetchHuggingFaceRepo(JAN_CODE_HF_REPO, huggingfaceToken)
      .then((repo) => {
        if (repo) {
          setJanCodeCatalog(
            serviceHub.models().convertHfRepoToCatalogModel(repo)
          )
        }
      })
      .catch(() => {})
  }, [serviceHub, huggingfaceToken])

  const defaultVariant = useMemo(() => {
    if (!janCodeCatalog) return null
    return (
      janCodeCatalog.quants?.find((quant) =>
        quant.model_id.toLowerCase().includes('q4_k_m')
      ) ??
      janCodeCatalog.quants?.[0] ??
      null
    )
  }, [janCodeCatalog])

  const llamaProvider = getProviderByName('llamacpp')

  const isDownloaded = useMemo(() => {
    if (!defaultVariant) return false
    return !!llamaProvider?.models.some(
      (model: { id: string }) => model.id === defaultVariant.model_id
    )
  }, [defaultVariant, llamaProvider])

  const isDownloading = useMemo(() => {
    if (!defaultVariant) return false
    return (
      localDownloadingModels.has(defaultVariant.model_id) ||
      defaultVariant.model_id in downloads
    )
  }, [defaultVariant, localDownloadingModels, downloads])

  const downloadProgress = useMemo(() => {
    if (!defaultVariant) return { current: 0, total: 0 }
    const download = downloads[defaultVariant.model_id]
    return { current: download?.current ?? 0, total: download?.total ?? 0 }
  }, [defaultVariant, downloads])

  const handleDownload = () => {
    if (!defaultVariant) return
    addLocalDownloadingModel(defaultVariant.model_id)
    serviceHub
      .models()
      .pullModelWithMetadata(
        defaultVariant.model_id,
        defaultVariant.path,
        undefined,
        huggingfaceToken,
        true
      )
  }

  if (selectedModel === defaultVariant?.model_id) return null

  return (
    <div className="p-2.5 rounded-lg min-h-[54px] border border-primary/20 bg-primary/5 flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-foreground">
          Use Jan-Code for a quick start
        </span>
      </div>
      <div className="shrink-0">
        {isDownloaded ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSelect(defaultVariant!.model_id)}
          >
            Apply
          </Button>
        ) : isDownloading ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <svg
              className="size-3 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>
              {formatBytes(downloadProgress.current, {
                hideUnit: true,
                minUnit: 'GB',
              })}{' '}
              /{' '}
              {formatBytes(downloadProgress.total, {
                hideUnit: true,
                minUnit: 'GB',
              })}
              GB
            </span>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownload}
            disabled={!defaultVariant}
          >
            Setup
          </Button>
        )}
      </div>
    </div>
  )
}