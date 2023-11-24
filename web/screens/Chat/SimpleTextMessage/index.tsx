/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useContext } from 'react'

import { ChatCompletionRole, MessageStatus, ThreadMessage } from '@janhq/core'

import hljs from 'highlight.js'

import { MoreVertical } from 'lucide-react'
import { Marked } from 'marked'

import { markedHighlight } from 'marked-highlight'

import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'

import BubbleLoader from '@/containers/Loader/Bubble'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { displayDate } from '@/utils/datetime'

import MessageToolbar from '../MessageToolbar'

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

const SimpleTextMessage: React.FC<ThreadMessage> = (props) => {
  const { experimentalFeatureEnabed } = useContext(FeatureToggleContext)
  const parsedText = marked.parse(props.content ?? '')
  const isUser = props.role === ChatCompletionRole.User
  const isSystem = props.role === ChatCompletionRole.System

  return (
    <div className="group mx-auto rounded-xl px-4 lg:w-3/4">
      <div
        className={twMerge(
          'mb-1 flex items-center justify-start gap-2',
          !isUser && 'mt-2'
        )}
      >
        {!isUser && !isSystem && <LogoMark width={20} />}
        <div className="text-sm font-extrabold capitalize">{props.role}</div>
        <p className="text-xs font-medium">{displayDate(props.createdAt)}</p>

        {experimentalFeatureEnabed && (
          <div className="hidden cursor-pointer group-hover:flex">
            <MessageToolbar message={props} />
          </div>
        )}
      </div>

      <div className={twMerge('w-full')}>
        {props.status === MessageStatus.Pending &&
        (!props.content || props.content === '') ? (
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
