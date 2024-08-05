import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { Message, TextContentBlock } from '@janhq/core'

import { Tooltip } from '@janhq/joi'
import hljs from 'highlight.js'

import { useAtomValue } from 'jotai'
import { FolderOpenIcon } from 'lucide-react'
import { Marked, Renderer } from 'marked'
import { markedHighlight } from 'marked-highlight'
import markedKatex from 'marked-katex-extension'

import { twMerge } from 'tailwind-merge'

import UserAvatar from '@/components/UserAvatar'

import LogoMark from '@/containers/Brand/Logo/Mark'

import useAssistantQuery from '@/hooks/useAssistantQuery'
import { useClipboard } from '@/hooks/useClipboard'
import { usePath } from '@/hooks/usePath'

import { displayDate } from '@/utils/datetime'

import { openFileTitle } from '@/utils/titleUtils'

import EditChatInput from '../EditChatInput'
import MessageToolbar from '../MessageToolbar'

import { editMessageAtom } from '@/helpers/atoms/ChatMessage.atom'

type Props = {
  isLatestMessage: boolean
  msg: Message
  onResendMessage: () => void
}

const SimpleTextMessage: React.FC<Props> = ({
  isLatestMessage,
  msg,
  onResendMessage,
}) => {
  const [text, setText] = useState('')
  const { data: assistants } = useAssistantQuery()
  const editMessage = useAtomValue(editMessageAtom)
  const clipboard = useClipboard({ timeout: 1000 })

  const senderName = useMemo(() => {
    if (msg.role === 'user') return msg.role
    const assistantId = msg.assistant_id
    if (!assistantId) return msg.role
    const assistant = assistants?.find(
      (assistant) => assistant.id === assistantId
    )
    return assistant?.name ?? msg.role
  }, [assistants, msg.assistant_id, msg.role])

  useEffect(() => {
    if (msg.content && msg.content.length > 0) {
      const message = msg.content[0]
      if (message && message.type === 'text') {
        const textBlockContent = message as TextContentBlock
        // Check for compatible message object type - There was a problem with legacy message object compatibility, which broke the app.
        if (typeof textBlockContent.text.value === 'string')
          setText(textBlockContent.text.value)
      }
    }
  }, [msg.content])

  const marked = useMemo(() => {
    const markedParser = new Marked(
      markedHighlight({
        langPrefix: 'hljs',
        highlight(code, lang) {
          if (lang === undefined || lang === '') {
            return hljs.highlightAuto(code).value
          }
          try {
            return hljs.highlight(code, { language: lang }).value
          } catch (err) {
            return hljs.highlight(code, { language: 'javascript' }).value
          }
        },
      }),
      {
        renderer: {
          link: (href, title, text) =>
            Renderer.prototype.link
              ?.apply(this, [href, title, text])
              .replace('<a', "<a target='_blank'"),
          code(code, lang) {
            return `
          <div class="relative code-block group/item overflow-auto">
            <button class='text-xs copy-action hidden group-hover/item:block p-2 rounded-lg absolute top-6 right-2'>
              ${
                clipboard.copied
                  ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check pointer-events-none text-green-600"><path d="M20 6 9 17l-5-5"/></svg>`
                  : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy pointer-events-none text-gray-400"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`
              }
            </button>
            <pre class="hljs">
              <code class="language-${lang ?? ''}">${code}</code>
            </pre>
          </div>
          `
          },
        },
      }
    )
    markedParser.use(markedKatex({ throwOnError: false }))
    return markedParser
  }, [clipboard.copied])
  const isUser = msg.role === 'user'
  const { onViewFileContainer } = usePath()
  const parsedText = useMemo(() => marked.parse(text), [marked, text])
  const [tokenCount, setTokenCount] = useState(0)
  const [lastTimestamp, setLastTimestamp] = useState<number | undefined>()
  const [tokenSpeed, setTokenSpeed] = useState(0)

  const codeBlockCopyEvent = useRef((e: Event) => {
    const target: HTMLElement = e.target as HTMLElement
    if (typeof target.className !== 'string') return null

    const isCopyActionClassName = target?.className.includes('copy-action')

    if (isCopyActionClassName) {
      const content = target?.parentNode?.querySelector('code')?.innerText ?? ''
      clipboard.copy(content)
    }
  })

  useEffect(() => {
    document.addEventListener('click', codeBlockCopyEvent.current)
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      document.removeEventListener('click', codeBlockCopyEvent.current)
    }
  }, [])

  useEffect(() => {
    if (msg.status !== 'in_progress') {
      return
    }
    const currentTimestamp = new Date().getTime() // Get current time in milliseconds
    if (!lastTimestamp) {
      // If this is the first update, just set the lastTimestamp and return
      if (msg.content && msg.content.length > 0) {
        const message = msg.content[0]
        if (message && message.type === 'text') {
          const textContentBlock = message as TextContentBlock
          if (textContentBlock.text.value !== '') {
            setLastTimestamp(currentTimestamp)
          }
        }
      }
      return
    }

    const timeDiffInSeconds = (currentTimestamp - lastTimestamp) / 1000 // Time difference in seconds
    const totalTokenCount = tokenCount + 1
    const averageTokenSpeed = totalTokenCount / timeDiffInSeconds // Calculate average token speed

    setTokenSpeed(averageTokenSpeed)
    setTokenCount(totalTokenCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.content])

  return (
    <div className="group relative mx-auto max-w-[700px] p-4">
      <div
        className={twMerge(
          'mb-2 flex items-center justify-start gap-x-2',
          !isUser && 'mt-2'
        )}
      >
        {isUser ? <UserAvatar /> : <LogoMark width={32} height={32} />}

        <div
          className={twMerge(
            'font-extrabold capitalize',
            isUser && 'text-gray-500'
          )}
        >
          {senderName}
        </div>
        <p className="text-xs font-medium text-gray-400">
          {displayDate(msg.created_at)}
        </p>
        <div
          className={twMerge(
            'absolute right-0 cursor-pointer transition-all',
            isLatestMessage && !isUser
              ? 'absolute -bottom-8 right-4'
              : 'hidden group-hover:absolute group-hover:right-4 group-hover:top-4 group-hover:flex'
          )}
        >
          <MessageToolbar
            message={msg}
            isLastMessage={isLatestMessage}
            onResendMessage={onResendMessage}
          />
        </div>
        {isLatestMessage &&
          (msg.status === 'in_progress' || tokenSpeed > 0) && (
            <p className="absolute right-8 text-xs font-medium text-[hsla(var(--text-secondary))]">
              Token Speed: {Number(tokenSpeed).toFixed(2)}t/s
            </p>
          )}
      </div>

      <div
        className={twMerge(
          'w-full',
          !isUser && !text.includes(' ') && 'break-all'
        )}
      >
        <Fragment>
          {msg.content[0]?.type === 'image_file' && (
            <div className="group/image relative mb-2 inline-flex cursor-pointer overflow-hidden rounded-xl">
              <div className="left-0 top-0 z-20 h-full w-full group-hover/image:inline-block">
                {/* <RelativeImage */}
                {/*   src={msg.content[0]?.text.annotations[0]} */}
                {/*   id={msg.id} */}
                {/*   onClick={() => */}
                {/*     onViewFile(`${msg.content[0]?.text.annotations[0]}`) */}
                {/*   } */}
                {/* /> */}
              </div>
              <Tooltip
                trigger={
                  <div
                    className="absolute right-2 top-2 z-20 hidden h-8 w-8 cursor-pointer items-center justify-center rounded-md bg-[hsla(var(--app-bg))] group-hover/image:flex"
                    onClick={onViewFileContainer}
                  >
                    <FolderOpenIcon size={20} />
                  </div>
                }
                content={<span>{openFileTitle()}</span>}
              />
            </div>
          )}

          {isUser ? (
            <Fragment>
              {editMessage === msg.id ? (
                <EditChatInput message={msg} />
              ) : (
                <div
                  className={twMerge(
                    'message flex flex-col gap-y-2 leading-relaxed',
                    isUser ? 'whitespace-pre-wrap break-words' : 'p-4'
                  )}
                >
                  {text}
                </div>
              )}
            </Fragment>
          ) : (
            <div
              className={twMerge(
                'message max-width-[100%] flex flex-col gap-y-2 overflow-auto leading-relaxed',
                isUser && 'whitespace-pre-wrap break-words'
              )}
              dangerouslySetInnerHTML={{ __html: parsedText }}
            />
          )}
        </Fragment>
      </div>
    </div>
  )
}

export default SimpleTextMessage
