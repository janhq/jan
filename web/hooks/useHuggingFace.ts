import { useCallback } from 'react'

import { EngineToBranches } from '@/utils/huggingface'

const useHuggingFace = () => {
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
        if (branch.includes('onnx')) {
          engineToBranches.onnx.push(branch)
          return
        }

        if (branch.includes('gguf')) {
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

  return { getBranches, getEngineAndBranches }
}

export default useHuggingFace
