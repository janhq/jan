/**
 * 三源实时模型搜索服务
 * - hf: HuggingFace 官方源
 * - hf-mirror: HuggingFace 国内镜像(hf-mirror.com)
 * - modelscope: 魔搭社区
 *
 * 搜索/详情走 HTTP API,下载走各自通道(魔搭走 ms CLI,见 download-extension)
 */

import { isPlatformTauri } from '@/lib/platform/utils'

/** 跨域安全 fetch:Tauri 环境走 plugin-http(Rust 侧发起,绕过 WebView2 CORS),
 *  魔搭搜索/文件接口未返回 Access-Control-Allow-Origin,必须走此通道 */
async function crossFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    if (isPlatformTauri()) {
      try {
        const mod = await import('@tauri-apps/plugin-http')
        return (await mod.fetch(url, init)) as unknown as Response
      } catch {
        // plugin-http 在非 Tauri 运行时抛错,回退标准 fetch
      }
    }
  } catch {
    // 动态导入失败同样回退
  }
  return fetch(url, init)
}

export type SearchSource = 'hf' | 'hf-mirror' | 'modelscope'

export interface SearchQuant {
  model_id: string
  file_size: number
}

export interface SearchModel {
  repoId: string // owner/name
  modelName: string
  developer: string
  downloads: number
  likes?: number
  description?: string
  createdAt?: string
  license?: string
  /** 魔搭搜索返回的参数总量(如 27781427952),HF 无此字段 */
  params?: number | string
  /** 源端返回的 tags(HF: license:xxx;魔搭: library:/license:/task:) */
  tags?: string[]
  quants?: SearchQuant[]
  mmprojFiles?: string[]
  readme?: string
}

const HF_BASE = 'https://huggingface.co'
const DEFAULT_MIRROR_BASE = 'https://hf-mirror.com'
const MODELSCOPE_BASE = 'https://modelscope.cn'

// HF 镜像域名可在设置页修改,默认 hf-mirror.com
let mirrorBase = DEFAULT_MIRROR_BASE

export function setMirrorBase(base: string): void {
  const trimmed = (base ?? '').trim().replace(/\/+$/, '')
  mirrorBase = trimmed || DEFAULT_MIRROR_BASE
}

export function getMirrorBase(): string {
  return mirrorBase
}

const SEARCH_CACHE_TTL = 5 * 60 * 1000 // 搜索缓存 5 分钟
const DETAIL_CACHE_TTL = 24 * 60 * 60 * 1000 // 详情缓存 24 小时

const cache = new Map<string, { ts: number; data: unknown }>()

function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < ttl) return Promise.resolve(hit.data as T)
  return fn().then((data) => {
    cache.set(key, { ts: Date.now(), data })
    return data
  })
}

/** 分页搜索结果:models=当前页, total=服务端总数, page=页码(从 1 开始), hasMore=是否还有下一页 */
export interface SearchResult {
  models: SearchModel[]
  total: number
  page: number
  hasMore: boolean
}

const PAGE_SIZE = 50

async function fetchJsonWithHeaders(
  url: string,
  retries = 2
): Promise<{ data: unknown; headers: Headers }> {
  let lastErr: Error | undefined
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await crossFetch(url, { headers: { 'User-Agent': 'Jan/1.0' } })
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
      const data = await r.json()
      return { data, headers: r.headers }
    } catch (e) {
      lastErr = e as Error
    }
  }
  throw lastErr ?? new Error(`Failed to fetch ${url}`)
}

function fetchJson(url: string, retries = 2): Promise<unknown> {
  let lastErr: Error | undefined
  for (let i = 0; i <= retries; i++) {
    try {
      return crossFetch(url, { headers: { 'User-Agent': 'Jan/1.0' } }).then(
        (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
          return r.json()
        }
      )
    } catch (e) {
      lastErr = e as Error
      // 镜像/网络偶发失败时重试
    }
  }
  throw lastErr ?? new Error(`Failed to fetch ${url}`)
}

function parseRepoId(id: string): { owner: string; name: string } {
  const idx = id.indexOf('/')
  if (idx < 0) return { owner: '', name: id }
  return { owner: id.slice(0, idx), name: id.slice(idx + 1) }
}

