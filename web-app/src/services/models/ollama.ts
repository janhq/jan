import { sanitizeModelId } from '@/lib/utils'
import type { CatalogModel, ModelQuant } from './types'
import { platformFetch } from './http'

const OLLAMA_SEARCH_URL = 'https://ollama.com/search'
const OLLAMA_LIBRARY_URL = 'https://ollama.com/library'
const OLLAMA_REGISTRY_URL = 'https://registry.ollama.ai/v2'

export const OLLAMA_URL_PREFIX = 'ollama://'

interface OllamaManifestLayer {
  mediaType: string
  digest: string
  size: number
}

interface OllamaManifest {
  layers?: OllamaManifestLayer[]
}

export interface ResolvedOllamaBlob {
  modelPath: string
  modelSha256: string
  modelSize: number
  mmprojPath?: string
  mmprojSha256?: string
  mmprojSize?: number
}

function parseCompactCount(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim().toUpperCase()
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*([KMB])?/)
  if (!match) return 0
  const num = parseFloat(match[1])
  switch (match[2]) {
    case 'K':
      return Math.round(num * 1_000)
    case 'M':
      return Math.round(num * 1_000_000)
    case 'B':
      return Math.round(num * 1_000_000_000)
    default:
      return Math.round(num)
  }
}

export function buildOllamaQuantId(slug: string, tag: string): string {
  return sanitizeModelId(`ollama/${slug}-${tag}`)
}

export function buildOllamaQuantPath(slug: string, tag: string): string {
  const namespacePath = slug.includes('/') ? slug : `library/${slug}`
  return `${OLLAMA_URL_PREFIX}${namespacePath}:${tag}`
}

/**
 * Parse the HTML returned by https://ollama.com/search into CatalogModel entries.
 */
export function parseOllamaSearchHtml(html: string): CatalogModel[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const links = Array.from(doc.querySelectorAll('li > a[href^="/library/"]'))
  const models: CatalogModel[] = []
  const seen = new Set<string>()

  for (const link of links) {
    const href = link.getAttribute('href') ?? ''
    const slug = href.replace(/^\/library\//, '').split(/[/?#]/)[0]?.trim()
    if (!slug || seen.has(slug)) continue
    seen.add(slug)

    const titleEl = link.querySelector('h2')
    const title =
      titleEl?.getAttribute('title')?.trim() ||
      titleEl?.textContent?.trim() ||
      slug

    const description =
      link.querySelector('p')?.textContent?.trim() || ''

    const badges = Array.from(link.querySelectorAll('span')).map((el) =>
      (el.textContent ?? '').trim().toLowerCase()
    )
    const hasTools = badges.includes('tools')
    const hasVision = badges.includes('vision')
    const hasCloud = badges.includes('cloud')

    // Size tags in Ollama cards are rendered in light-blue badges (e.g. "1b", "3b", "8b", "e4b")
    const sizeTags = Array.from(
      link.querySelectorAll('span.bg-\\[\\#ddf4ff\\], span[class*="text-blue-"]')
    )
      .map((el) => (el.textContent ?? '').trim())
      .filter((t) => /^\S+$/.test(t) && t.length <= 16)

    // Skip cloud-only models that have no downloadable local weights
    if (hasCloud && sizeTags.length === 0) continue

    let downloads = 0
    const dlSpan = link.querySelector('span[title*="download"]')
    if (dlSpan) {
      const titleAttr = dlSpan.getAttribute('title') ?? ''
      downloads = parseCompactCount(titleAttr)
    }
    if (!downloads) {
      const textMatch = link.textContent?.match(/(\d+(?:\.\d+)?[KMB])\s*Pulls/i)
      if (textMatch) downloads = parseCompactCount(textMatch[1])
    }

    let createdAt: string | undefined
    const updatedSpan = link.querySelector('span[title^="Updated "]')
    if (updatedSpan) {
      const dateStr = updatedSpan
        .getAttribute('title')
        ?.replace(/^Updated\s+/i, '')
        .trim()
      if (dateStr) {
        const parsed = Date.parse(dateStr)
        if (!Number.isNaN(parsed)) {
          createdAt = new Date(parsed).toISOString()
        }
      }
    }

    const initialTags = sizeTags.length > 0 ? sizeTags : ['latest']
    const quants: ModelQuant[] = initialTags.map((tag) => ({
      model_id: buildOllamaQuantId(slug, tag),
      path: buildOllamaQuantPath(slug, tag),
      file_size: '',
    }))

    models.push({
      model_name: `ollama/${slug}`,
      display_name: title,
      developer: 'ollama',
      description,
      downloads,
      created_at: createdAt,
      num_quants: quants.length,
      quants,
      num_mmproj: hasVision ? 1 : 0,
      tools: hasTools,
      readme: `${OLLAMA_LIBRARY_URL}/${slug}`,
      source: 'ollama',
    })
  }

  return models
}

/**
 * Parse the HTML returned by https://ollama.com/library/<slug>/tags into ModelQuant entries.
 */
export function parseOllamaTagsHtml(html: string, slug: string): ModelQuant[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tagLinks = Array.from(
    doc.querySelectorAll(`a[href^="/library/${slug}:"]`)
  )
  const quants: ModelQuant[] = []
  const seen = new Set<string>()

  for (const link of tagLinks) {
    const href = link.getAttribute('href') ?? ''
    const colonIdx = href.indexOf(':')
    if (colonIdx === -1) continue
    const tag = href.slice(colonIdx + 1).split(/[/?#]/)[0]?.trim()
    if (!tag || seen.has(tag) || tag === 'cloud' || tag.endsWith('-cloud')) {
      continue
    }
    seen.add(tag)

    // Walk up a couple of levels to find the row containing size (e.g. "1.3GB", "637MB")
    const containerText =
      link.closest('div.grid, div.flex, section, li')?.textContent ||
      link.parentElement?.parentElement?.textContent ||
      link.textContent ||
      ''
    const sizeMatch = containerText.match(/(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB)/i)
    const fileSize = sizeMatch
      ? `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}`
      : ''

    quants.push({
      model_id: buildOllamaQuantId(slug, tag),
      path: buildOllamaQuantPath(slug, tag),
      file_size: fileSize,
    })
  }

  return quants
}

const ollamaTagsCache = new Map<string, ModelQuant[]>()

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const current = nextIndex++
        results[current] = await worker(items[current])
      }
    }
  )
  await Promise.all(runners)
  return results
}

