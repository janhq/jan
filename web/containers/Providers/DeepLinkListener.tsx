import { Fragment, ReactNode } from 'react'

import { useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import { useGetHFRepoData } from '@/hooks/useGetHFRepoData'

import { loadingModalVisibilityAtom as loadingModalInfoAtom } from '../LoadingModal'
import { toaster } from '../Toast'

import {
  importHuggingFaceModelStageAtom,
  importingHuggingFaceRepoDataAtom,
} from '@/helpers/atoms/HuggingFace.atom'
type Props = {
  children: ReactNode
}

const DeepLinkListener: React.FC<Props> = ({ children }) => {
  const { getHfRepoData } = useGetHFRepoData()
  const setLoadingInfo = useSetAtom(loadingModalInfoAtom)
  const setImportingHuggingFaceRepoData = useSetAtom(
    importingHuggingFaceRepoDataAtom
  )
  const setImportHuggingFaceModelStage = useSetAtom(
    importHuggingFaceModelStageAtom
  )

  const debounced = useDebouncedCallback(async (searchText) => {
    if (searchText.indexOf('/') === -1) {
      toaster({
        title: 'Failed to get Hugging Face models',
        description: 'Invalid Hugging Face model URL',
        type: 'error',
      })
      return
    }

    try {
      setLoadingInfo({
        title: 'Getting Hugging Face models',
        message: 'Please wait..',
      })
      const data = await getHfRepoData(searchText)
      setImportingHuggingFaceRepoData(data)
      setImportHuggingFaceModelStage('REPO_DETAIL')
      setLoadingInfo(undefined)
    } catch (err) {
      setLoadingInfo(undefined)
      let errMessage = 'Unexpected Error'
      if (err instanceof Error) {
        errMessage = err.message
      }
      toaster({
        title: 'Failed to get Hugging Face models',
        description: errMessage,
        type: 'error',
      })
      console.error(err)
    }
  }, 300)
  window.electronAPI?.onDeepLink((_event: string, input: string) => {
    window.core?.api?.ackDeepLink()
    const url = input.replaceAll('jan://', '')
    debounced(url)
  })

  return <Fragment>{children}</Fragment>
}

export default DeepLinkListener
