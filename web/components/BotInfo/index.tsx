import { useAtomValue } from 'jotai'

import { MainViewState } from '@/constants/screens'

import useCreateConversation from '@/hooks/useCreateConversation'

import useDeleteBot from '@/hooks/useDeleteBot'

import { useMainViewState } from '@/hooks/useMainViewState'

import ExpandableHeader from '../ExpandableHeader'
import PrimaryButton from '../PrimaryButton'

import { activeBotAtom } from '@/helpers/atoms/Bot.atom'

const BotInfo: React.FC = () => {
  const { deleteBot } = useDeleteBot()
  const { createConvoByBot } = useCreateConversation()
  const { setMainViewState } = useMainViewState()
  const botInfo = useAtomValue(activeBotAtom)
  if (!botInfo) return null

  const onNewChatClicked = () => {
    if (!botInfo) {
      alert('No bot selected')
      return
    }

    createConvoByBot(botInfo)
  }

  const onDeleteBotClick = async () => {
    // TODO: display confirmation diaglog
    const result = await deleteBot(botInfo._id)
    if (result === 'success') {
      setMainViewState(MainViewState.Welcome)
    }
  }

  return (
    <div className="mx-1 my-1 flex flex-col gap-2">
      <ExpandableHeader title="BOT INFO" />

      <div className="flex flex-col">
        <label className="mb-2">{botInfo.name}</label>
        <span className="text-muted-foreground">{botInfo.description}</span>
      </div>

      <div className="flex w-full flex-col space-y-2">
        <PrimaryButton onClick={onNewChatClicked} title="New chat" />
        <PrimaryButton
          title="Delete bot"
          onClick={onDeleteBotClick}
          className="bg-red-500 hover:bg-red-400"
        />
      </div>
    </div>
  )
}

export default BotInfo
