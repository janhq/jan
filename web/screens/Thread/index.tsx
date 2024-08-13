import { Fragment, useMemo } from 'react'

import {
  EngineStatus,
  RemoteEngine,
  RemoteEngines,
} from '@janhq/core'
import { useAtomValue } from 'jotai'

import useEngineQuery from '@/hooks/useEngineQuery'

import ThreadLeftPanel from '@/screens/Thread/ThreadLeftPanel'

import ThreadCenterPanel from './ThreadCenterPanel'
import EmptyModel from './ThreadCenterPanel/ChatBody/EmptyModel'
import ThreadRightPanel from './ThreadRightPanel'

import { waitingForCortexAtom } from '@/helpers/atoms/App.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const ThreadScreen = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const waitingForCortex = useAtomValue(waitingForCortexAtom)
  const { data: engineData } = useEngineQuery()

  const isAnyRemoteModelConfigured = useMemo(() => {
    if (!engineData) return false

    let result = false
    for (const engine of engineData) {
      if (RemoteEngines.includes(engine.name as RemoteEngine)) {
        if (engine.status === EngineStatus.Ready) {
          result = true
        }
      }
    }
    return result
  }, [engineData])

  const shouldShowEmptyModel = useMemo(
    () => !downloadedModels.length && !isAnyRemoteModelConfigured,
    [downloadedModels, isAnyRemoteModelConfigured]
  )

  if (waitingForCortex) return null

  return (
    <div className="relative flex h-full w-full flex-1 overflow-x-hidden">
      {shouldShowEmptyModel ? (
        <EmptyModel />
      ) : (
        <Fragment>
          <ThreadLeftPanel />
          <ThreadCenterPanel />
          <ThreadRightPanel />
        </Fragment>
      )}
    </div>
  )
}

export default ThreadScreen