export async function fetchOllamaModels(query?: string): Promise<CatalogModel[]> {
  const trimmed = query?.trim()
  const url = trimmed
    ? `${OLLAMA_SEARCH_URL}?q=${encodeURIComponent(trimmed)}`
    : `${OLLAMA_SEARCH_URL}?o=popular`
  const response = await platformFetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Ollama catalog: ${response.status} ${response.statusText}`
    )
  }
  const html = await response.text()
  const parsed = parseOllamaSearchHtml(html).slice(0, 20)

  // Enrich with real tag sizes from /library/<slug>/tags so device Fit works
  await mapWithConcurrency(parsed, 6, async (model) => {
    const slug = model.model_name.replace(/^ollama\//, '')
    try {
      const tags = await fetchOllamaModelTags(slug)
      if (tags.length > 0) {
        model.quants = tags
        model.num_quants = tags.length
      }
    } catch {
      // Keep initial placeholder quants if tag fetch fails
    }
  })

  return parsed
}

export async function fetchOllamaModelTags(slug: string): Promise<ModelQuant[]> {
  const cleanSlug = slug.replace(/^ollama\//, '').trim()
  if (!cleanSlug) return []
  const cached = ollamaTagsCache.get(cleanSlug)
  if (cached) return cached

  const response = await platformFetch(`${OLLAMA_LIBRARY_URL}/${cleanSlug}/tags`)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Ollama tags for ${cleanSlug}: ${response.status} ${response.statusText}`
    )
  }
  const html = await response.text()
  const quants = parseOllamaTagsHtml(html, cleanSlug)
  if (quants.length > 0) {
    ollamaTagsCache.set(cleanSlug, quants)
  }
  return quants
}

/**
 * Resolve an `ollama://library/<model>:<tag>` URL via registry.ollama.ai's OCI
 * manifest API into direct GGUF blob download URLs with SHA256 and byte size.
 */
export async function resolveOllamaBlob(
  ollamaUrl: string
): Promise<ResolvedOllamaBlob> {
  const withoutScheme = ollamaUrl.slice(OLLAMA_URL_PREFIX.length)
  const colonIdx = withoutScheme.lastIndexOf(':')
  const repoPart =
    colonIdx !== -1 ? withoutScheme.slice(0, colonIdx) : withoutScheme
  const tag = colonIdx !== -1 ? withoutScheme.slice(colonIdx + 1) : 'latest'
  const normalizedRepo = repoPart.includes('/')
    ? repoPart
    : `library/${repoPart}`

  const manifestUrl = `${OLLAMA_REGISTRY_URL}/${normalizedRepo}/manifests/${tag}`
  const response = await platformFetch(manifestUrl, {
    headers: {
      Accept: 'application/vnd.docker.distribution.manifest.v2+json',
    },
  })
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Ollama manifest (${normalizedRepo}:${tag}): ${response.status} ${response.statusText}`
    )
  }

  const manifest = (await response.json()) as OllamaManifest
  const layers = manifest.layers ?? []
  const modelLayer = layers.find(
    (l) => l.mediaType === 'application/vnd.ollama.image.model'
  )
  if (!modelLayer?.digest) {
    throw new Error(
      `No downloadable GGUF model layer found for Ollama model ${normalizedRepo}:${tag}`
    )
  }

  const projectorLayer = layers.find(
    (l) => l.mediaType === 'application/vnd.ollama.image.projector'
  )

  return {
    modelPath: `${OLLAMA_REGISTRY_URL}/${normalizedRepo}/blobs/${modelLayer.digest}`,
    modelSha256: modelLayer.digest.replace(/^sha256:/, ''),
    modelSize: modelLayer.size,
    ...(projectorLayer?.digest
      ? {
          mmprojPath: `${OLLAMA_REGISTRY_URL}/${normalizedRepo}/blobs/${projectorLayer.digest}`,
          mmprojSha256: projectorLayer.digest.replace(/^sha256:/, ''),
          mmprojSize: projectorLayer.size,
        }
      : {}),
  }
}
