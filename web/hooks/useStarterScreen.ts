/* eslint-disable @typescript-eslint/no-unused-vars */
import { useMemo } from 'react'

import { InferenceEngine, EngineConfig } from '@janhq/core'
import { useAtomValue } from 'jotai'

import { isLocalEngine } from '@/utils/modelEngine'

import { useGetEngines } from './useEngineManagement'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { threadsAtom } from '@/helpers/atoms/Thread.atom'

export function useStarterScreen() {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const threads = useAtomValue(threadsAtom)

  const { engines } = useGetEngines()

  const remoteEngines =
    engines &&
    Object.entries(engines)
      .filter(([key]) => !isLocalEngine(engines, key as InferenceEngine))
      .flatMap(([_, engineArray]) => engineArray as EngineConfig)

  const isDownloadALocalModel = useMemo(
    () =>
      downloadedModels.some((x) => engines && isLocalEngine(engines, x.engine)),
    [engines, downloadedModels]
  )

  const isAnyRemoteModelConfigured = useMemo(
    () => (remoteEngines ?? []).some((x) => x.api_key && x.api_key.length > 0),
    [remoteEngines]
  )

  const isShowStarterScreen = useMemo(
    () =>
      !isAnyRemoteModelConfigured && !isDownloadALocalModel && !threads.length,
    [isAnyRemoteModelConfigured, isDownloadALocalModel, threads]
  )

  return {
    isShowStarterScreen,
  }
}
