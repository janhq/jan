import React, { Fragment } from 'react'

import hljs from 'highlight.js'
import { Marked } from 'marked'

import { markedHighlight } from 'marked-highlight'

import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'

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
  // markedHighlight({
  //   langPrefix: 'hljs',
  //   highlight(code, lang) {
  //     if (lang === undefined || lang === '') {
  //       return hljs.highlightAuto(code).value
  //     }
  //     return hljs.highlight(code, { language: lang }).value
  //   },
  // }),
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext'
      return hljs.highlight(code, { language }).value
    },
  }),
  {
    renderer: {
      code(code, lang, escaped) {
        return `<pre class="hljs"><code class="language-${encodeURIComponent(
          lang ?? ''
        )}">${escaped ? code : encodeURIComponent(code)}</code></pre>`
      },
    },
  }
)

const SimpleTextMessage: React.FC<Props> = ({
  senderName,
  senderType,
  createdAt,
  text = '',
}) => {
  const parsedText = marked.parse(text)
  const isUser = senderType === 'user'

  return (
    <div className="mx-auto flex w-full flex-col items-start gap-1 rounded-xl px-4 lg:w-3/4">
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

      <div className="w-full">
        {text === '' ? (
          <LoadingIndicator />
        ) : (
          <>
            <span
              className="message text-[15px] font-normal leading-relaxed"
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
