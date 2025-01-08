import { useMemo } from 'react'

import { InferenceEngine, EngineConfig } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { isLocalEngine } from '@/utils/modelEngine'

import { installedEnginesAtom } from '@/helpers/atoms/Engines.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { threadsAtom } from '@/helpers/atoms/Thread.atom'

export function useStarterScreen() {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const threads = useAtomValue(threadsAtom)

  const engines = useAtomValue(installedEnginesAtom)

  const remoteEngines =
    engines &&
    Object.entries(engines)
      .filter(([key]) => !isLocalEngine(key as InferenceEngine))
      .flatMap(([_, engineArray]) => engineArray as EngineConfig)

  const isDownloadALocalModel = useMemo(
    () => downloadedModels.some((x) => isLocalEngine(x.engine)),
    [downloadedModels]
  )

  const isAnyRemoteModelConfigured = useMemo(
    () => (remoteEngines ?? []).some((x) => x.api_key && x.api_key.length > 0),
    [remoteEngines]
  )

  console.log(isAnyRemoteModelConfigured)

  const isShowStarterScreen = useMemo(
    () =>
      !isAnyRemoteModelConfigured && !isDownloadALocalModel && !threads.length,
    [isAnyRemoteModelConfigured, isDownloadALocalModel, threads]
  )

  return {
    isShowStarterScreen,
  }
}
