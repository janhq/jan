import React, { Fragment } from 'react'

// import Image from 'next/image'

import hljs from 'highlight.js'
import { Marked } from 'marked'

import { markedHighlight } from 'marked-highlight'

import { twMerge } from 'tailwind-merge'

import { displayDate } from '@/utils/datetime'

import LoadingIndicator from '../../../components/LoadingIndicator'

import { MessageSenderType } from '@/models/ChatMessage'

type Props = {
  avatarUrl: string
  senderName: string
  createdAt: number
  senderType: MessageSenderType
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
        return `<pre class="hljs"><code class="language-${escape(
          lang ?? ''
        )}">${escaped ? code : escape(code)}</code></pre>`
      },
    },
  }
)

const SimpleTextMessage: React.FC<Props> = ({
  senderName,
  senderType,
  createdAt,
  avatarUrl = '',
  text = '',
}) => {
  const parsedText = marked.parse(text)
  const isUser = senderType === 'user'

  return (
    <Fragment>
      <div
        className={twMerge(
          'mb-1 ml-auto flex items-baseline justify-start gap-2',
          isUser && 'justify-end'
        )}
      >
        <div className="text-sm font-extrabold ">{senderName}</div>
        <div className="text-xs font-medium">{displayDate(createdAt)}</div>
      </div>
      <div
        className={twMerge(
          'flex w-max max-w-[75%] items-start gap-2 rounded-xl bg-muted px-3 py-2',
          isUser &&
            'ml-auto flex w-max max-w-[75%] items-start gap-2 rounded-xl bg-primary px-3 py-2'
        )}
      >
        {/* {!isUser && (
        <Image
          className="rounded-full"
          src={avatarUrl}
          width={32}
          height={32}
          alt=""
        />
      )} */}

        <div className="flex w-full flex-col gap-1">
          {text === '' ? (
            <LoadingIndicator />
          ) : (
            <span
              className={twMerge(
                'message font-normal leading-normal',
                isUser && 'is-user'
              )}
              // eslint-disable-next-line @typescript-eslint/naming-convention
              dangerouslySetInnerHTML={{ __html: parsedText }}
            />
          )}
        </div>
      </div>
    </Fragment>
  )
}

export default React.memo(SimpleTextMessage)
