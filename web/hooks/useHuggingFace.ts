import { useCallback } from 'react'

import { listFiles, listModels } from '@huggingface/hub'

const useHuggingFace = () => {
  // TODO: handle abort
  const listCortexHubModels = useCallback(async () => {
    const modelEntries: HuggingFaceModelEntry[] = []
    for await (const model of listModels({
      search: { query: 'cortexhub' },
    })) {
      modelEntries.push({
        ...model,
      })
    }
    return modelEntries
  }, [])

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

  const getSingleModelBranchInfo = useCallback(
    async (repoName: string, revision: string) => {
      for await (const fileInfo of listFiles({
        repo: { type: 'model', name: repoName },
        revision: revision,
      })) {
        // if gguf, the size will be the filesize of filepath endswith .gguf
        // if (fileInfo.path === 'model.yml') {
        //   const data = await (
        //     await downloadFile({
        //       repo: repoName,
        //       revision,
        //       path: fileInfo.path,
        //     })
        //   )?.text()
        //   console.log(data)
        // }
        // console.log(JSON.stringify(fileInfo))
      }
    },
    []
  )

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
}

export type EngineType = 'onnx' | 'gguf' | 'tensorrtllm'

export type EngineToBranches = Record<EngineType, string[]>
