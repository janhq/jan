import { useAtomValue } from 'jotai'

import ThreadLeftPanel from '@/screens/Thread/ThreadLeftPanel'

import ThreadCenterPanel from './ThreadCenterPanel'
import EmptyModel from './ThreadCenterPanel/ChatBody/EmptyModel'
import ThreadRightPanel from './ThreadRightPanel'

import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'

const ThreadScreen = () => {
  const downloadedModels = useAtomValue(downloadedModelsAtom)

  return (
    <div className="relative flex h-full w-full flex-1 overflow-x-hidden">
      {!downloadedModels.length ? (
        <EmptyModel />
      ) : (
        <>
          <ThreadLeftPanel />
          <ThreadCenterPanel />
        </>
      )}
      <ThreadRightPanel />
    </div>
  )
}

export default ThreadScreen
