import { LlmEngine, LlmEngines } from '@janhq/core'

import { useQueries } from '@tanstack/react-query'

import {
  fetchHuggingFaceModel,
  HfModelEntry,
  fetchCortexHubModels,
} from '@/utils/huggingface'

// TODO: change curated models to built in models
type CuratedModelResponse = {
  quickstart_models: QuickStartModel[]
  popular_models: CuratedModel[]
}

export type QuickStartModel = {
  note: string
  url: string
  author: string
  logo: string
  model_name: string
  model_logo: string
  size: number
  engine: LlmEngine
}

export type CuratedModel = { note: string; url: string }

const getFileSize = async (url: string): Promise<number> => {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    const size = response.headers.get('content-length')
    return Number(size)
  } catch (err) {
    console.error('Getting file size failed for:', url, err)
    return 0
  }
}

const fetchBuiltInModels = async (): Promise<CuratedModelResponse> => {
  const response = await fetch(
    'https://raw.githubusercontent.com/janhq/cortex-web/main/static/huggingface/hub.json'
  )
  const data = (await response.json()) as CuratedModelResponse

  const getFileSizePromises: Promise<number>[] = data.quickstart_models.map(
    (model) => {
      const directDownloadUrl = model.url.replace('/blob/', '/resolve/')
      return getFileSize(directDownloadUrl)
    }
  )

  const sizes = await Promise.all(getFileSizePromises)
  data.quickstart_models = data.quickstart_models.map((model, i) => {
    const engine = (model.engine ?? 'cortex.llamacpp') as LlmEngine
    return {
      ...model,
      engine,
      size: sizes[i],
    }
  })

  return data
}

type BuiltInModels = {
  popularModelEntries: HfModelEntry[]
  quickStartModels: QuickStartModel[]
}

const getBuiltInModelEntries = async (): Promise<BuiltInModels> => {
  const builtInModels = await fetchBuiltInModels()
  const popularModelPaths = builtInModels.popular_models.map(
    (model) => model.url
  )

  const result: HfModelEntry[] = []
  const promises: Promise<HfModelEntry[]>[] = []
  popularModelPaths.forEach((path) => {
    try {
      const replacedUrl = path.replace('https://huggingface.co/', '')
      const ownerName = replacedUrl.split('/')[0]
      const repoName = replacedUrl.split('/')[1]
      promises.push(fetchHuggingFaceModel(ownerName, repoName))
    } catch (err) {
      console.error('Failed to getBuiltInModelEntries:', err)
    }
  })
  const promiseResult = await Promise.allSettled(promises)
  // check if fulfilled or rejected
  for (let i = 0; i < promiseResult.length; i++) {
    if (promiseResult[i].status === 'fulfilled') {
      const fulfillResult = promiseResult[i] as PromiseFulfilledResult<
        HfModelEntry[]
      >
      const modelEntries: HfModelEntry[] = fulfillResult.value as HfModelEntry[]
      result.push(...modelEntries)
    } else {
      console.error('Failed to getBuiltInModelEntries:', promiseResult[i])
    }
  }

  return {
    popularModelEntries: result,
    quickStartModels: builtInModels.quickstart_models,
  }
}

export type ModelHubData = {
  sliderData: QuickStartModel[]
  modelCategories: Map<ModelHubCategory, HfModelEntry[]>
}

export const ModelHubCategoryList = [
  'BuiltInModels',
  'HuggingFace',
  ...Object.values(LlmEngines),
] as const
export type ModelHubCategory = (typeof ModelHubCategoryList)[number]

export const builtInModelsEntriesQueryKey = ['builtInModelsEntriesQueryKey']
export const cortexHubModelsQueryKey = ['cortexHubModelsQueryKey']

const useModelHub = () => {
  const results = useQueries({
    queries: [
      {
        queryKey: builtInModelsEntriesQueryKey,
        queryFn: getBuiltInModelEntries,
      },
      {
        queryKey: cortexHubModelsQueryKey,
        queryFn: fetchCortexHubModels,
      },
    ],
  })

  const isLoading = results.some((result) => result.isLoading)
  const isError = results.some((result) => result.isError)
  const error = results.find((result) => result.error)?.error

  const data: ModelHubData | undefined = (() => {
    if (results.every((result) => result.isSuccess)) {
      const data: ModelHubData = {
        sliderData: [],
        modelCategories: new Map(),
      }
      if (results[0].data) {
        // quick start
        data.sliderData = results[0].data.quickStartModels

        // popular
        data.modelCategories.set(
          'HuggingFace',
          results[0].data.popularModelEntries
        )
      }

      if (results[1].data) {
        data.modelCategories.set(
          'BuiltInModels',
          results[1].data.filter(
            (modelEntry) => modelEntry.remoteModel === false
          )
        )

        // for remote models
        results[1].data.forEach((modelEntry) => {
          const engine = modelEntry.engine
          if (modelEntry.remoteModel === true && engine) {
            // @ts-expect-error ignore
            data.modelCategories[engine] = data.modelCategories[engine]
              ? // @ts-expect-error ignore
                [...data.modelCategories[engine], modelEntry]
              : [modelEntry]
          }
        })
      }

      return data
    }
    return undefined
  })()

  return { data, isLoading, isError, error }
}

export default useModelHub
