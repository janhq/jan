import { useContext } from 'react'

import {
  ExtensionTypeEnum,
  HuggingFaceExtension,
  HuggingFaceRepoData,
  Quantization,
} from '@janhq/core'

import { useSetAtom } from 'jotai'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  conversionStatusAtom,
  conversionErrorAtom,
} from '@/helpers/atoms/HFConverter.atom'

export const useConvertHuggingFaceModel = () => {
  const { ignoreSSL, proxy } = useContext(FeatureToggleContext)
  const setConversionStatus = useSetAtom(conversionStatusAtom)
  const setConversionError = useSetAtom(conversionErrorAtom)

  const convertHuggingFaceModel = async (
    repoID: string,
    repoData: HuggingFaceRepoData,
    quantization: Quantization
  ) => {
    const extension = await extensionManager.get<HuggingFaceExtension>(
      ExtensionTypeEnum.HuggingFace
    )
    try {
      if (extension) {
        extension.interrupted = false
      }
      setConversionStatus('downloading')
      await extension?.downloadModelFiles(repoID, repoData, {
        ignoreSSL,
        proxy,
      })
      if (extension?.interrupted) return
      setConversionStatus('converting')
      await extension?.convert(repoID)
      if (extension?.interrupted) return
      setConversionStatus('quantizing')
      await extension?.quantize(repoID, quantization)
      if (extension?.interrupted) return
      setConversionStatus('generating')
      await extension?.generateMetadata(repoID, repoData, quantization)
      setConversionStatus('done')
    } catch (err) {
      if (extension?.interrupted) return
      extension?.cancelConvert(repoID, repoData)
      if (typeof err === 'number') {
        setConversionError(new Error(`exit code: ${err}`))
      } else {
        setConversionError(err as Error)
      }
      console.error(err)
    }
  }

  const cancelConvertHuggingFaceModel = async (
    repoID: string,
    repoData: HuggingFaceRepoData
  ) => {
    const extension = await extensionManager.get<HuggingFaceExtension>(
      ExtensionTypeEnum.HuggingFace
    )

    setConversionStatus('stopping')
    await extension?.cancelConvert(repoID, repoData)
    setConversionStatus(null)
  }

  return {
    convertHuggingFaceModel,
    cancelConvertHuggingFaceModel,
  }
}
