/**
 * 模型简介本地存储:localStorage 表,30 天 TTL,重启不丢。
 * 简介三层:结构化元数据(兜底,永远准确)→ README 提取 + 可信检查(通过才用)→ AI 生成(不做)。
 */
import { useCallback, useEffect, useState } from 'react'
import { localStorageKey } from '@/constants/localStorage'
import {
  extractReadmeIntro,
  fetchModelReadmeRaw,
  isTrustworthyIntro,
  type SearchSource,
} from '@/lib/searchSources'

const INTRO_TTL = 30 * 24 * 60 * 60 * 1000 // 30 天

type IntroEntry = { intro: string; ts: number }
type IntroTable = Record<string, IntroEntry>

function loadTable(): IntroTable {
  try {
    const raw = localStorage.getItem(localStorageKey.modelIntros)
    return raw ? (JSON.parse(raw) as IntroTable) : {}
  } catch {
    return {}
  }
}

function saveTable(table: IntroTable): void {
  try {
    localStorage.setItem(localStorageKey.modelIntros, JSON.stringify(table))
  } catch {
    // localStorage 满时静默失败,不影响功能
  }
}

function tableKey(source: SearchSource, repoId: string): string {
  return `${source}:${repoId}`
}

export function getCachedIntro(
  source: SearchSource,
  repoId: string
): string | undefined {
  const entry = loadTable()[tableKey(source, repoId)]
  if (!entry) return undefined
  if (Date.now() - entry.ts > INTRO_TTL) return undefined
  return entry.intro
}

export function clearCachedIntro(source: SearchSource, repoId: string): void {
  const table = loadTable()
  delete table[tableKey(source, repoId)]
  saveTable(table)
}

/** 清空全部简介缓存,返回清除条数 */
export function clearAllIntros(): number {
  const table = loadTable()
  const count = Object.keys(table).length
  saveTable({})
  return count
}

export function countCachedIntros(): number {
  return Object.keys(loadTable()).length
}

/**
 * 拉取 README 简介并缓存。通过可信检查才采用,否则返回 null(前端回退结构化简介)。
 */
export async function fetchAndCacheIntro(
  source: SearchSource,
  repoId: string,
  modelName: string
): Promise<string | null> {
  try {
    const readme = await fetchModelReadmeRaw(source, repoId)
    const intro = extractReadmeIntro(readme)
    if (!intro || !isTrustworthyIntro(intro, modelName)) return null
    const table = loadTable()
    table[tableKey(source, repoId)] = { intro, ts: Date.now() }
    saveTable(table)
    return intro
  } catch (e) {
    console.warn('Failed to fetch intro:', source, repoId, e)
    return null
  }
}

/**
 * 卡片简介 hook:有缓存零请求秒回;无缓存异步拉取(失败/不可信回退结构化简介)。
 * 返回 { intro: 实际展示文本, loading, refresh: 强制刷新 }
 */
export function useModelIntro(
  source: SearchSource | undefined,
  repoId: string | undefined,
  modelName: string | undefined,
  fallback: string
): { intro: string; loading: boolean; refresh: () => void } {
  const [intro, setIntro] = useState<string>(() =>
    source && repoId ? (getCachedIntro(source, repoId) ?? '') : ''
  )
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!source || !repoId || !modelName) return
    let cancelled = false
    const cached = getCachedIntro(source, repoId)
    if (cached) {
      setIntro(cached)
      return
    }
    setLoading(true)
    fetchAndCacheIntro(source, repoId, modelName)
      .then((i) => {
        if (cancelled) return
        setIntro(i ?? '')
      })
      .catch(() => {
        if (!cancelled) setIntro('')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [source, repoId, modelName])

  const refresh = useCallback(() => {
    if (!source || !repoId || !modelName) return
    clearCachedIntro(source, repoId)
    setIntro('')
    setLoading(true)
    fetchAndCacheIntro(source, repoId, modelName)
      .then((i) => setIntro(i ?? ''))
      .catch(() => setIntro(''))
      .finally(() => setLoading(false))
  }, [source, repoId, modelName])

  return { intro: intro || fallback, loading, refresh }
}
