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
      <p>(Optional) Give your assistant an initial prompt.</p>
      {!isSettingInstruction && activeConvoId && (
        <>
          <Button
            themes={'outline'}
            className="w-32"
            onClick={() => setIsSettingInstruction(true)}
          >
            Give Instructions
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
            Give Instructions
          </Button>
        </div>
      )}
    </div>
  )
}
export default ChatInstruction