/* ------------------------------------------------------------------ */
/* HF 官方 / HF 镜像                                                     */
/* ------------------------------------------------------------------ */

async function searchHf(
  base: string,
  query: string,
  page = 1,
  pageSize = PAGE_SIZE
): Promise<{ models: SearchModel[]; total: number }> {
  const offset = (page - 1) * pageSize
  const url = `${base}/api/models?search=${encodeURIComponent(
    query
  )}&filter=gguf&limit=${pageSize}&offset=${offset}`
  const { data, headers } = await fetchJsonWithHeaders(url)
  const list =
    (data as Array<{
      id: string
      downloads?: number
      likes?: number
      createdAt?: string
      tags?: string[]
    }>) ?? []
  const totalStr = headers.get('X-Total-Count')
  const total =
    totalStr && /^\d+$/.test(totalStr) ? parseInt(totalStr, 10) : list.length
  return {
    total,
    models: list.map((m) => {
      const { owner, name } = parseRepoId(m.id ?? '')
      return {
        repoId: m.id,
        modelName: name,
        developer: owner,
        downloads: m.downloads ?? 0,
        likes: m.likes,
        createdAt: m.createdAt,
        license: (m.tags ?? []).find((t) => t.startsWith('license:'))?.slice(8),
        tags: m.tags,
      }
    }),
  }
}

async function hfModelDetail(
  base: string,
  repoId: string
): Promise<{ quants: SearchQuant[]; mmprojFiles: string[] }> {
  const url = `${base}/api/models/${repoId}?blobs=true`
  const m = (await fetchJson(url)) as {
    siblings?: Array<{ rfilename?: string; size?: number }>
  }
  const siblings = m?.siblings ?? []
  const ggufs = siblings.filter((s) => s.rfilename?.endsWith('.gguf'))
  const quants: SearchQuant[] = []
  const mmprojFiles: string[] = []
  for (const s of ggufs) {
    const f = s.rfilename ?? ''
    // 排除校准辅助文件与子目录文件(仅保留根目录量化主文件)
    if (f.includes('/') || f.startsWith('imatrix')) continue
    if (f.toLowerCase().includes('mmproj')) {
      mmprojFiles.push(f)
      continue
    }
    quants.push({ model_id: f, file_size: s.size ?? 0 })
  }
  return { quants, mmprojFiles }
}

/* ------------------------------------------------------------------ */
/* 魔搭社区                                                              */
/* ------------------------------------------------------------------ */

async function searchModelScope(
  query: string,
  page = 1,
  pageSize = PAGE_SIZE
): Promise<{ models: SearchModel[]; total: number }> {
  const url = `${MODELSCOPE_BASE}/openapi/v1/models?search=${encodeURIComponent(
    query
  )}&page_number=${page}&page_size=${pageSize}`
  const data = (await fetchJson(url)) as {
    data?: {
      models?: Array<{
        id?: string
        downloads?: number
        likes?: number
        created_at?: string
        license?: string
        params?: number | string
        tags?: string[]
        tasks?: string[]
      }>
    }
  }
  const models = data?.data?.models ?? []
  const total =
    (data?.data as { total_count?: number })?.total_count ?? models.length
  return {
    total,
    models: models.map((m) => {
      const { owner, name } = parseRepoId(m.id ?? '')
      return {
        repoId: m.id ?? '',
        modelName: name,
        developer: owner,
        downloads: m.downloads ?? 0,
        likes: m.likes,
        createdAt: m.created_at,
        license: m.license,
        params: m.params,
        tags: [...(m.tags ?? []), ...(m.tasks ?? []).map((t) => `task:${t}`)],
      }
    }),
  }
}

