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

import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import {
  editMessageAtom,
  tokenSpeedAtom,
} from '@/helpers/atoms/ChatMessage.atom'

import { chatWidthAtom } from '@/helpers/atoms/Setting.atom'

const MessageContainer: React.FC<
  ThreadMessage & { isCurrentMessage: boolean }
> = (props) => {
  const isUser = props.role === ChatCompletionRole.User
  const isSystem = props.role === ChatCompletionRole.System
  const editMessage = useAtomValue(editMessageAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)
  const tokenSpeed = useAtomValue(tokenSpeedAtom)
  const chatWidth = useAtomValue(chatWidthAtom)

  const text = useMemo(
    () =>
      props.content.find((e) => e.type === ContentType.Text)?.text?.value ?? '',
    [props.content]
  )

  const image = useMemo(
    () =>
      props.content.find((e) => e.type === ContentType.Image)?.image_url?.url,
    [props.content]
  )

  const attachedFile = useMemo(() => 'attachments' in props, [props])

  return (
    <div
      className={twMerge(
        'group relative mx-auto p-4',
        chatWidth === 'compact' && 'max-w-[700px]'
      )}
    >
      <div
        className={twMerge(
          'mb-2 flex items-center justify-start gap-x-2',
          !isUser && 'mt-2'
        )}
      >
        {!isUser && !isSystem && <LogoMark width={28} />}
        {isUser && (
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsla(var(--app-border))] last:border-none">
            <svg
              width="12"
              height="16"
              viewBox="0 0 12 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 0.497864C4.34315 0.497864 3 1.84101 3 3.49786C3 5.15472 4.34315 6.49786 6 6.49786C7.65685 6.49786 9 5.15472 9 3.49786C9 1.84101 7.65685 0.497864 6 0.497864ZM9.75 7.99786L2.24997 7.99787C1.00734 7.99787 0 9.00527 0 10.2479C0 11.922 0.688456 13.2633 1.81822 14.1701C2.93013 15.0625 4.42039 15.4979 6 15.4979C7.57961 15.4979 9.06987 15.0625 10.1818 14.1701C11.3115 13.2633 12 11.922 12 10.2479C12 9.00522 10.9926 7.99786 9.75 7.99786Z"
                fill="#9CA3AF"
              />
            </svg>
          </div>
        )}

        <div
          className={twMerge(
            'font-extrabold capitalize',
            isUser && 'text-gray-500'
          )}
        >
          {isUser
            ? props.role
            : (activeAssistant?.assistant_name ?? props.role)}
        </div>
        <p className="text-xs font-medium text-gray-400">
          {props.created_at &&
            displayDate(props.created_at ?? Date.now() / 1000)}
        </p>
      </div>

      <div className="flex w-full flex-col ">
        <div
          className={twMerge(
            'absolute right-0 order-1 mt-2 flex cursor-pointer items-center justify-start gap-x-2 transition-all',
            props.isCurrentMessage && !isUser
              ? 'relative left-0 order-2 flex w-full justify-between'
              : 'hidden group-hover:absolute group-hover:right-4 group-hover:top-4 group-hover:flex'
          )}
        >
          <div>
            {tokenSpeed &&
              tokenSpeed.message === props.id &&
              tokenSpeed.tokenSpeed > 0 && (
                <p className="text-xs font-medium text-[hsla(var(--text-secondary))]">
                  Token Speed: {Number(tokenSpeed.tokenSpeed).toFixed(2)}t/s
                </p>
              )}
          </div>

          <MessageToolbar message={props} />
        </div>
        <div
          className={twMerge(
            'order-2 w-full',
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
                <MarkdownTextMessage
                  id={props.id}
                  text={text}
                  isUser={isUser}
                />
              </div>
            )}
          </>
        </div>
      </div>
    </div>
  )
}

export default React.memo(MessageContainer)
