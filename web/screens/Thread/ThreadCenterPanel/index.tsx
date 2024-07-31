import { useAtomValue } from 'jotai'

import CenterPanelContainer from '@/containers/CenterPanelContainer'
import GenerateResponse from '@/containers/Loader/GenerateResponse'
import ModelStart from '@/containers/Loader/ModelStart'

import useSendMessage from '@/hooks/useSendMessage'

import ChatBody from '@/screens/Thread/ThreadCenterPanel/ChatBody'

import ChatInput from './ChatInput'

import {
  isGeneratingResponseAtom,
  activeThreadAtom,
  isLoadingModelAtom,
} from '@/helpers/atoms/Thread.atom'

const ThreadCenterPanel: React.FC = () => {
  const { sendMessage, stopInference, resendMessage } = useSendMessage()
  const activeThread = useAtomValue(activeThreadAtom)
  const isLoadingModel = useAtomValue(isLoadingModelAtom)

  const isGeneratingResponse = useAtomValue(isGeneratingResponseAtom)

  return (
    <CenterPanelContainer>
      <div className="relative flex h-full w-full flex-col outline-none">
        <div className="flex h-full w-full flex-col justify-between">
          {activeThread && (
            <div className="flex h-full w-full overflow-x-hidden">
              <ChatBody onResendMessage={resendMessage} />
            </div>
          )}

          {isGeneratingResponse && <GenerateResponse />}
          {isLoadingModel && <ModelStart />}

          {activeThread && (
            <ChatInput
              sendMessage={sendMessage}
              stopInference={stopInference}
            />
          )}
        </div>
      </div>
    </CenterPanelContainer>
  )
}

export default ThreadCenterPanel
