/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useState } from 'react'

import hljs from 'highlight.js'

import { Marked } from 'marked'

import { markedHighlight } from 'marked-highlight'

import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'

import BubbleLoader from '@/containers/Loader/Bubble'

import { displayDate } from '@/utils/datetime'

import { MessageSenderType, MessageStatus } from '@/models/ChatMessage'

type Props = {
  avatarUrl: string
  senderName: string
  createdAt: number
  senderType: MessageSenderType
  status: MessageStatus
  text?: string
}

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs',
    highlight(code, lang) {
      if (lang === undefined || lang === '') {
        return hljs.highlightAuto(code).value
      }
      return hljs.highlight(code, { language: lang }).value
    },
  }),
  {
    renderer: {
      code(code, lang, escaped) {
        // Make a copy paste
        return `
        <pre class="hljs">
          <code class="language-${encodeURIComponent(lang ?? '')}">${
            escaped ? code : encodeURIComponent(code)
          }</code>
          </pre>`
      },
    },
  }
)

const SimpleTextMessage: React.FC<Props> = ({
  senderName,
  senderType,
  createdAt,
  // will use status as streaming text
  // status,
  text = '',
}) => {
  const parsedText = marked.parse(text)
  const isUser = senderType === 'user'

  return (
    <div className="mx-auto rounded-xl px-4 lg:w-3/4">
      <div
        className={twMerge(
          'mb-1 flex items-center justify-start gap-2',
          !isUser && 'mt-2'
        )}
      >
        {!isUser && <LogoMark width={20} />}
        <div className="text-sm font-extrabold ">{senderName}</div>
        <p className="text-xs font-medium">{displayDate(createdAt)}</p>
      </div>

      <div className={twMerge('w-full')}>
        {text === '' ? (
          <BubbleLoader />
        ) : (
          <>
            <div
              className={twMerge(
                'message flex flex-grow flex-col gap-y-2 text-[15px] font-normal leading-relaxed',
                isUser && 'whitespace-pre-wrap break-words'
              )}
              // eslint-disable-next-line @typescript-eslint/naming-convention
              dangerouslySetInnerHTML={{ __html: parsedText }}
            />
          </>
        )}
      </div>
    </div>
  )
}

export default React.memo(SimpleTextMessage)
