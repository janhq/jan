import { Fragment, useEffect } from 'react'

import { Model } from '@janhq/core'
import { useAtom, useAtomValue } from 'jotai'

import useCortex from '@/hooks/useCortex'
import useModels from '@/hooks/useModels'

import ThreadLeftPanel from '@/screens/Thread/ThreadLeftPanel'

import ThreadCenterPanel from './ThreadCenterPanel'
import EmptyModel from './ThreadCenterPanel/ChatBody/EmptyModel'
import ThreadRightPanel from './ThreadRightPanel'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import {
  isSomeApiKeyAddedAtom,
  setUpRemoteModelStageAtom,
} from '@/helpers/atoms/SetupRemoteModel.atom'

const ThreadScreen = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)
  const isSomeApiKeyAdded = useAtomValue(isSomeApiKeyAddedAtom)
  const { createModel } = useCortex()
  const { getModels } = useModels()

  const [{ metadata }] = useAtom(setUpRemoteModelStageAtom)

  useEffect(() => {
    if (isSomeApiKeyAdded) {
      createModel(metadata?.model as Model)
      getModels()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSomeApiKeyAdded])

  return (
    <div className="relative flex h-full w-full flex-1 overflow-x-hidden">
      {!downloadedModels.length && !isSomeApiKeyAdded ? (
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
