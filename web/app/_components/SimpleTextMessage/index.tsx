import React from 'react'
import { displayDate } from '@utils/datetime'
import Image from 'next/image'

import LoadingIndicator from '../LoadingIndicator'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'

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
  createdAt,
  senderType,
  avatarUrl = '',
  text = '',
}) => {
  const backgroundColor =
    senderType === MessageSenderType.User ? '' : 'bg-gray-100'

  const parsedText = marked.parse(text)

  return (
    <div
      className={`flex items-start gap-2 px-12 md:px-32 2xl:px-64 ${backgroundColor} py-5`}
    >
      <Image
        className="rounded-full"
        src={avatarUrl}
        width={32}
        height={32}
        alt=""
      />
      <div className="flex w-full flex-col gap-1">
        <div className="flex items-baseline justify-start gap-1">
          <div className="text-sm font-extrabold leading-[15.2px] text-[#1B1B1B] dark:text-[#d1d5db]">
            {senderName}
          </div>
          <div className="text-xs font-medium leading-[13.2px] text-gray-400">
            {displayDate(createdAt)}
          </div>
        </div>
        {text === '' ? (
          <LoadingIndicator />
        ) : (
          <span
            className="text-sm font-normal leading-loose"
            dangerouslySetInnerHTML={{ __html: parsedText }}
          />
        )}
      </div>
    </div>
  )
}

export default React.memo(SimpleTextMessage)
