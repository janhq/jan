/* eslint-disable @typescript-eslint/no-explicit-any */
import { useVirtualizer } from '@tanstack/react-virtual'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelSources } from '@/hooks/useModelSources'
import { cn, sanitizeModelId } from '@/lib/utils'
import {
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  ChangeEvent,
  useCallback,
  useRef,
  useTransition,
} from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { extractModelName } from '@/lib/models'
import { useResolvedRecommendedModels } from '@/hooks/useResolvedRecommendedModels'
import { IconSearch } from '@tabler/icons-react'
import { Switch } from '@/components/ui/switch'
import { RecommendedModelChip } from '@/components/RecommendedModelChip'
import { chipVariantForRecommendedDescriptionKey } from '@/constants/recommendedModelChip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel } from '@/services/models/types'
import HeaderPage from '@/containers/HeaderPage'
import { ChevronsUpDown, Loader } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelCatalogStore } from '@/stores/model-catalog-store'
import { getModelSearchService } from '@/services/model-search'
import { useShallow } from 'zustand/shallow'
import { switchToModel } from '@/utils/switchModel'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { Button } from '@/components/ui/button'
import { HubModelCard } from '@/containers/HubModelCard'

type SearchParams = {
  repo: string
  engine?: 'mlx' | 'gguf'
}

function pickDefaultQuant(model: CatalogModel) {
  return (
    model.quants?.find((m) =>
      DEFAULT_MODEL_QUANTIZATIONS.some((e) =>
        m.model_id.toLowerCase().includes(e)
      )
    ) ?? model.quants?.[0]
  )
}

function isJanCatalogModel(model: CatalogModel) {
  const normalizedName = model.model_name.toLowerCase()
  const normalizedDeveloper = model.developer?.toLowerCase() ?? ''
  const normalizedRepoName =
    extractModelName(model.model_name)?.toLowerCase() ?? ''

  return (
    normalizedDeveloper.includes('janhq') ||
    normalizedName.includes('/jan') ||
    normalizedName.includes('jan-') ||
    normalizedRepoName.startsWith('jan')
  )
}

export const Route = createFileRoute(route.hub.index as any)({
  component: HubContent,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
    engine:
      search.engine === 'mlx' || search.engine === 'gguf'
        ? search.engine
        : undefined,
  }),
})

