import { useEffect } from 'react'
import { executeSerial } from '../../electron/core/plugin-manager/execution/extension-manager'
import { ModelManagementService } from '@janhq/core'
import { useAtom } from 'jotai'
import { downloadedModelAtom } from '@helpers/atoms/DownloadedModel.atom'

export function useGetDownloadedModels() {
  const [downloadedModels, setDownloadedModels] = useAtom(downloadedModelAtom)

  useEffect(() => {
    getDownloadedModels().then((downloadedModels) => {
      setDownloadedModels(downloadedModels)
    })
  }, [setDownloadedModels])

  return { downloadedModels, downloadedModels }
}

export async function getDownloadedModels(): Promise<AssistantModel[]> {
  const downloadedModels: AssistantModel[] = await executeSerial(
    ModelManagementService.GetFinishedDownloadModels
  )
  return downloadedModels ?? []
}

export async function getConfiguredModels(): Promise<Product[]> {
  return executeSerial(ModelManagementService.GetConfiguredModels)
}
