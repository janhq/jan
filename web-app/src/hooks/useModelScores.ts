import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'
import { fileStorage } from '@/lib/fileStorage'
import { getServiceHub } from '@/hooks/useServiceHub'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  CatalogModel,
  ModelQuant,
  ModelScore,
  ModelScoreStatus,
} from '@/services/models/types'

type ModelScoreState = {
  scores: Record<string, ModelScore>
  getScore: (modelId: string) => ModelScore | undefined
  fetchModelScore: (
    model: CatalogModel,
    variant?: ModelQuant
  ) => Promise<ModelScore | undefined>
  reset: () => void
}

export const useModelScore = create<ModelScoreState>()(
  persist(
    (set, get) => ({
      scores: {},
      getScore: (modelId: string) => get().scores[modelId],
      fetchModelScore: async (model: CatalogModel, variant?: ModelQuant) => {
        const cachedScore = get().scores[model.model_name]

        console.log('Cached score:', cachedScore)

        if (cachedScore && cachedScore.status !== 'loading') {
          return cachedScore
        }

        set((state) => ({
          scores: {
            ...state.scores,
            [model.model_name]: {
              status: 'loading',
              estimated_tps: 0,
            },
          },
        }))

        try {
          const score = await getServiceHub()
            .models()
            .getHubModelScore(model, variant)
            .then((scoreResult) => {
              return {
                ...scoreResult,
                status: 'ready' as ModelScoreStatus,
                estimated_tps: scoreResult.estimated_tps ?? 0,
                updated_at:
                  scoreResult.updated_at ?? Math.floor(Date.now() / 1000),
              }
            })

          set((state) => ({
            scores: {
              ...state.scores,
              [model.model_name]: score,
            },
          }))

          return score
        } catch (error) {
          const failedScore: ModelScore = {
            status: 'error',
            estimated_tps: 0,
            reason:
              error instanceof Error ? error.message : 'Failed to score model.',
          }

          set((state) => ({
            scores: {
              ...state.scores,
              [model.model_name]: failedScore,
            },
          }))

          return failedScore
        }
      },

      reset: () => {
        set({
          scores: {},
        })
      },
    }),
    {
      name: localStorageKey.modelScores,
      storage: createJSONStorage(() => fileStorage),
    }
  )
)
