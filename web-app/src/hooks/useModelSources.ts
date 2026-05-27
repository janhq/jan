/**
 * `useModelSources` -- compatibility shim over the new
 * `useModelCatalogStore` (see `web-app/src/stores/model-catalog-store.ts`).
 *
 * Pre-2026-05-27, this store fetched the legacy `janhq/model-catalog`
 * directly via `serviceHub.models().fetchModelCatalog()` and persisted the
 * result through `zustand/middleware:persist`. After the migration to the
 * curated `AtomicBot-ai/atomic-chat-model-catalog` source, persistence and
 * caching are handled by `model-catalog-store` (which writes its own
 * localStorage cache keyed `atomic_model_catalog_cache_v1`). This module
 * keeps the original API surface (`sources`, `fetchSources`, `loading`,
 * `error`) so the dozens of existing consumers do not need to change in
 * lockstep, but every reactive read now flows through the new store.
 *
 * Platform filtering (drop MLX entries on non-macOS) and quant-id
 * sanitisation stay here -- they are shape transforms specific to the
 * client, and the catalog artefact is intentionally platform-neutral.
 */

import { create } from 'zustand'
import {
  useModelCatalogStore,
  ensureCatalogLoaded,
} from '@/stores/model-catalog-store'
import type { CatalogModel } from '@/services/models/types'
import { sanitizeModelId } from '@/lib/utils'

type ModelSourcesState = {
  sources: CatalogModel[]
  error: Error | null
  loading: boolean
  fetchSources: () => Promise<void>
}

const adaptCatalog = (
  catalog: ReadonlyArray<CatalogModel>
): CatalogModel[] => {
  const out: CatalogModel[] = []
  for (const entry of catalog) {
    const is_mlx = entry.is_mlx ?? entry.library_name === 'mlx'
    // Defense-in-depth: keep platform filtering here (mirrors
    // useResolvedRecommendedModels' MLX safety net). The artefact stays
    // OS-agnostic so the same cache works for a user who later moves to
    // macOS.
    if (is_mlx && !IS_MACOS) continue
    out.push({
      ...entry,
      quants: entry.quants?.map((q) => ({
        ...q,
        model_id: sanitizeModelId(q.model_id),
      })),
      is_mlx,
    })
  }
  return out
}

export const useModelSources = create<ModelSourcesState>()((set) => {
  const apply = (): void => {
    const state = useModelCatalogStore.getState()
    set({
      sources: adaptCatalog(state.catalog),
      loading: state.status === 'loading',
      error: state.error ? new Error(state.error) : null,
    })
  }

  // Seed from whatever the catalog store has right now (cache or baseline).
  const initial = useModelCatalogStore.getState()

  // Subscribe once at module-eval time and forward every change.
  useModelCatalogStore.subscribe((next, prev) => {
    if (
      next.catalog !== prev.catalog ||
      next.status !== prev.status ||
      next.error !== prev.error
    ) {
      apply()
    }
  })

  return {
    sources: adaptCatalog(initial.catalog),
    loading: initial.status === 'loading',
    error: initial.error ? new Error(initial.error) : null,
    fetchSources: async () => {
      await ensureCatalogLoaded()
      apply()
    },
  }
})