async function modelScopeFiles(repoId: string): Promise<{
  quants: SearchQuant[]
  mmprojFiles: string[]
}> {
  const url = `${MODELSCOPE_BASE}/api/v1/models/${repoId}/repo/files?Revision=master&Recursive=true`
  const data = (await fetchJson(url)) as {
    Data?: { Files?: Array<{ Path?: string; Size?: number }> }
  }
  const files = data?.Data?.Files ?? []
  const quants: SearchQuant[] = []
  const mmprojFiles: string[] = []
  for (const f of files) {
    const p = f.Path ?? ''
    if (!p.endsWith('.gguf')) continue
    if (p.includes('/') || p.startsWith('imatrix')) continue
    if (p.toLowerCase().includes('mmproj')) {
      mmprojFiles.push(p)
      continue
    }
    quants.push({ model_id: p, file_size: f.Size ?? 0 })
  }
  return { quants, mmprojFiles }
}

/* ------------------------------------------------------------------ */
/* README 简介提取                                                       */
/* ------------------------------------------------------------------ */

// Emoji 范围(社交导航行/广告行常见)。
// 不含 U+FE0F(VARIATION SELECTOR-16):它属于组合性字符,放字符类内会触发
// no-misleading-character-class;基础 emoji 码位已覆盖,去掉不影响检测。
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u

export function extractReadmeIntro(readme: string): string {
  let text = readme
  // 剥离 YAML frontmatter(注意不能限制 split 次数,否则拆不出第三段)
  if (text.startsWith('---')) {
    const parts = text.split('---')
    if (parts.length >= 3) text = parts.slice(2).join('---')
  }
  text = text.replace(/<[^>]+>/g, '')
  text = text.replace(/<img[^>]*>/gi, '')
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    let l = raw.trim().replace(/\*+/g, '').trim() // 剥粗体/斜体符号
    l = l.replace(/^[*\-+]\s*/, '').replace(/^>\s*/, '')
    if (l) lines.push(l)
  }
  const skip = [
    'this repository',
    'this repo',
    'the repository',
    'the repo',
    'welcome',
    'we are excited',
  ]
  // 社交导航行(作者惯例放在 README 顶部)
  const social = ['github repo', 'twitter', 'discord', 'join our', 'follow us']
  // 镜像仓库免责声明(中文)
  const mirror = [
    '以下内容',
    '本仓库为',
    '仅供个人',
    '如有侵权',
    '仅用于方便',
    '仅个人出于',
  ]
  // YAML 元数据键(部分仓库 frontmatter 不规范,散落在正文前)
  const yamlKey = /^[a-z_][a-z0-9_]*:\s*/
  for (const l of lines) {
    if (l.startsWith('#')) continue
    if (l.length <= 30) continue
    if (EMOJI_RE.test(l)) continue // 含 emoji 的行(广告/社交导航)跳过
    if (yamlKey.test(l)) continue // 元数据行(license: / pipeline_tag: 等)
    const low = l.toLowerCase()
    if (skip.some((s) => low.startsWith(s))) continue
    if (social.some((s) => low.includes(s))) continue
    if (mirror.some((m) => low.includes(m))) continue
    return l.slice(0, 120)
  }
  // 全部行被过滤时返回空,由调用方回退结构化简介
  return ''
}

async function fetchReadme(
  source: SearchSource,
  repoId: string
): Promise<string> {
  const url =
    source === 'modelscope'
      ? `${MODELSCOPE_BASE}/models/${repoId}/resolve/master/README.md`
      : `${source === 'hf' ? HF_BASE : mirrorBase}/${repoId}/resolve/main/README.md`
  const r = await crossFetch(url, { headers: { 'User-Agent': 'Jan/1.0' } })
  if (!r.ok) return ''
  return await r.text()
}

/** 拉取原始 README 文本(详情页渲染用,不走缓存) */
export async function fetchModelReadmeRaw(
  source: SearchSource,
  repoId: string
): Promise<string> {
  return fetchReadme(source, repoId)
}

/* ------------------------------------------------------------------ */
/* 结构化简介 + README 可信检查(交接文档 §7.2)                           */
/* ------------------------------------------------------------------ */

/** 多模态相关 task 标记(魔搭 tasks 数组元素,已转成 task: 前缀 tags) */
const MULTIMODAL_TASKS = [
  'image-text-to-text',
  'visual-question-answering',
  'text-to-image',
  'image-text-to-video',
  'video-text-to-text',
  'automatic-speech-recognition',
]

