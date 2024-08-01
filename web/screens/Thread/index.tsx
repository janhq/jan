import { Fragment, useEffect } from 'react'

import { Model } from '@janhq/core'
import { useAtom, useAtomValue } from 'jotai'

import useCortex from '@/hooks/useCortex'
import useModels from '@/hooks/useModels'

import ThreadLeftPanel from '@/screens/Thread/ThreadLeftPanel'

import ThreadCenterPanel from './ThreadCenterPanel'
import EmptyModel from './ThreadCenterPanel/ChatBody/EmptyModel'
import ThreadRightPanel from './ThreadRightPanel'

import { waitingForCortexAtom } from '@/helpers/atoms/App.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import {
  isAnyRemoteModelConfiguredAtom,
  setUpRemoteModelStageAtom,
} from '@/helpers/atoms/SetupRemoteModel.atom'

const ThreadScreen = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const waitingForCortex = useAtomValue(waitingForCortexAtom)
  const isAnyRemoteModelConfigured = useAtomValue(
    isAnyRemoteModelConfiguredAtom
  )
  const { createModel } = useCortex()
  const { getModels } = useModels()

  const [{ metadata }] = useAtom(setUpRemoteModelStageAtom)

  useEffect(() => {
    if (isAnyRemoteModelConfigured) {
      createModel(metadata?.model as Model)
      getModels()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnyRemoteModelConfigured])

  if (waitingForCortex) return null

  return (
    <div className="relative flex h-full w-full flex-1 overflow-x-hidden">
      {!downloadedModels.length && !isAnyRemoteModelConfigured ? (
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
