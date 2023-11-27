import { useState } from 'react'

import {
  ChatCompletionRole,
  EventName,
  MessageStatus,
  ThreadMessage,
  events,
} from '@janhq/core'

import { Button, Textarea } from '@janhq/uikit'
import { useAtomValue } from 'jotai'

import { getActiveConvoIdAtom } from '@/helpers/atoms/Conversation.atom'

const ChatInstruction = () => {
  const activeConvoId = useAtomValue(getActiveConvoIdAtom)
  const [isSettingInstruction, setIsSettingInstruction] = useState(false)
  const [instruction, setInstruction] = useState('')
  const setSystemPrompt = (instruction: string) => {
    const message: ThreadMessage = {
      id: 'system-prompt',
      content: instruction,
      role: ChatCompletionRole.System,
      status: MessageStatus.Ready,
      createdAt: new Date().toISOString(),
      threadId: activeConvoId,
    }
    events.emit(EventName.OnNewMessageResponse, message)
    events.emit(EventName.OnMessageResponseFinished, message)
  }
  return (
    <div className="mx-auto mb-20 flex flex-col space-y-2">
      {!isSettingInstruction && activeConvoId && (
        <>
          <p>
            What does this Assistant do? How does it behave? What should it
            avoid doing?
          </p>
          <Button
            themes={'outline'}
            className="w-32"
            onClick={() => setIsSettingInstruction(true)}
          >
            Give Instruction
          </Button>
        </>
      )}
      {isSettingInstruction && (
        <div className="space-y-4">
          <Textarea
            placeholder={`Enter your instructions`}
            onChange={(e) => {
              setInstruction(e.target.value)
            }}
            className="h-24"
          />
          <Button
            themes={'outline'}
            className="w-32"
            onClick={() => setSystemPrompt(instruction)}
          >
            Set Instruction
          </Button>
        </div>
      )}
    </div>
  )
}
export default ChatInstruction