/** 参数总量格式化:27781427952 → "27.8B" */
export function formatParamCount(
  params: number | string | undefined
): string | null {
  if (params === undefined || params === null || params === '') return null
  const n = typeof params === 'string' ? Number(params) : params
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return `${n}`
}

/**
 * README 简介可信检查:简介以模型名首个 token(-/空格/下划线分割的第一段)
 * 开头才算可信,如 "Qwen3-8B" → "Qwen3"、"Ornith-1.5-35B-A3B" → "Ornith"。
 * 社区转发/镜像仓库的 README 以 "See Unsloth..."、"Repackaged..." 等开头,
 * 一律判为不可信,回退结构化简介。
 */
export function isTrustworthyIntro(intro: string, modelName: string): boolean {
  const firstToken = modelName.split(/[-_\s/]/)[0]?.toLowerCase()
  if (!firstToken) return false
  const trimmed = (intro ?? '').trim().toLowerCase()
  if (!trimmed) return false
  return trimmed.startsWith(firstToken)
}

/**
 * 结构化简介(永远准确,作兜底):
 * 魔搭 params → "27.8B parameters";tags 提取 library→"GGUF"、
 * license→"Apache-2.0"、task→"Multimodal",以 " · " 连接。
 */
export function buildStructuredIntro(
  _source: SearchSource,
  model: SearchModel
): string {
  const parts: string[] = []
  const params = formatParamCount(model.params)
  if (params) parts.push(`${params} parameters`)
  const tags = model.tags ?? []
  const library = tags.find((t) => t.startsWith('library:'))?.slice(8)
  if (library) parts.push(library.toUpperCase())
  const license =
    model.license ?? tags.find((t) => t.startsWith('license:'))?.slice(8)
  if (license) parts.push(license)
  const isMultimodal = tags.some(
    (t) =>
      t.startsWith('task:') &&
      MULTIMODAL_TASKS.includes(t.slice(5).toLowerCase())
  )
  if (isMultimodal) parts.push('Multimodal')
  return parts.join(' · ')
}

/**
 * README 内图片相对路径重写为绝对地址。
 * prefix 形如 "https://huggingface.co/{repo}/resolve/main/" 或
 * "https://modelscope.cn/models/{repo}/resolve/master/"。
 * 仅重写相对路径(./assets/x.png、assets/x.png),跳过绝对 URL/协议/data/锚点/根路径。
 */
