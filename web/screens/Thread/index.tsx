import { useStarterScreen } from '@/hooks/useOnboarding'

import ThreadLeftPanel from '@/screens/Thread/ThreadLeftPanel'

import ThreadCenterPanel from './ThreadCenterPanel'
import OnDeviceStarterScreen from './ThreadCenterPanel/ChatBody/OnDeviceStarterScreen'
import ModalCleanThread from './ThreadLeftPanel/ModalCleanThread'
import ModalDeleteThread from './ThreadLeftPanel/ModalDeleteThread'
import ModalEditTitleThread from './ThreadLeftPanel/ModalEditTitleThread'
import ThreadRightPanel from './ThreadRightPanel'

const ThreadScreen = () => {
  // Temporarily disabled the starter screen. Later, we will use isShowStarterScreen instead of temporaryDisabledStarterScreen
  const { extensionHasSettings, temporaryDisabledStartrScreen } =
    useStarterScreen()
  return (
    <div className="relative flex h-full w-full flex-1 overflow-x-hidden">
      {temporaryDisabledStartrScreen ? (
        <>
          <OnDeviceStarterScreen extensionHasSettings={extensionHasSettings} />
        </>
      ) : (
        <>
          <ThreadLeftPanel />
          <ThreadCenterPanel />
          <ThreadRightPanel />
        </>
      )}

      {/* Showing variant modal action for thread screen */}
      <ModalEditTitleThread />
      <ModalCleanThread />
      <ModalDeleteThread />
    </div>
  )
}

export default ThreadScreen
