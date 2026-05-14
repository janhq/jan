import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'
import { getServiceHub } from '@/hooks/useServiceHub'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  CatalogModel,
  ModelQuant,
  ModelScore,
  ModelScoreStatus,
} from '@/services/models/types'

const pendingScoreRequests = new Map<string, Promise<ModelScore | undefined>>()

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
        const modelKey = model.model_name
        const pendingRequest = pendingScoreRequests.get(modelKey)

        if (pendingRequest) {
          return pendingRequest
        }

        const cachedScore = get().scores[modelKey]

        if (cachedScore && cachedScore.status !== 'loading') {
          return cachedScore
        }

        set((state) => ({
          scores: {
            ...state.scores,
            [modelKey]: {
              status: 'loading',
              estimated_tps: 0,
            },
          },
        }))

        const scoreRequest = getServiceHub()
          .models()
          .getHubModelScore(model, variant)
          .then((scoreResult) => {
            const status = scoreResult.status ?? ('ready' as ModelScoreStatus)

            return {
              ...scoreResult,
              status,
              estimated_tps: scoreResult.estimated_tps ?? 0,
              updated_at:
                scoreResult.updated_at ?? Math.floor(Date.now() / 1000),
            }
          })
          .then((score) => {
            set((state) => ({
              scores: {
                ...state.scores,
                [modelKey]: score,
              },
            }))

            return score
          })
          .catch((error) => {
            const failedScore: ModelScore = {
              status: 'error',
              estimated_tps: 0,
              reason:
                error instanceof Error
                  ? error.message
                  : 'Failed to score model.',
            }

            set((state) => ({
              scores: {
                ...state.scores,
                [modelKey]: failedScore,
              },
            }))

            return failedScore
          })
          .finally(() => {
            pendingScoreRequests.delete(modelKey)
          })

        pendingScoreRequests.set(modelKey, scoreRequest)

        return scoreRequest
      },

      reset: () => {
        pendingScoreRequests.clear()
        set({
          scores: {},
        })
      },
    }),
    {
      name: localStorageKey.modelScores,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
