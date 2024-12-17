import { memo } from 'react'

import { useStarterScreen } from '@/hooks/useStarterScreen'

import ThreadLeftPanel from '@/screens/Thread/ThreadLeftPanel'

import ThreadCenterPanel from './ThreadCenterPanel'
import OnDeviceStarterScreen from './ThreadCenterPanel/ChatBody/OnDeviceStarterScreen'
import ModalCleanThread from './ThreadLeftPanel/ModalCleanThread'
import ModalDeleteThread from './ThreadLeftPanel/ModalDeleteThread'
import ModalEditTitleThread from './ThreadLeftPanel/ModalEditTitleThread'
import ThreadRightPanel from './ThreadRightPanel'

type Props = {
  isShowStarterScreen: boolean
}

const ThreadPanels = memo(({ isShowStarterScreen }: Props) => {
  return isShowStarterScreen ? (
    <OnDeviceStarterScreen isShowStarterScreen={isShowStarterScreen} />
  ) : (
    <>
      <ThreadLeftPanel />
      <ThreadCenterPanel />
      <ThreadRightPanel />
    </>
  )
})

const WelcomeController = () => {
  const { isShowStarterScreen } = useStarterScreen()
  return <ThreadPanels isShowStarterScreen={isShowStarterScreen} />
}

const ThreadScreen = () => {
  return (
    <div className="relative flex h-full w-full flex-1 overflow-x-hidden">
      <WelcomeController />

      {/* Showing variant modal action for thread screen */}
      <ModalEditTitleThread />
      <ModalCleanThread />
      <ModalDeleteThread />
    </div>
  )
}

export default memo(ThreadScreen)
