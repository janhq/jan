/**
 * 三源下载分发:
 * - HF 官方:原 Rust 下载器(不动)
 * - HF 镜像:URL 前缀化后走原下载器
 * - 魔搭:直连 URL 走原下载器(2026-08-25 起不再使用 ms CLI),附官方 sha256/size 校验
 */
import { getServiceHub } from '@/hooks/useServiceHub'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { getMirrorBase } from '@/lib/searchSources'
import type { LiveCatalogModel } from '@/lib/liveHub'
import type { CatalogModel, ModelQuant } from '@/services/models/types'

/** 判断是否为用户取消/暂停类错误(不应当作下载失败提示) */
export function isCancellationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /cancel|cancelled|abort/i.test(msg)
}

/** 是否为魔搭直连 URL(恢复下载时据此决定是否附带 sha256 校验) */
export function isModelscopeUrl(url: string): boolean {
  return url.includes('/api/v1/models/')
}

/** HF 官方 URL → 镜像域名(仅 hf-mirror 源使用) */
export function rewriteHfUrlToMirror(url: string): string {
  if (url.startsWith('https://huggingface.co/')) {
    return `${getMirrorBase()}${url.slice('https://huggingface.co'.length)}`
  }
  return url
}

/**
 * 三源统一下载入口(卡片/详情页共用)。
 * 抛错时调用方负责提示;经下载器失败的场景由扩展的 onFileDownloadError 统一兜底。
 */
export async function startModelDownload(opts: {
  model: CatalogModel
  variant: ModelQuant
  mmprojVariant?: ModelQuant | null
  huggingfaceToken?: string
}): Promise<void> {
  const { model, variant, mmprojVariant, huggingfaceToken } = opts
  const source = (model as Partial<LiveCatalogModel>).source
  const id = variant.model_id
  const store = useDownloadStore.getState()

  store.addLocalDownloadingModel(id)
  store.setResumeParams(id, {
    modelPath: variant.path,
    mmprojPath: mmprojVariant?.path,
    hfToken: huggingfaceToken,
  })

  try {
    // HF 镜像:URL 前缀化;HF 官方 / 魔搭直连:原样走下载器
    const modelPath =
      source === 'hf-mirror' ? rewriteHfUrlToMirror(variant.path) : variant.path
    const mmprojPath =
      source === 'hf-mirror' && mmprojVariant
        ? rewriteHfUrlToMirror(mmprojVariant.path)
        : mmprojVariant?.path

    // 魔搭:直连 + 官方 sha256/size 校验(元数据获取失败时下载器侧跳过校验);
    // HF 官方/镜像保持原有行为
    await getServiceHub()
      .models()
      .pullModelWithMetadata(
        id,
        modelPath,
        mmprojPath,
        huggingfaceToken,
        source !== 'modelscope'
      )
  } catch (err) {
    // 暂停(底层也是取消)时保留"下载中"标记,让下载管理弹窗保持可恢复状态;
    // 真正的取消/失败才清除
    const paused = useDownloadStore.getState().downloads[id]?.paused
    if (!paused) store.removeLocalDownloadingModel(id)
    throw err
  }
}
