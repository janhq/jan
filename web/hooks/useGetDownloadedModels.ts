import { useEffect } from 'react'
import { ModelManagementService } from '@janhq/core'
import { useAtom } from 'jotai'
import { downloadedModelAtom } from '@helpers/atoms/DownloadedModel.atom'
import { extensionPoints } from '@plugin/index'
import { executeSerial } from '@services/pluginService'

export function useGetDownloadedModels() {
  const [downloadedModels, setDownloadedModels] = useAtom(downloadedModelAtom)

  useEffect(() => {
    getDownloadedModels().then((downloadedModels) => {
      setDownloadedModels(downloadedModels)
    })
  }, [setDownloadedModels])

  return { downloadedModels }
}

export async function getDownloadedModels(): Promise<AssistantModel[]> {
  if (!extensionPoints.get(ModelManagementService.GetFinishedDownloadModels)) {
    return []
  }
  const downloadedModels: AssistantModel[] = await executeSerial(
    ModelManagementService.GetFinishedDownloadModels
  )
  return downloadedModels ?? []
}

export async function getConfiguredModels(): Promise<Product[]> {
  return executeSerial(ModelManagementService.GetConfiguredModels)
}
