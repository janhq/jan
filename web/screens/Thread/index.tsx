import ThreadLeftPanel from '@/screens/Thread/ThreadLeftPanel'

import ThreadCenterPanel from './ThreadCenterPanel'
import ThreadRightPanel from './ThreadRightPanel'

const ThreadScreen = () => {
  return (
    <div className="relative flex h-full w-full flex-1 overflow-x-hidden">
      <ThreadLeftPanel />
      <ThreadCenterPanel />
      <ThreadRightPanel />
    </div>
  )
}

export default ThreadScreen
