import {
  MainViewState,
  getMainViewStateAtom,
  setMainViewStateAtom,
} from '@/_helpers/atoms/MainView.atom'
import Image from 'next/image'
import CompactLogo from '../CompactLogo'
import {
  ChatBubbleOvalLeftEllipsisIcon,
  Cog8ToothIcon,
  CpuChipIcon,
  CubeTransparentIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline'
import { useAtomValue, useSetAtom } from 'jotai'
import { showingBotListModalAtom } from '@/_helpers/atoms/Modal.atom'
import { useGetDownloadedModels } from '@/_hooks/useGetDownloadedModels'
import useGetBots from '@/_hooks/useGetBots'

const menu = [
  {
    name: 'Explore Models',
    iconComponent: <CpuChipIcon width={24} height={24} color="#C7D2FE" />,
    state: MainViewState.ExploreModel,
  },
  {
    name: 'My Models',
    iconComponent: <Squares2X2Icon width={24} height={24} color="#C7D2FE" />,
    state: MainViewState.MyModel,
  },
  {
    name: 'Settings',
    iconComponent: <Cog8ToothIcon width={24} height={24} color="#C7D2FE" />,
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
    if (currentState === MainViewState.Conversation) return
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
    <nav className="flex h-screen w-20 flex-col bg-gray-900">
      <div className='mx-auto mt-4'>
      <CompactLogo />
      </div>

      <div className="flex w-full flex-1 flex-col items-center justify-between px-3 py-6">
        <div className="flex flex-1 flex-col gap-2">
          <button
            onClick={onConversationClick}
            className={`rounded-lg p-4 ${bgColor} hover:bg-gray-400`}
          >
            <ChatBubbleOvalLeftEllipsisIcon
              width={24}
              height={24}
              color="#C7D2FE"
            />
          </button>
          <button
            onClick={onBotListClick}
            className={`rounded-lg p-4 hover:bg-gray-400`}
          >
            <CubeTransparentIcon width={24} height={24} color="#C7D2FE" />
          </button>
        </div>
        <ul className="flex flex-col gap-3">
          {menu.map((item) => {
            const bgColor = currentState === item.state ? 'bg-gray-500' : ''
            return (
              <li
                role="button"
                data-testid={item.name}
                key={item.name}
                className={`rounded-lg p-4 ${bgColor} hover:bg-gray-400`}
                onClick={() => onMenuClick(item.state)}
              >
                {item.iconComponent}
              </li>
            )
          })}
        </ul>
      </div>

      {/* User avatar */}
      <div className="flex items-center justify-center pb-5">
        <Image src={'/icons/avatar.svg'} width={40} height={40} alt="" />
      </div>
    </nav>
  )
}

export default LeftRibbonNav