function HubContent() {
  const [isPending, startTransition] = useTransition()
  const parentRef = useRef(null)
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const serviceHub = useServiceHub()
  const { engine: engineSearchParam } = Route.useSearch()

  const { t } = useTranslation()

  const sortOptions = [
    { value: 'newest', name: t('hub:sortNewest') },
    { value: 'most-downloaded', name: t('hub:sortMostDownloaded') },
    ...(IS_MACOS
      ? [
          { value: 'mlx', name: 'MLX' },
          { value: 'gguf', name: 'GGUF' },
        ]
      : []),
  ]
  // Subscribe to the model-catalog store so the search service rebuilds
  // its index whenever a fresh catalog (or pre-built MiniSearch snapshot)
  // arrives. The store exposes the platform-neutral list; useModelSources
  // (below) handles MLX/platform filtering before rendering.
  const catalogSnapshot = useModelCatalogStore((s) => s.catalog)
  const catalogIndexPayload = useModelCatalogStore((s) => s.index)

  const searchService = useMemo(() => {
    const svc = getModelSearchService()
    svc.setCatalog(catalogSnapshot)
    if (!svc.loadSnapshot(catalogIndexPayload)) {
      svc.rebuild()
    }
    return svc
  }, [catalogSnapshot, catalogIndexPayload])

  const { sources, fetchSources, loading } = useModelSources(
    useShallow((state) => ({
      sources: state.sources,
      fetchSources: state.fetchSources,
      loading: state.loading,
    }))
  )

  const [searchValue, setSearchValue] = useState('')
  const [sortSelected, setSortSelected] = useState(
    engineSearchParam === 'mlx' || engineSearchParam === 'gguf'
      ? engineSearchParam
      : 'newest'
  )
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>(
    {}
  )
  const [isSearching, setIsSearching] = useState(false)
  const [showOnlyDownloaded, setShowOnlyDownloaded] = useState(false)
  const [huggingFaceRepo, setHuggingFaceRepo] = useState<CatalogModel | null>(
    null
  )
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const addModelSourceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const [enrichedOrphans, setEnrichedOrphans] = useState<
    Record<string, CatalogModel>
  >({})
  const enrichedOrphansFetchedRef = useRef<Set<string>>(new Set())
  const providers = useModelProvider((state) => state.providers)

  const toggleModelExpansion = useCallback((modelId: string) => {
    setExpandedModels((prev) => ({
      ...prev,
      [modelId]: !prev[modelId],
    }))
  }, [])

  // Sorting functionality
  const sortedModels = useMemo(() => {
    let sorted = [...sources]

    // Apply MLX/GGUF filter first (only on Mac)
    if (sortSelected === 'mlx') {
      sorted = sorted.filter((m) => m.is_mlx)
    } else if (sortSelected === 'gguf') {
      sorted = sorted.filter((m) => !m.is_mlx)
    }

    // Apply sorting
    if (sortSelected === 'most-downloaded') {
      return sorted.sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
    }
    return sorted.sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime()
    )
  }, [sortSelected, sources])

  // Filtered models (debounced search). MiniSearch resolves a query against
  // ~3k models in single-digit ms, so the historical 300ms debounce only
  // bought a visible window during which the previous query's results were
  // still on screen — perceived as a flicker on fast typing. 80ms is enough
  // to coalesce a held key without stalling the eye. Clearing the field
  // bypasses debounce entirely so "show me everything" feels instant.
  const [debouncedSearchValue, setDebouncedSearchValue] = useState(searchValue)

  useEffect(() => {
    if (searchValue === '') {
      setDebouncedSearchValue('')
      return
    }
    const handler = setTimeout(() => {
      setDebouncedSearchValue(searchValue)
    }, 80)
    return () => clearTimeout(handler)
  }, [searchValue])

  const recommendedItems = useResolvedRecommendedModels(sources)

  const filteredModels = useMemo(() => {
    let filtered = sortedModels
    // Apply search filter via the MiniSearch-powered service. The service
    // operates on the catalog snapshot held by `model-catalog-store`, so
    // ranking is unaffected by transient sort/filter state in this
    // component. We intersect the scored hit set against `sortedModels`
    // so engine / downloaded toggles keep working.
    if (debouncedSearchValue.length) {
      const scored = searchService.search(debouncedSearchValue, { limit: 500 })
      if (scored.length > 0) {
        const allowedIds = new Set(filtered.map((m) => m.model_name))
        const ordered: CatalogModel[] = []
        const seen = new Set<string>()
        for (const hit of scored) {
          if (!allowedIds.has(hit.model_name)) continue
          if (seen.has(hit.model_name)) continue
          seen.add(hit.model_name)
          const original = filtered.find(
            (m) => m.model_name === hit.model_name
          )
          ordered.push(original ?? hit)
        }
        filtered = ordered
      } else {
        // No MiniSearch hits — fall through to an empty list rather than
        // a stale `filtered` so the UI surfaces "no results" cleanly.
        filtered = []
      }
    }
    // Apply downloaded filter
    if (showOnlyDownloaded) {
      const providerState = useModelProvider.getState()
      const llamacppModels =
        providerState.getProviderByName('llamacpp')?.models ?? []
      const mlxModels = providerState.getProviderByName('mlx')?.models ?? []

      const matchedLlamacppIds = new Set<string>()
      const matchedMlxIds = new Set<string>()

      // MlxModelDownloadAction uses its own sanitize that preserves dots,
      // unlike the utils version which replaces dots with underscores.
      const sanitizeMlxId = (id: string) =>
        id.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_./]/g, '')

      filtered = filtered
        .filter((model) => {
          if (model.is_mlx) {
            const modelName =
              model.model_name.split('/').pop() ?? model.model_name
            const mlxModelId = sanitizeMlxId(modelName)
            const match = mlxModels.find(
              (m: { id: string }) =>
                m.id === mlxModelId ||
                m.id === `${model.developer}/${mlxModelId}`
            )
            if (match) {
              matchedMlxIds.add(match.id)
              return true
            }
            return false
          }

          const hasDownloaded = model.quants?.some((variant) => {
            const llamaMatch = llamacppModels.find(
              (m: { id: string }) =>
                m.id === variant.model_id ||
                m.id ===
                  `${model.developer}/${sanitizeModelId(variant.model_id)}`
            )
            if (llamaMatch) matchedLlamacppIds.add(llamaMatch.id)

            const mlxMatch = mlxModels.find(
              (m: { id: string }) =>
                m.id === variant.model_id ||
                m.id ===
                  `${model.developer}/${sanitizeModelId(variant.model_id)}`
            )
            if (mlxMatch) matchedMlxIds.add(mlxMatch.id)

            return !!llamaMatch || !!mlxMatch
          })
          return hasDownloaded
        })
        .map((model) => {
          if (model.is_mlx) return model
          return {
            ...model,
            quants: model.quants?.filter((variant) => {
              const isLlamaCppDownloaded = llamacppModels.some(
                (m: { id: string }) =>
                  m.id === variant.model_id ||
                  m.id ===
                    `${model.developer}/${sanitizeModelId(variant.model_id)}`
              )
              const isMlxDownloaded = mlxModels.some(
                (m: { id: string }) =>
                  m.id === variant.model_id ||
                  m.id ===
                    `${model.developer}/${sanitizeModelId(variant.model_id)}`
              )
              return isLlamaCppDownloaded || isMlxDownloaded
            }),
          }
        })

      // Try to find a catalog entry matching an orphan model ID.
      const findCatalogEntry = (modelId: string) =>
        sources.find(
          (s) =>
            s.model_name === modelId ||
            s.model_name.split('/').pop() === modelId
        )

      const buildOrphanEntry = (
        modelId: string,
        isMlx: boolean
      ): CatalogModel => {
        if (enrichedOrphans[modelId]) {
          return {
            ...enrichedOrphans[modelId],
            ...(isMlx ? { is_mlx: true } : {}),
          }
        }
        const parts = modelId.split('/')
        const developer = parts.length > 1 ? parts[0] : undefined
        return {
          model_name: modelId,
          description: '',
          developer,
          downloads: 0,
          ...(isMlx
            ? { is_mlx: true }
            : {
                quants: [{ model_id: modelId, path: '', file_size: '' }],
              }),
        }
      }

      // Add locally-downloaded models not present in the catalog
      // Skip embedding models (e.g. Sentence-Transformers) as they are auxiliary
      if (sortSelected !== 'mlx') {
        const orphanLlamacpp = llamacppModels.filter(
          (m: { id: string; embedding?: boolean }) =>
            !matchedLlamacppIds.has(m.id) && !m.embedding
        )
        for (const m of orphanLlamacpp) {
          const catalogMatch = findCatalogEntry(m.id as string)
          filtered.push(catalogMatch ?? buildOrphanEntry(m.id as string, false))
        }
      }

      if (sortSelected !== 'gguf') {
        const orphanMlx = mlxModels.filter(
          (m: { id: string; embedding?: boolean }) =>
            !matchedMlxIds.has(m.id) && !m.embedding
        )
        for (const m of orphanMlx) {
          const catalogMatch = findCatalogEntry(m.id as string)
          filtered.push(
            catalogMatch
              ? { ...catalogMatch, is_mlx: true }
              : buildOrphanEntry(m.id as string, true)
          )
        }
      }
    }
    // Add HuggingFace repo at the beginning if available.
    // Respect the active engine filter so that MLX/GGUF chips don't leak through.
    if (huggingFaceRepo) {
      const matchesEngineFilter =
        sortSelected === 'mlx'
          ? huggingFaceRepo.is_mlx === true
          : sortSelected === 'gguf'
            ? huggingFaceRepo.is_mlx !== true
            : true
      const hfName = huggingFaceRepo.model_name.toLowerCase()
      const alreadyPresent = filtered.some(
        (m) => m.model_name.toLowerCase() === hfName
      )
      // Only surface the single exact-repo card at the top when the curated
      // catalog is sparse for this query. ``fetchHuggingFaceModel`` resolves
      // asynchronously (500ms debounce + network), so prepending it once it
      // lands would jump a card to the very top and shove an already-rendered
      // list of catalog hits down — perceived as a flicker on keyword search.
      // Mirrors the ``filteredModels.length >= 5`` suppression used by the
      // ``hfCandidates`` long-tail fallback below.
      if (matchesEngineFilter && !alreadyPresent && filtered.length < 5) {
        filtered = [huggingFaceRepo, ...filtered]
      }
    }
    return filtered.filter((model) => !isJanCatalogModel(model))
  }, [
    sortedModels,
    debouncedSearchValue,
    showOnlyDownloaded,
    huggingFaceRepo,
    searchService,
    sortSelected,
    sources,
    enrichedOrphans,
  ])

  // Collect orphan model IDs that need HuggingFace enrichment
  const orphanIdsToEnrich = useMemo(() => {
    if (!showOnlyDownloaded) return []
    return filteredModels
      .filter(
        (m) => !m.downloads && !m.description && !enrichedOrphans[m.model_name]
      )
      .map((m) => ({ id: m.model_name, isMlx: !!m.is_mlx }))
  }, [filteredModels, showOnlyDownloaded, enrichedOrphans])

  // Fetch HuggingFace data for orphan models
  useEffect(() => {
    if (!orphanIdsToEnrich.length) return

    for (const { id, isMlx } of orphanIdsToEnrich) {
      if (enrichedOrphansFetchedRef.current.has(id)) continue
      enrichedOrphansFetchedRef.current.add(id)

      const repoId = id.includes('/') ? id : isMlx ? `mlx-community/${id}` : id

      serviceHub
        .models()
        .fetchHuggingFaceRepo(repoId, huggingfaceToken)
        .then((repo) => {
          if (!repo) return
          const catalog = serviceHub.models().convertHfRepoToCatalogModel(repo)
          setEnrichedOrphans((prev) => ({ ...prev, [id]: catalog }))
        })
        .catch(() => {})
    }
  }, [orphanIdsToEnrich, serviceHub, huggingfaceToken])

  const showRecommendedBlock =
    debouncedSearchValue.length === 0 && !showOnlyDownloaded

  // Long-tail Hugging Face fallback (Path B).
  //
  // Trigger only when the curated catalog returns sparse hits for a
  // non-trivial query. We fan out to HF's public search endpoint, dedupe
  // against `filteredModels`, and append the result as additional
  // CatalogModel cards. They land at the tail of the virtual list so
  // curated hits always rank first.
  const [hfCandidates, setHfCandidates] = useState<CatalogModel[]>([])
  const hfCandidatesFetchedForRef = useRef<string>('')

  useEffect(() => {
    if (showOnlyDownloaded) {
      setHfCandidates([])
      hfCandidatesFetchedForRef.current = ''
      return
    }
    const query = debouncedSearchValue.trim()
    if (query.length < 3 || filteredModels.length >= 5) {
      if (filteredModels.length >= 5) setHfCandidates([])
      return
    }
    const cacheKey = query.toLowerCase()
    if (hfCandidatesFetchedForRef.current === cacheKey) return
    hfCandidatesFetchedForRef.current = cacheKey

    let cancelled = false
    serviceHub
      .models()
      .searchHuggingFaceCandidates(query, huggingfaceToken, 10)
      .then((candidates) => {
        if (cancelled) return
        const seen = new Set(filteredModels.map((m) => m.model_name))
        if (huggingFaceRepo) seen.add(huggingFaceRepo.model_name)
        setHfCandidates(
          candidates.filter((c) => !seen.has(c.model_name) && c.model_name)
        )
      })
      .catch(() => {
        if (!cancelled) setHfCandidates([])
      })
    return () => {
      cancelled = true
    }
  }, [
    debouncedSearchValue,
    filteredModels,
    showOnlyDownloaded,
    serviceHub,
    huggingfaceToken,
    huggingFaceRepo,
  ])

  //* Каталог рендерится всегда: при поиске/фильтре «скачанные» — сам по себе, иначе под блоком Recommended
  const virtualListModels = useMemo(() => {
    if (hfCandidates.length === 0) return filteredModels
    const seen = new Set(filteredModels.map((m) => m.model_name))
    const tail = hfCandidates.filter(
      (c) => c.model_name && !seen.has(c.model_name)
    )
    return tail.length > 0 ? [...filteredModels, ...tail] : filteredModels
  }, [filteredModels, hfCandidates])

  //* Стабильная и РЕАЛИСТИЧНАЯ оценка высоты строки. Реальная высота карточки
  //* ~141–175px (замерено), поэтому старые 95px давали огромную ошибку: при
  //* скролле каждая измеренная карточка резко «дорастала», getTotalSize скакал,
  //* а скролл-anchoring браузера дрался с виртуализатором — отсюда пустоты
  //* сверху и «пропадающие» карточки. Держим оценку близкой к факту и НЕ
  //* зависящей от раскрытия (раскрытие меряется measureElement по факту), чтобы
  //* не пересоздавать опции виртуализатора на каждый тоггл.
  const estimateSize = useCallback(() => 152, [])

  //* Виртуальный список лежит НЕ в начале скролл-контейнера: над ним блок
  //* Recommended + заголовок «All Models». Без scrollMargin виртуализатор
  //* считает координаты от верха контейнера, поэтому верхние карточки
  //* «исчезают» слишком рано и сверху появляется пустота. Меряем смещение
  //* контейнера списка и отдаём его как scrollMargin.
  const listRef = useRef<HTMLDivElement>(null)
  const [listScrollMargin, setListScrollMargin] = useState(0)

  //* Оставляем дефолтную компенсацию скролла react-virtual: она двигает скролл
  //* только когда РАЗМЕР МЕНЯЕТСЯ У СТРОКИ ВЫШЕ текущего оффсета (чтобы вьюпорт
  //* не «съезжал» при доизмерении карточек на скролле). Раскрытие вариантов у
  //* видимой карточки её не триггерит (start >= scrollOffset), поэтому скачка
  //* при тоггле нет — при условии точной estimateSize (см. выше).
  // The virtualizer - count is 0 (renders nothing) when there are no models
  const rowVirtualizer = useVirtualizer({
    count: virtualListModels.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 8,
    scrollMargin: listScrollMargin,
    measureElement: (el: HTMLElement) => el.getBoundingClientRect().height,
  })

  //* Меряем, насколько контейнер списка смещён от верха скролл-контейнера
  //* (высота блока Recommended + заголовка). rAF-троттлинг + порог >1px, чтобы
  //* не дёргать стейт; ResizeObserver на контенте над списком ловит изменения
  //* его высоты (подгрузка рекомендаций, аватарок, ресайз окна).
  useLayoutEffect(() => {
    const el = listRef.current
    const parent = parentRef.current as HTMLElement | null
    if (!el || !parent) return
    let raf = 0
    const measure = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const top =
          el.getBoundingClientRect().top -
          parent.getBoundingClientRect().top +
          parent.scrollTop
        setListScrollMargin((prev) => (Math.abs(prev - top) > 1 ? top : prev))
      })
    }
    measure()
    const above = parent.firstElementChild
    const ro = new ResizeObserver(measure)
    if (above) ro.observe(above)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [showRecommendedBlock, recommendedItems.length, isInitialLoad, loading])

  useEffect(() => {
    // Use startTransition to keep UI responsive during data fetch
    startTransition(() => {
      fetchSources()
    })
  }, [fetchSources])

  // Reset initial load state after data loads or on filter change
  useEffect(() => {
    if (!isInitialLoad) return

    // Hide skeleton after a short delay to show loading state
    const timer = setTimeout(() => setIsInitialLoad(false), 150)
    return () => clearTimeout(timer)
  }, [isInitialLoad, filteredModels.length])

  const fetchHuggingFaceModel = async (searchValue: string) => {
    const normalizedSearchValue = searchValue.trim()

    if (normalizedSearchValue.length < 3) {
      return
    }

    setIsSearching(true)
    if (addModelSourceTimeoutRef.current) {
      clearTimeout(addModelSourceTimeoutRef.current)
    }

    addModelSourceTimeoutRef.current = setTimeout(async () => {
      try {
        const repoInfo = await serviceHub
          .models()
          .fetchHuggingFaceRepo(normalizedSearchValue, huggingfaceToken)
        if (repoInfo) {
          const catalogModel = serviceHub
            .models()
            .convertHfRepoToCatalogModel(repoInfo)
          if (
            !sources.some(
              (s) =>
                catalogModel.model_name.trim().split('/').pop() ===
                  s.model_name.trim() &&
                catalogModel.developer?.trim() === s.developer?.trim()
            )
          ) {
            setHuggingFaceRepo(catalogModel)
          }
        }
      } catch (error) {
        console.error('Error fetching repository info:', error)
      } finally {
        setIsSearching(false)
      }
    }, 500)
  }

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    setIsSearching(false)
    setSearchValue(next)
    // Only drop the "found outside catalog" card when the new query can
    // not yield a result anyway (matches the ``< 3`` early-return in
    // ``fetchHuggingFaceModel``). Clearing it on every keystroke made the
    // card disappear → reappear on fast typing, which read as a flicker
    // even when the underlying repo was still relevant.
    if (next.trim().length < 3) {
      setHuggingFaceRepo(null)
    }

    if (!showOnlyDownloaded) {
      fetchHuggingFaceModel(next)
    }
  }

  const navigate = useNavigate()

  const isRecommendedModel = useCallback((modelId: string) => {
    return (extractModelName(modelId)?.toLowerCase() ===
      'jan-nano-gguf') as boolean
  }, [])

  const handleUseModel = useCallback(
    (modelId: string) => {
      const allProviders = useModelProvider.getState().providers
      const upstream = allProviders.find(
        (p) => p.provider === 'llamacpp-upstream'
      )
      const fork = allProviders.find((p) => p.provider === 'llamacpp')
      const upstreamHasModel = upstream?.models.some((m) => m.id === modelId)
      const forkHasModel = fork?.models.some((m) => m.id === modelId)
      const targetLlamaProvider: 'llamacpp' | 'llamacpp-upstream' =
        upstreamHasModel
          ? 'llamacpp-upstream'
          : forkHasModel
            ? 'llamacpp'
            : upstream
              ? 'llamacpp-upstream'
              : 'llamacpp'

      console.log(
        '[hub/index] handleUseModel:',
        modelId,
        '→ provider:',
        targetLlamaProvider,
        '(upstreamHasModel:',
        upstreamHasModel,
        'forkHasModel:',
        forkHasModel,
        ')'
      )

      useModelProvider
        .getState()
        .selectModelProvider(targetLlamaProvider, modelId)
      switchToModel({
        modelId,
        providerName: targetLlamaProvider,
        serviceHub,
      }).catch((error) => {
        console.error('[hub/index] switchToModel failed:', error)
      })
      navigate({
        to: route.home,
        params: {},
        search: {
          threadModel: {
            id: modelId,
            provider: targetLlamaProvider,
          },
        },
      })
    },
    [navigate, serviceHub]
  )

  const getDownloadedModel = useCallback(
    (model: CatalogModel, variant?: { model_id: string }) => {
      const mlxProvider = providers.find((p) => p.provider === 'mlx')
      const llamaProvider = providers.find((p) => p.provider === 'llamacpp')
      const upstreamProvider = providers.find(
        (p) => p.provider === 'llamacpp-upstream'
      )

      if (model.is_mlx) {
        const modelName = model.model_name.split('/').pop() ?? model.model_name
        const mlxModelId = modelName
          .replace(/\s+/g, '-')
          .replace(/[^a-zA-Z0-9\-_./]/g, '')
        const downloaded = mlxProvider?.models.find(
          (m: { id: string }) =>
            m.id === mlxModelId || m.id === `${model.developer}/${mlxModelId}`
        )

        return downloaded && mlxProvider
          ? { provider: mlxProvider, modelId: downloaded.id }
          : undefined
      }

      const modelId =
        variant?.model_id ??
        pickDefaultQuant(model)?.model_id ??
        model.model_name
      const prefixedModelId = `${model.developer}/${sanitizeModelId(modelId)}`
      const llamaMatch = llamaProvider?.models.find(
        (m: { id: string }) => m.id === modelId || m.id === prefixedModelId
      )
      if (llamaMatch && llamaProvider) {
        return { provider: llamaProvider, modelId: llamaMatch.id }
      }

      const upstreamMatch = upstreamProvider?.models.find(
        (m: { id: string }) => m.id === modelId || m.id === prefixedModelId
      )
      return upstreamMatch && upstreamProvider
        ? { provider: upstreamProvider, modelId: upstreamMatch.id }
        : undefined
    },
    [providers]
  )

  // Check if we're on the last step
  const renderFilter = () => {
    return (
      <>
        {/* Sort dropdown - always visible */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              {
                sortOptions.find((option) => option.value === sortSelected)
                  ?.name
              }
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end">
            {sortOptions.map((option) => (
              <DropdownMenuItem
                className={cn(
                  'cursor-pointer my-0.5',
                  sortSelected === option.value && 'bg-secondary'
                )}
                key={option.value}
                onClick={() => {
                  setIsInitialLoad(true)
                  setSortSelected(option.value)
                }}
              >
                {option.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-2">
          <Switch
            checked={showOnlyDownloaded}
            onCheckedChange={(checked) => {
              setIsInitialLoad(true)
              setShowOnlyDownloaded(checked)
              if (checked) {
                setHuggingFaceRepo(null)
              } else {
                // Re-trigger HuggingFace search when switching back to "All models"
                fetchHuggingFaceModel(searchValue)
              }
            }}
          />
          <span className="text-xs text-foreground font-medium whitespace-nowrap">
            {t('hub:downloaded')}
          </span>
        </div>
      </>
    )
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <div className="flex flex-col h-full w-full ">
        <HeaderPage>
          <div
            className={cn(
              'pr-3 py-3  h-10 w-full flex items-center justify-between relative z-20',
              !IS_MACOS && 'pr-30'
            )}
          >
            <div className="flex items-center gap-2 w-full min-w-0">
              {isSearching ? (
                <Loader className="shrink-0 size-4 animate-spin text-muted-foreground" />
              ) : (
                <IconSearch
                  className="shrink-0 text-muted-foreground"
                  size={14}
                />
              )}
              <input
                placeholder={t('hub:searchPlaceholder')}
                value={searchValue}
                onChange={handleSearchChange}
                autoComplete="off"
                className="hub-models-search-input w-full min-w-0 flex-1 bg-transparent bg-clip-padding text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none animate-none transition-none"
              />
            </div>
            <div className="sm:flex items-center gap-2 shrink-0 hidden">
              {renderFilter()}
            </div>
          </div>
        </HeaderPage>
        <div
          ref={parentRef}
          className="p-4 w-full h-[calc(100%-60px)] overflow-y-auto!"
        >
          <div className="flex flex-col h-full justify-between gap-4 w-full md:w-4/5 xl:w-4/6 mx-auto">
            {/* Recommended сверху со своим разделителем, затем блок «All Models» с таким же разделителем, затем каталог */}
            {showRecommendedBlock && (
              <section className="shrink-0 border-b border-border pb-4">
                <h2 className="text-sm font-medium mb-3 text-muted-foreground">
                  {t('hub:recTitle')}
                </h2>
                <div className="flex flex-col gap-1">
                  {recommendedItems.map(({ rec, model }) => {
                    const key = `${rec.modelName}-${rec.descriptionKey}`
                    const recChip = (
                      <RecommendedModelChip
                        variant={chipVariantForRecommendedDescriptionKey(
                          rec.descriptionKey
                        )}
                        title={t(rec.descriptionKey)}
                      >
                        {t(rec.descriptionKey)}
                      </RecommendedModelChip>
                    )
                    //* Модель ещё не разрешилась из catalog/HF — лёгкая
                    //* заглушка в стиле новой карточки, пока подтянутся данные.
                    if (!model) {
                      return (
                        <div
                          key={key}
                          className="bg-card rounded-2xl border border-border px-[18px] py-4 shadow-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <h1
                              className="min-w-0 truncate text-foreground font-semibold text-base capitalize cursor-pointer"
                              title={
                                extractModelName(rec.modelName) || rec.modelName
                              }
                              onClick={() =>
                                navigate({
                                  to: route.hub.model,
                                  params: { modelId: rec.modelName },
                                })
                              }
                            >
                              {extractModelName(rec.modelName) || rec.modelName}
                            </h1>
                            {recChip}
                          </div>
                          <p className="text-[13px] text-muted-foreground mt-1">
                            {t('hub:by')} {rec.modelName.split('/')[0]}
                          </p>
                        </div>
                      )
                    }
                    return (
                      <HubModelCard
                        key={key}
                        model={model}
                        expanded={!!expandedModels[model.model_name]}
                        isRecommended={isRecommendedModel(model.model_name)}
                        chip={recChip}
                        onToggleVariants={() =>
                          toggleModelExpansion(model.model_name)
                        }
                        onOpenModel={() =>
                          navigate({
                            to: route.hub.model,
                            params: { modelId: model.model_name },
                          })
                        }
                        handleUseModel={handleUseModel}
                        getDownloadedModel={getDownloadedModel}
                      />
                    )
                  })}
                </div>
              </section>
            )}
            {showRecommendedBlock && (
              <section className="shrink-0">
                <h2 className="text-sm font-medium text-muted-foreground">
                  {t('hub:allModelsTitle')}
                </h2>
              </section>
            )}
            {isInitialLoad || (loading && !filteredModels.length) ? (
              // Skeleton loading state for better perceived performance
              <div className="flex flex-col gap-3 animate-pulse">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="bg-card border border-border rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between gap-x-2">
                      <div className="h-5 bg-muted rounded w-1/3" />
                      <div className="flex items-center gap-3">
                        <div className="h-4 bg-muted rounded w-20" />
                        <div className="h-8 w-8 bg-muted rounded" />
                      </div>
                    </div>
                    <div className="mt-3 h-4 bg-muted rounded w-full" />
                    <div className="mt-2 h-4 bg-muted rounded w-2/3" />
                    <div className="flex items-center gap-4 mt-3">
                      <div className="h-4 bg-muted rounded w-16" />
                      <div className="h-4 bg-muted rounded w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredModels.length === 0 && !showRecommendedBlock ? (
              <div className="flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  {t('hub:noModels')}
                </div>
              </div>
            ) : virtualListModels.length === 0 ? null : (
              <div
                className={cn(
                  'flex flex-col pb-2 mb-2 transition-opacity duration-200',
                  isPending ? 'opacity-70' : 'opacity-100'
                )}
              >
                <div className="flex items-center gap-2 justify-end sm:hidden">
                  {renderFilter()}
                </div>
                <div
                  ref={listRef}
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualItem) => (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        //* start включает scrollMargin — вычитаем его, т.к.
                        //* контейнер списка уже начинается со смещения.
                        transform: `translateY(${virtualItem.start - listScrollMargin}px)`,
                        //* Симметрия вокруг разделителя: раньше был только paddingBottom — зазор визуально смещался вниз
                        paddingTop: 4,
                        paddingBottom: 0,
                      }}
                    >
                      <HubModelCard
                        model={virtualListModels[virtualItem.index]}
                        expanded={
                          !!expandedModels[
                            virtualListModels[virtualItem.index].model_name
                          ]
                        }
                        isRecommended={isRecommendedModel(
                          virtualListModels[virtualItem.index].model_name
                        )}
                        onToggleVariants={() =>
                          toggleModelExpansion(
                            virtualListModels[virtualItem.index].model_name
                          )
                        }
                        onOpenModel={() =>
                          navigate({
                            to: route.hub.model,
                            params: {
                              modelId:
                                virtualListModels[virtualItem.index].model_name,
                            },
                          })
                        }
                        handleUseModel={handleUseModel}
                        getDownloadedModel={getDownloadedModel}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