export function rewriteReadmeImages(readme: string, prefix: string): string {
  if (!readme) return readme
  // Markdown 图片
  let out = readme.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt: string, target: string) => {
      const cleaned = target.trim()
      if (/^(https?:\/\/|data:|#|\/)/i.test(cleaned)) return match
      return `![${alt}](${prefix}${cleaned.replace(/^\.\//, '')})`
    }
  )
  // HTML <img src="...">
  out = out.replace(
    /(<img[^>]*\ssrc=["'])([^"']+)(["'][^>]*>)/gi,
    (match, head: string, src: string, tail: string) => {
      const cleaned = src.trim()
      if (/^(https?:\/\/|data:|#|\/)/i.test(cleaned)) return match
      return `${head}${prefix}${cleaned.replace(/^\.\//, '')}${tail}`
    }
  )
  return out
}

/**
 * 魔搭 README 图片相对路径重写为绝对地址:
 * ![](./assets/x.png) → https://modelscope.cn/models/{id}/resolve/master/assets/x.png
 */
export function rewriteModelscopeReadme(
  readme: string,
  repoId: string
): string {
  const prefix = `${MODELSCOPE_BASE}/models/${repoId}/resolve/master/`
  return rewriteReadmeImages(readme, prefix)
}

/* ------------------------------------------------------------------ */
/* 统一入口                                                              */
/* ------------------------------------------------------------------ */

export function sourceBase(source: SearchSource): string {
  if (source === 'hf') return HF_BASE
  if (source === 'hf-mirror') return mirrorBase
  return MODELSCOPE_BASE
}

/** 分页搜索:page 从 1 开始 */
export function searchModelsPage(
  source: SearchSource,
  query: string,
  page = 1
): Promise<SearchResult> {
  const key = `search:${source}:${mirrorBase}:${query}:${page}`
  return cached(key, SEARCH_CACHE_TTL, async () => {
    const result =
      source === 'modelscope'
        ? await searchModelScope(query, page)
        : await searchHf(source === 'hf' ? HF_BASE : mirrorBase, query, page)
    return {
      models: result.models,
      total: result.total,
      page,
      hasMore: page * PAGE_SIZE < result.total,
    }
  })
}

/** 首屏搜索(兼容旧调用方):返回第一页模型列表 */
export function searchModels(
  source: SearchSource,
  query: string
): Promise<SearchModel[]> {
  return searchModelsPage(source, query, 1).then((r) => r.models)
}

export function fetchModelDetails(
  source: SearchSource,
  repoId: string
): Promise<{ quants: SearchQuant[]; mmprojFiles: string[] }> {
  const key = `detail:${source}:${repoId}`
  return cached(key, DETAIL_CACHE_TTL, () =>
    source === 'modelscope'
      ? modelScopeFiles(repoId)
      : hfModelDetail(source === 'hf' ? HF_BASE : mirrorBase, repoId)
  )
}

/**
 * 首页推荐(空搜索态,跟随当前 tab):
 * - 魔搭:无关键字返回官方推荐列表(官方置顶)
 * - HF 官方/镜像:官方 /api/trending(hf-mirror 会重定向到官方域名)
 */
export async function fetchRecommended(
  source: SearchSource
): Promise<SearchModel[]> {
  if (source === 'modelscope') return searchModelScope('').then((r) => r.models)
  const base = source === 'hf' ? HF_BASE : mirrorBase
  const url = `${base}/api/trending?limit=20`
  const data = (await fetchJson(url)) as {
    recentlyTrending?: Array<{
      repoData?: {
        id?: string
        author?: string
        downloads?: number
        likes?: number
        createdAt?: string
        tags?: string[]
      }
    }>
  }
  const items = data?.recentlyTrending ?? []
  const result: SearchModel[] = []
  for (const entry of items) {
    const r = entry.repoData
    if (!r?.id) continue
    const { owner, name } = parseRepoId(r.id)
    result.push({
      repoId: r.id,
      modelName: name,
      developer: owner || r.author || '',
      downloads: r.downloads ?? 0,
      likes: r.likes,
      createdAt: r.createdAt,
      license: (r.tags ?? []).find((t) => t.startsWith('license:'))?.slice(8),
      tags: r.tags,
    })
  }
  return result
}

export async function fetchModelDescription(
  source: SearchSource,
  repoId: string
): Promise<string> {
  const key = `readme:${source}:${repoId}`
  return cached(key, DETAIL_CACHE_TTL, async () => {
    const readme = await fetchReadme(source, repoId)
    return extractReadmeIntro(readme)
  })
}

/** 魔搭单文件元数据(官方 sha256/size),供直连下载校验;24h 缓存 */
export function fetchModelscopeFileMeta(
  repoId: string,
  fileName: string
): Promise<{ sha256?: string; size?: number } | null> {
  const key = `filemeta:${repoId}:${fileName}`
  return cached(key, DETAIL_CACHE_TTL, async () => {
    const url = `${MODELSCOPE_BASE}/api/v1/models/${repoId}/repo/files?Revision=master&Recursive=true`
    const data = (await fetchJson(url)) as {
      Data?: {
        Files?: Array<{
          Name?: string
          Path?: string
          Sha256?: string
          Size?: number
        }>
      }
    }
    const file = (data?.Data?.Files ?? []).find(
      (f) => f.Name === fileName || f.Path === fileName
    )
    if (!file) return null
    return { sha256: file.Sha256, size: file.Size }
  })
}

/** 下载地址(供 Rust 下载器使用) */
export function downloadUrl(
  source: SearchSource,
  repoId: string,
  fileName: string
): string {
  if (source === 'modelscope') {
    return `${MODELSCOPE_BASE}/api/v1/models/${repoId}/repo?Revision=master&FilePath=${encodeURIComponent(
      fileName
    )}`
  }
  const base = source === 'hf' ? HF_BASE : mirrorBase
  return `${base}/${repoId}/resolve/main/${encodeURIComponent(fileName)}`
}
