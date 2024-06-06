import { useCallback, useEffect, useRef } from 'react'

import { Model } from '@janhq/core'

import { useAtomValue } from 'jotai'

import useCortex from './useCortex'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

export function useActiveModel() {
  const downloadedModels = useAtomValue(downloadedModelsAtom)

  const downloadedModelsRef = useRef<Model[]>([])
  const { startModel: startCortexModel } = useCortex()

  useEffect(() => {
    downloadedModelsRef.current = downloadedModels
  }, [downloadedModels])

  const startModel = useCallback(
    async (modelId: string) => {
      return startCortexModel(modelId)
    },
    [startCortexModel]
  )

  return { startModel }
}
