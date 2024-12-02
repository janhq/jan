import { Fragment } from 'react'

import { useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import { useGetHFRepoData } from '@/hooks/useGetHFRepoData'

import { loadingModalInfoAtom } from '../LoadingModal'
import { toaster } from '../Toast'

import {
  importHuggingFaceModelStageAtom,
  importingHuggingFaceRepoDataAtom,
} from '@/helpers/atoms/HuggingFace.atom'

const DeepLinkListener: React.FC = () => {
  const { getHfRepoData } = useGetHFRepoData()
  const setLoadingInfo = useSetAtom(loadingModalInfoAtom)
  const setImportingHuggingFaceRepoData = useSetAtom(
    importingHuggingFaceRepoDataAtom
  )
  const setImportHuggingFaceModelStage = useSetAtom(
    importHuggingFaceModelStageAtom
  )

  const handleDeepLinkAction = useDebouncedCallback(
    async (deepLinkAction: DeepLinkAction) => {
      if (
        deepLinkAction.action !== 'models' ||
        deepLinkAction.provider !== 'huggingface'
      ) {
        console.error(
          `Invalid deeplink action (${deepLinkAction.action}) or provider (${deepLinkAction.provider})`
        )
        return
      }

      try {
        setLoadingInfo({
          title: 'Getting Hugging Face models',
          message: 'Please wait..',
        })
        const data = await getHfRepoData(deepLinkAction.resource)
        setImportingHuggingFaceRepoData(data)
        setImportHuggingFaceModelStage('REPO_DETAIL')
        setLoadingInfo(undefined)
      } catch (err) {
        setLoadingInfo(undefined)
        toaster({
          title: 'Failed to get Hugging Face models',
          description: err instanceof Error ? err.message : 'Unexpected Error',
          type: 'error',
        })
        console.error(err)
      }
    },
    300
  )

  window.electronAPI?.onDeepLink((_event: string, input: string) => {
    window.core?.api?.ackDeepLink()

    const action = deeplinkParser(input)
    if (!action) return
    handleDeepLinkAction(action)
  })

  return <Fragment></Fragment>
}

type DeepLinkAction = {
  action: string
  provider: string
  resource: string
}

const deeplinkParser = (
  deepLink: string | undefined
): DeepLinkAction | undefined => {
  if (!deepLink) return undefined

  try {
    const url = new URL(deepLink)
    const params = url.pathname.split('/').filter((str) => str.length > 0)

    if (params.length < 3) return undefined
    const action = params[0]
    const provider = params[1]
    const resource = params.slice(2).join('/')
    return { action, provider, resource }
  } catch (err) {
    console.error(err)
    return undefined
  }
}

export default DeepLinkListener
