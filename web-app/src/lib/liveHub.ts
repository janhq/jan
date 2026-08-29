/**
 * 实时搜索结果的模型映射层:SearchModel → CatalogModel(卡片/详情页共用)。
 * 只承载数据转换,不做 UI。
 */
import {
  buildStructuredIntro,
  downloadUrl,
  fetchModelDetails,
  searchModels,
  sourceBase,
  type SearchModel,
  type SearchQuant,
  type SearchSource,
} from '@/lib/searchSources'
import { sanitizeModelId } from '@/lib/utils'
import i18n from '@/i18n/setup'
import type { CatalogModel } from '@/services/models/types'

/** 实时搜索结果模型:在原 CatalogModel 上附带源信息(下载/详情路由用) */
export type LiveCatalogModel = CatalogModel & {
  repoId: string
  source: SearchSource
}

export function formatModelFileSize(size?: number): string {
  if (!size || size <= 0) return 'Unknown size'
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`
  return `${(size / 1024 ** 3).toFixed(1)} GB`
}

export function searchModelToCatalogModel(
  source: SearchSource,
  m: SearchModel
): LiveCatalogModel {
  const readme =
    source === 'modelscope'
      ? `https://modelscope.cn/models/${m.repoId}/resolve/master/README.md`
      : `${sourceBase(source)}/${m.repoId}/resolve/main/README.md`
  return {
    model_name: m.repoId,
    display_name: m.modelName,
    developer: m.developer,
    description: buildStructuredIntro(source, m),
    downloads: m.downloads || 0,
    created_at: m.createdAt,
    readme,
    tools: false,
    is_mlx: false,
    repoId: m.repoId,
    source,
  }
}

/** 将懒加载到的量化列表合并进模型对象(quants 为空时表示仍在加载) */
export function applyModelDetails(
  model: LiveCatalogModel,
  quants: SearchQuant[] | null,
  mmprojFiles: string[]
): LiveCatalogModel {
  if (!quants) return model
  return {
    ...model,
    quants: quants.map((q) => ({
      model_id: sanitizeModelId(q.model_id.replace(/\.gguf$/i, '')),
      path: downloadUrl(model.source, model.repoId, q.model_id),
      file_size: formatModelFileSize(q.file_size),
    })),
    num_quants: quants.length,
    mmproj_models: mmprojFiles.map((f) => ({
      model_id: sanitizeModelId(f.replace(/\.gguf$/i, '')),
      path: downloadUrl(model.source, model.repoId, f),
      file_size: 'Unknown size',
    })),
    num_mmproj: mmprojFiles.length,
  }
}

/** 详情页数据:按源构造完整 CatalogModel(魔搭/HF 内部页共用) */
export async function buildDetailCatalogModel(
  source: SearchSource,
  repoId: string,
  base?: SearchModel
): Promise<LiveCatalogModel | null> {
  try {
    const { quants, mmprojFiles } = await fetchModelDetails(source, repoId)
    // 未传入元数据时(如从搜索卡片直达)用搜索接口兜底,补全下载量/创建时间
    let meta = base
    if (!meta) {
      try {
        const results = await searchModels(source, repoId)
        meta =
          results.find(
            (m) => m.repoId.toLowerCase() === repoId.toLowerCase()
          ) ?? results[0]
      } catch {
        // 搜索失败不阻塞详情页
      }
    }
    const model: LiveCatalogModel = {
      model_name: repoId,
      display_name: repoId.split('/').pop(),
      developer: repoId.split('/')[0],
      downloads: meta?.downloads ?? 0,
      created_at: meta?.createdAt,
      description: meta ? buildStructuredIntro(source, meta) : '',
      readme:
        source === 'modelscope'
          ? `https://modelscope.cn/models/${repoId}/resolve/master/README.md`
          : `${sourceBase(source)}/${repoId}/resolve/main/README.md`,
      tools: false,
      is_mlx: false,
      repoId,
      source,
    }
    return applyModelDetails(model, quants, mmprojFiles)
  } catch (e) {
    console.error('Failed to build detail model', source, repoId, e)
    return null
  }
}

/** 相对时间("today" / "3 days ago"),无效值返回空串 */
export function formatRelativeDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days < 1) return i18n.t('hub:relativeToday')
  if (days < 7) return i18n.t('hub:relativeDays', { days })
  const weeks = Math.floor(days / 7)
  if (days < 30) return i18n.t('hub:relativeWeeks', { weeks })
  const months = Math.floor(days / 30)
  if (days < 365) return i18n.t('hub:relativeMonths', { months })
  const years = Math.floor(days / 365)
  return i18n.t('hub:relativeYears', { years })
}
