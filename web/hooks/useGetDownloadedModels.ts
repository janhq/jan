import { useEffect } from 'react'

import { ExtensionTypeEnum, ModelExtension, Model } from '@janhq/core'

import { atom, useAtom } from 'jotai'

import { extensionManager } from '@/extension/ExtensionManager'

const downloadedModelsAtom = atom<Model[]>([])

export function useGetDownloadedModels() {
  const [downloadedModels, setDownloadedModels] = useAtom(downloadedModelsAtom)

  useEffect(() => {
    getDownloadedModels().then((downloadedModels) => {
      setDownloadedModels(downloadedModels)
    })
  }, [setDownloadedModels])

  return { downloadedModels, setDownloadedModels }
}

export const getDownloadedModels = async (): Promise<Model[]> =>
  extensionManager
    .get<ModelExtension>(ExtensionTypeEnum.Model)
    ?.getDownloadedModels() ?? []
