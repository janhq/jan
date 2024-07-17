import { useCallback } from 'react'

import { HuggingFaceRepoData } from '@janhq/core/.'
import { useQueryClient } from '@tanstack/react-query'

import { useSetAtom } from 'jotai'

import { fetchHuggingFaceRepoData } from '@/utils/huggingface'

import useCortex from './useCortex'
import { addDownloadModelStateAtom } from './useDownloadState'
import { fetchHuggingFaceRepoDataQueryKey } from './useHfRepoDataQuery'

/**
 * Fetches the data for a Hugging Face model and downloads it.
 * This function will query local cache data first, before send request
 * to HuggingFace to prevent unnecessary requests.
 *
 * @param modelHandle The model handle to fetch and download. E.g: "NousResearch/Hermes-2-Theta-Llama-3-8B-GGUF"
 */
const useHfModelFetchAndDownload = () => {
  const addDownloadState = useSetAtom(addDownloadModelStateAtom)
  const { downloadModel } = useCortex()
  const queryClient = useQueryClient()

  const fetchData = useCallback(
    async (modelHandle: string): Promise<HuggingFaceRepoData | undefined> => {
      const data = queryClient.getQueryData([
        ...fetchHuggingFaceRepoDataQueryKey,
        modelHandle,
      ])

      if (data) return data as HuggingFaceRepoData
      console.debug(`No cache data found for ${modelHandle}`)
      const repoData = await fetchHuggingFaceRepoData(modelHandle)
      await queryClient.setQueryData(
        [...fetchHuggingFaceRepoDataQueryKey, data],
        repoData
      )
      return repoData
    },
    [queryClient]
  )

  const fetchDataAndDownload = useCallback(
    async (modelHandle: string) => {
      const repoData = await fetchData(modelHandle)
      if (!repoData) {
        alert(`Could not fetch data for repo ${modelHandle}`)
        console.error(`Could not fetch data for repo ${modelHandle}`)
        return
      }

      const recommendedModel = repoData.siblings.find(
        (sibling) => sibling.quantization === 'Q4_K_S'
      )

      if (!recommendedModel) {
        alert('Could not find model with quantization Q4_K_S')
        return
      }
      const persistModelId = modelHandle
        .replaceAll('/', '_')
        .concat('_')
        .concat(recommendedModel.rfilename)

      addDownloadState(persistModelId)
      await downloadModel(
        modelHandle,
        recommendedModel.rfilename,
        persistModelId
      )
    },

    [addDownloadState, downloadModel, fetchData]
  )

  return { fetchDataAndDownload }
}

export default useHfModelFetchAndDownload
