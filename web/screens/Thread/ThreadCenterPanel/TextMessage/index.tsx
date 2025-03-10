import React, { useMemo } from 'react'

import { ChatCompletionRole, ContentType, ThreadMessage } from '@janhq/core'

import { useAtomValue } from 'jotai'
import 'katex/dist/katex.min.css'
import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { displayDate } from '@/utils/datetime'

import EditChatInput from '../EditChatInput'
import MessageToolbar from '../MessageToolbar'

import DocMessage from './DocMessage'
import ImageMessage from './ImageMessage'
import { MarkdownTextMessage } from './MarkdownTextMessage'
import ThinkingBlock from './ThinkingBlock'

import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import {
  editMessageAtom,
  tokenSpeedAtom,
} from '@/helpers/atoms/ChatMessage.atom'

import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import { chatWidthAtom } from '@/helpers/atoms/Setting.atom'

const MessageContainer: React.FC<
  ThreadMessage & { isCurrentMessage: boolean; index: number }
> = (props) => {
  const isUser = props.role === ChatCompletionRole.User
  const isSystem = props.role === ChatCompletionRole.System
  const editMessage = useAtomValue(editMessageAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)
  const tokenSpeed = useAtomValue(tokenSpeedAtom)
  const chatWidth = useAtomValue(chatWidthAtom)
  const selectedModel = useAtomValue(selectedModelAtom)

  const text = useMemo(
    () =>
      props.content.find((e) => e.type === ContentType.Text)?.text?.value ?? '',
    [props.content]
  )

  const { reasoningSegment, textSegment } = useMemo(() => {
    const isThinking = text.includes('<think>') && !text.includes('</think>')
    if (isThinking) return { reasoningSegment: text, textSegment: '' }

    const match = text.match(/<think>([\s\S]*?)<\/think>/)
    if (match?.index === undefined)
      return { reasoningSegment: undefined, textSegment: text }

    const splitIndex = match.index + match[0].length
    return {
      reasoningSegment: text.slice(0, splitIndex),
      textSegment: text.slice(splitIndex),
    }
  }, [text])

  const image = useMemo(
    () =>
      props.content.find((e) => e.type === ContentType.Image)?.image_url?.url,
    [props.content]
  )

  const attachedFile = useMemo(() => 'attachments' in props, [props])

  return (
    <div
      className={twMerge(
        'group relative mx-auto px-4 py-2',
        chatWidth === 'compact' && 'max-w-[700px]',
        isUser && 'pb-4 pt-0'
      )}
    >
      <div
        className={twMerge(
          'mb-2 flex items-center justify-start',
          !isUser && 'mt-2 gap-x-2'
        )}
      >
        {!isUser && !isSystem && <LogoMark width={28} />}

        <div
          className={twMerge(
            'font-extrabold capitalize',
            isUser && 'text-gray-500'
          )}
        >
          {!isUser && (
            <>
              {props.metadata && 'model' in props.metadata
                ? (props.metadata?.model as string)
                : props.isCurrentMessage
                  ? selectedModel?.name
                  : (activeAssistant?.assistant_name ?? props.role)}
            </>
          )}
        </div>

        <p className="text-xs font-medium text-gray-400">
          {props.created_at &&
            displayDate(props.created_at ?? Date.now() / 1000)}
        </p>
      </div>

      <div className="flex w-full flex-col ">
        <div
          className={twMerge(
            'absolute right-0 order-1 flex cursor-pointer items-center justify-start gap-x-2 transition-all',
            isUser
              ? twMerge(
                  'hidden group-hover:absolute group-hover:right-4 group-hover:top-4 group-hover:z-50 group-hover:flex',
                  image && 'group-hover:-top-2'
                )
              : 'relative left-0 order-2 flex w-full justify-between opacity-0 group-hover:opacity-100',
            props.isCurrentMessage && 'opacity-100'
          )}
        >
          <div>
            {((!!tokenSpeed &&
              tokenSpeed.message === props.id &&
              tokenSpeed.tokenSpeed > 0) ||
              (props.metadata &&
                'token_speed' in props.metadata &&
                !!props.metadata?.token_speed)) && (
              <p className="text-xs font-medium text-[hsla(var(--text-secondary))]">
                Token Speed:{' '}
                {Number(
                  props.metadata?.token_speed ?? tokenSpeed?.tokenSpeed
                ).toFixed(2)}
                t/s
              </p>
            )}
          </div>

          {editMessage !== props.id && <MessageToolbar message={props} />}
        </div>
        <div
          className={twMerge(
            'order-1 w-full',
            !isUser && !text.includes(' ') && 'break-all',
            props.isCurrentMessage && !isUser && 'order-1'
          )}
        >
          <>
            {image && <ImageMessage image={image} />}
            {attachedFile && (
              <DocMessage
                id={props.attachments?.[0]?.file_id ?? props.id}
                metadata={props.metadata}
              />
            )}

            {editMessage === props.id ? (
              <div>
                <EditChatInput message={props} />
              </div>
            ) : (
              <div
                className={twMerge(
                  'message max-width-[100%] flex flex-col gap-y-2 overflow-x-auto overflow-y-hidden leading-relaxed'
                )}
                dir="ltr"
              >
                {reasoningSegment && (
                  <ThinkingBlock
                    id={props.index}
                    text={reasoningSegment}
                    status={props.status}
                  />
                )}
                <MarkdownTextMessage text={textSegment} isUser={isUser} />
              </div>
            )}
          </>
        </div>
      </div>
    </div>
  )
}

export default React.memo(MessageContainer)
