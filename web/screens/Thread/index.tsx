import { Fragment, useMemo } from 'react'

import { EngineStatus, RemoteEngines } from '@janhq/core'
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

    for (const engine of engineData) {
      const remoteEngine = RemoteEngines.find((remoteEngine) => {
        remoteEngine === engine.name
      })
      if (!remoteEngine) continue
      if (engine.status === EngineStatus.Ready) return true
    }
    return false
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
        </Fragment>
      )}
      <ThreadRightPanel />
    </div>
  )
}

export default ThreadScreen
