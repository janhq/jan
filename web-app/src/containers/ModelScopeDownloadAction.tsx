import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useTranslation } from '@/i18n'
import { startModelDownload, isCancellationError } from '@/lib/modelDownloads'
import { selectDefaultQuant } from '@/lib/models'
import { sanitizeModelId } from '@/lib/utils'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import type { LiveCatalogModel } from '@/lib/liveHub'
import type { ModelQuant } from '@/services/models/types'
import { IconDownload } from '@tabler/icons-react'
import { Loader } from 'lucide-react'
import { useCallback } from 'react'
import { toast } from 'sonner'

/**
 * 魔搭模型下载按钮(卡片 + 展开变体)。
 * 下载走 ms CLI,CLI 缺失自动回退直连 URL;进度/已下载判断与 HF 组件一致。
 */
function useModelScopeDownloadState(modelId: string, developer?: string) {
  const { downloads, localDownloadingModels } = useDownloadStore()
  const llamaProvider = useModelProvider((state) =>
    state.getProviderByName('llamacpp')
  )

  const isDownloading =
    localDownloadingModels.has(modelId) || downloads[modelId] != null
  const progress = downloads[modelId]?.progress ?? 0
  const isDownloaded = llamaProvider?.models.some(
    (m: { id: string }) =>
      m.id === modelId || m.id === `${developer}/${sanitizeModelId(modelId)}`
  )

  return { isDownloading, isDownloaded, progress }
}

/** 卡片主下载按钮(默认量化) */
export function ModelScopeCardDownloadAction({
  model,
  handleUseModel,
}: {
  model: LiveCatalogModel
  handleUseModel: (modelId: string) => void
}) {
  const { t } = useTranslation()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const quant = selectDefaultQuant(model.quants, DEFAULT_MODEL_QUANTIZATIONS)
  const modelId = quant?.model_id || model.model_name
  const { isDownloading, isDownloaded, progress } = useModelScopeDownloadState(
    modelId,
    model.developer
  )

  const handleDownload = useCallback(() => {
    if (!quant) return
    startModelDownload({ model, variant: quant, huggingfaceToken }).catch(
      (err) => {
        // 用户取消/暂停不当作失败提示
        if (isCancellationError(err)) return
        toast.error(t('hub:downloadFailed'), {
          description: err instanceof Error ? err.message : String(err),
        })
      }
    )
  }, [model, quant, huggingfaceToken, t])

  // 量化列表尚未加载(实时搜索结果懒加载)
  if (!quant) {
    // 已加载但仓库无 GGUF 量化文件 → 引导去源网页查看
    if (model.quants && model.quants.length === 0) {
      return (
        <a
          href={`https://modelscope.cn/models/${model.repoId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button size="sm">{t('hub:viewOnModelScope')}</Button>
        </a>
      )
    }
    return <Loader className="size-4 animate-spin text-muted-foreground" />
  }

  if (isDownloading) {
    return <Progress className="border w-16" value={progress * 100} />
  }

  if (isDownloaded) {
    return (
      <Button
        variant="default"
        size="sm"
        onClick={() => handleUseModel(modelId)}
        title={t('hub:useModel')}
      >
        {t('hub:newChat')}
      </Button>
    )
  }

  return (
    <div
      className="size-6 cursor-pointer flex items-center justify-center rounded transition-all duration-200 ease-in-out"
      title={t('hub:downloadModel')}
      onClick={handleDownload}
    >
      <IconDownload size={16} className="text-muted-foreground" />
    </div>
  )
}

/** 展开的量化变体下载按钮 */
export function ModelScopeVariantDownloadAction({
  model,
  variant,
  handleUseModel,
}: {
  model: LiveCatalogModel
  variant: ModelQuant
  handleUseModel: (modelId: string) => void
}) {
  const { t } = useTranslation()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const { isDownloading, isDownloaded, progress } = useModelScopeDownloadState(
    variant.model_id,
    model.developer
  )

  const handleDownload = useCallback(() => {
    const mmprojVariant =
      model.mmproj_models?.find(
        (e) => e.model_id.toLowerCase() === 'mmproj-f16'
      ) || model.mmproj_models?.[0]
    startModelDownload({
      model,
      variant,
      mmprojVariant,
      huggingfaceToken,
    }).catch((err) => {
      // 用户取消/暂停不当作失败提示
      if (isCancellationError(err)) return
      toast.error(t('hub:downloadFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    })
  }, [model, variant, huggingfaceToken, t])

  if (isDownloading) {
    return (
      <div className="flex items-center gap-2 w-20">
        <Progress className="border" value={progress * 100} />
        <span className="text-xs text-center text-muted-foreground">
          {Math.round(progress * 100)}%
        </span>
      </div>
    )
  }

  if (isDownloaded) {
    return (
      <Button
        variant="default"
        size="sm"
        onClick={() => handleUseModel(variant.model_id)}
        title={t('hub:useModel')}
      >
        {t('hub:newChat')}
      </Button>
    )
  }

  return (
    <div
      className="size-6 cursor-pointer flex items-center justify-center rounded transition-all duration-200 ease-in-out"
      title={t('hub:downloadModel')}
      onClick={handleDownload}
    >
      <IconDownload size={16} className="text-muted-foreground" />
    </div>
  )
}
