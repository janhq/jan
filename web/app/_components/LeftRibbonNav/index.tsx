import {
  MainViewState,
  getMainViewStateAtom,
  setMainViewStateAtom,
} from '@helpers/atoms/MainView.atom'

import CompactLogo from '../../../containers/Logo/CompactLogo'
import {
  ChatBubbleOvalLeftEllipsisIcon,
  Cog8ToothIcon,
  CpuChipIcon,
  CubeTransparentIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline'
import { useAtomValue, useSetAtom } from 'jotai'
import { showingBotListModalAtom } from '@helpers/atoms/Modal.atom'
import { useGetDownloadedModels } from '@hooks/useGetDownloadedModels'
import useGetBots from '@hooks/useGetBots'

import { Icons, Toggle } from '@uikit'

const menu = [
  // {
  //   name: 'Explore Models',
  //   icon: <CpuChipIcon />,
  //   state: MainViewState.ExploreModel,
  // },
  {
    name: 'My Models',
    icon: <Icons name="layout-grid" />,
    state: MainViewState.MyModel,
  },
  {
    name: 'Settings',
    icon: <Icons name="settings" />,
    state: MainViewState.Setting,
  },
]

const LeftRibbonNav: React.FC = () => {
  const currentState = useAtomValue(getMainViewStateAtom)
  const setMainViewState = useSetAtom(setMainViewStateAtom)
  const setBotListModal = useSetAtom(showingBotListModalAtom)
  const { downloadedModels } = useGetDownloadedModels()
  const { getAllBots } = useGetBots()

  const onMenuClick = (mainViewState: MainViewState) => {
    if (currentState === mainViewState) return
    setMainViewState(mainViewState)
  }

  const isConversationView = currentState === MainViewState.Conversation
  const bgColor = isConversationView ? 'bg-gray-500' : ''

  const onConversationClick = () => {
    // if (currentState === MainViewState.Conversation) return
    setMainViewState(MainViewState.Conversation)
  }

  const onBotListClick = async () => {
    const bots = await getAllBots()
    if (bots.length === 0) {
      alert('You have no bot')
      return
    }

    if (downloadedModels.length === 0) {
      alert('You have no model downloaded')
      return
    }

    setBotListModal(true)
  }

  return (
    <nav className="flex h-screen flex-shrink-0 flex-col items-center pt-10">
      <CompactLogo />
      <div className="flex w-full flex-1 flex-col items-center justify-between">
        <div className="flex flex-col pt-4">
          <button onClick={onConversationClick}>
            <ChatBubbleOvalLeftEllipsisIcon
              width={24}
              height={24}
              color="text-white"
            />
          </button>
          <button onClick={onBotListClick}>
            <CubeTransparentIcon />
          </button>
        </div>
        <ul className="flex flex-col gap-3 py-8">
          {menu.map((item) => {
            const bgColor = currentState === item.state ? 'bg-gray-500' : ''
            return (
              <li
                role="button"
                key={item.name}
                className="item-center flex gap-x-2"
                onClick={() => onMenuClick(item.state)}
              >
                {item.icon}
                <span className="text-xs">{item.name}</span>
              </li>
            )
          })}
        </ul>
      </div>
      {/* User avatar */}
      {/* <div className="pb-5 flex items-center justify-center">
        <Image src={"/icons/avatar.svg"} width={40} height={40} alt="" />
      </div> */}
    </nav>
  )
}

export default LeftRibbonNav
