import { useEffect } from 'react'

import { ExtensionType, ModelExtension, Model } from '@janhq/core'

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

export async function getDownloadedModels(): Promise<Model[]> {
  const models = await extensionManager
    .get<ModelExtension>(ExtensionType.Model)
    ?.getDownloadedModels()

  return models ?? []
}
