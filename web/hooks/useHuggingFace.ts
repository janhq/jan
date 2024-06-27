import { useCallback } from 'react'

import { downloadFile, listFiles, listModels } from '@huggingface/hub'
import { Model } from '@janhq/core'
import { parse } from 'yaml'

const useHuggingFace = () => {
  const tryToReadModelYmlByBranch = useCallback(
    async (repoName: string, branch?: string): Promise<Model | undefined> => {
      const revision = branch ?? 'main'
      try {
        for await (const fileInfo of listFiles({
          repo: { type: 'model', name: repoName },
          revision,
        })) {
          if (fileInfo.path !== 'model.yml') continue

          const data = await (
            await downloadFile({
              repo: repoName,
              revision,
              path: fileInfo.path,
            })
          )?.text()

          if (!data) return undefined
          return parse(data) as Model
        }
      } catch (e) {
        console.debug('Cannot get model info for', repoName, e)
        return undefined
      }
    },
    []
  )

  const listCortexHubModels = useCallback(async () => {
    const modelEntries: HuggingFaceModelEntry[] = []

    for await (const model of listModels({
      search: { query: 'cortexhub' },
    })) {
      modelEntries.push({
        ...model,
      })
    }

    const promises: Promise<Model | undefined>[] = []
    modelEntries.forEach((model) => {
      promises.push(tryToReadModelYmlByBranch(model.name))
    })

    const modelData = await Promise.allSettled(promises)
    for (let i = 0; i < modelEntries.length; i++) {
      if (modelData[i].status === 'fulfilled') {
        const fulfillResult = modelData[i] as PromiseFulfilledResult<
          Model | undefined
        >
        modelEntries[i].model = fulfillResult.value
      }
    }

    return modelEntries
  }, [tryToReadModelYmlByBranch])

  const getBranches = useCallback(async (name: string): Promise<string[]> => {
    try {
      const response = await fetch(
        `https://huggingface.co/api/models/${name}/refs`
      )
      const data = await response.json()
      return data.branches.map((branch: { name: string }) => branch.name)
    } catch (err) {
      console.error('Failed to get HF branches:', err)
      return []
    }
  }, [])

  const getEngineAndBranches = useCallback(
    async (name: string): Promise<EngineToBranches> => {
      const branches = await getBranches(name)
      const engineToBranches: EngineToBranches = {
        onnx: [],
        gguf: [],
        tensorrtllm: [],
      }

      branches.forEach((branch) => {
        if (branch.endsWith('-onnx')) {
          engineToBranches.onnx.push(branch)
          return
        }

        if (branch.endsWith('-gguf')) {
          engineToBranches.gguf.push(branch)
          return
        }
        if (branch.includes('tensorrtllm')) {
          engineToBranches.tensorrtllm.push(branch)
          return
        }
      })
      return engineToBranches
    },
    [getBranches]
  )

  return { listCortexHubModels, getBranches, getEngineAndBranches }
}

export default useHuggingFace

export type HuggingFaceModelEntry = {
  name: string
  private: boolean
  downloads: number
  gated: false | 'auto' | 'manual'
  likes: number
  model?: Model
}

export type EngineType = 'onnx' | 'gguf' | 'tensorrtllm'

export type EngineToBranches = Record<EngineType, string[]>
