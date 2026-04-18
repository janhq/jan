import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type {
  ModelScopeModel,
  ModelScopeModelsResult,
  ModelScopeDetailResult,
  ListModelScopeModelsParams,
} from '@/services/modelscope/types'

interface UseModelScopeState {
  models: ModelScopeModel[]
  totalCount: number
  loading: boolean
  error: string | null
  hasMore: boolean
}

const PAGE_SIZE = 20

export function useModelScope() {
  const [state, setState] = useState<UseModelScopeState>({
    models: [],
    totalCount: 0,
    loading: false,
    error: null,
    hasMore: true,
  })

  const [params, setParams] = useState<ListModelScopeModelsParams>({
    sort: 'downloads',
    page_number: 1,
    page_size: PAGE_SIZE,
  })

  const [token, setTokenState] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Load token from Rust on mount
  useEffect(() => {
    let mounted = true
    invoke<string | null>('get_modelscope_token')
      .then((t) => {
        if (mounted) setTokenState(t)
      })
      .catch(() => {
        if (mounted) setTokenState(null)
      })
    return () => {
      mounted = false
    }
  }, [])

  const setToken = useCallback(async (t: string | null) => {
    if (t) {
      await invoke('save_modelscope_token', { token: t })
    } else {
      await invoke('clear_modelscope_token')
    }
    setTokenState(t)
  }, [])

  const fetchModels = useCallback(
    async (overrideParams?: ListModelScopeModelsParams, append = false) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setState((prev) => ({
        ...prev,
        loading: true,
        error: null,
      }))

      try {
        const query = overrideParams ?? params
        const result = await invoke<ModelScopeModelsResult>('list_modelscope_models', {
          params: query,
          token,
        })

        if (controller.signal.aborted) return

        setState((prev) => ({
          models: append ? [...prev.models, ...result.models] : result.models,
          totalCount: result.total_count,
          loading: false,
          error: null,
          hasMore: result.models.length === PAGE_SIZE && result.models.length + (append ? prev.models.length : 0) < result.total_count,
        }))
      } catch (err) {
        if (controller.signal.aborted) return
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      }
    },
    [params, token]
  )

  // Reset and fetch when filter/sort/search changes (excluding page_number).
  // We intentionally omit `fetchModels` from deps because it is recreated
  // on every `params` change, which would cause an infinite loop.
  useEffect(() => {
    fetchModels({ ...params, page_number: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    params.search,
    params.owner,
    params.sort,
    params.filter_task,
    params.filter_library,
    params.filter_model_type,
    params.filter_custom_tag,
    params.filter_license,
    params.filter_deploy,
    token,
  ])

  // Use refs to keep loadMore stable and avoid recreating it on every state change.
  const stateRef = useRef(state)
  stateRef.current = state
  const paramsRef = useRef(params)
  paramsRef.current = params
  const fetchModelsRef = useRef(fetchModels)
  fetchModelsRef.current = fetchModels

  const loadMore = useCallback(() => {
    const s = stateRef.current
    const p = paramsRef.current
    if (s.loading || !s.hasMore) return
    const nextPage = (p.page_number ?? 1) + 1
    const nextParams = { ...p, page_number: nextPage }
    setParams(nextParams)
    fetchModelsRef.current(nextParams, true)
  }, [])

  const updateParams = useCallback(
    (patch: Partial<ListModelScopeModelsParams>) => {
      setParams((prev) => ({ ...prev, ...patch, page_number: 1 }))
    },
    []
  )

  const resetFilters = useCallback(() => {
    setParams({
      sort: 'downloads',
      page_number: 1,
      page_size: PAGE_SIZE,
    })
  }, [])

  return {
    ...state,
    params,
    token,
    setToken,
    updateParams,
    loadMore,
    resetFilters,
    refresh: () => fetchModels({ ...params, page_number: 1 }),
  }
}

export function useModelScopeDetail() {
  const [detail, setDetail] = useState<ModelScopeDetailResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)

  const fetchDetail = useCallback(
    async (owner: string, repoName: string, token: string | null) => {
      setLoading(true)
      setError(null)
      setNeedsAuth(false)

      try {
        const result = await invoke<ModelScopeDetailResult>('get_modelscope_model_detail', {
          owner,
          repoName: repoName,
          token,
        })
        setDetail(result)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('AUTH_REQUIRED')) {
          setNeedsAuth(true)
        } else {
          setError(msg)
        }
      } finally {
        setLoading(false)
      }
    },
    []
  )

  return { detail, loading, error, needsAuth, fetchDetail }
}
