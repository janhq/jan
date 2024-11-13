/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/naming-convention */
import React, { useEffect, useState } from 'react'

import Markdown from 'react-markdown'

import {
  ChatCompletionRole,
  ContentType,
  MessageStatus,
  ThreadMessage,
} from '@janhq/core'

import { Tooltip } from '@janhq/joi'

import { useAtomValue } from 'jotai'
import { FolderOpenIcon } from 'lucide-react'
import rehypeHighlight from 'rehype-highlight'
import rehypeHighlightCodeLines from 'rehype-highlight-code-lines'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { useClipboard } from '@/hooks/useClipboard'
import { usePath } from '@/hooks/usePath'

import { getLanguageFromExtension } from '@/utils/codeLanguageExtension'
import { toGibibytes } from '@/utils/converter'
import { displayDate } from '@/utils/datetime'

import { openFileTitle } from '@/utils/titleUtils'

import EditChatInput from '../EditChatInput'
import Icon from '../FileUploadPreview/Icon'
import MessageToolbar from '../MessageToolbar'

import { RelativeImage } from './RelativeImage'

import {
  editMessageAtom,
  getCurrentChatMessagesAtom,
} from '@/helpers/atoms/ChatMessage.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

const SimpleTextMessage: React.FC<ThreadMessage> = (props) => {
  let text = ''
  const isUser = props.role === ChatCompletionRole.User
  const isSystem = props.role === ChatCompletionRole.System
  const editMessage = useAtomValue(editMessageAtom)
  const activeThread = useAtomValue(activeThreadAtom)

  if (props.content && props.content.length > 0) {
    text = props.content[0]?.text?.value ?? ''
  }

  const clipboard = useClipboard({ timeout: 1000 })

  function extractCodeLines(node: { children: { children: any[] }[] }) {
    const codeLines: any[] = []

    // Helper function to extract text recursively from children
    function getTextFromNode(node: {
      type: string
      value: any
      children: any[]
    }): string {
      if (node.type === 'text') {
        return node.value
      } else if (node.children) {
        return node.children.map(getTextFromNode).join('')
      }
      return ''
    }

    // Traverse each line in the <code> block
    node.children[0].children.forEach(
      (lineNode: {
        type: string
        tagName: string
        value: any
        children: any[]
      }) => {
        if (lineNode.type === 'element' && lineNode.tagName === 'span') {
          const lineContent = getTextFromNode(lineNode)
          codeLines.push(lineContent)
        }
      }
    )

    return codeLines
  }

  function wrapCodeBlocksWithoutVisit() {
    return (tree: { children: any[] }) => {
      tree.children = tree.children.map((node) => {
        if (node.tagName === 'pre' && node.children[0]?.tagName === 'code') {
          const language = node.children[0].properties.className?.[1]?.replace(
            'language-',
            ''
          )

          if (!language) return node

          return {
            type: 'element',
            tagName: 'div',
            properties: {
              className: ['code-block-wrapper'],
            },
            children: [
              {
                type: 'element',
                tagName: 'div',
                properties: {
                  className: [
                    'code-block',
                    'group/item',
                    'relative',
                    'my-4',
                    'overflow-auto',
                  ],
                },
                children: [
                  {
                    type: 'element',
                    tagName: 'div',
                    properties: {
                      className:
                        'code-header bg-[hsla(var(--app-code-block))] flex justify-between items-center py-2 px-3 border-b border-[hsla(var(--app-border))] rounded-t-lg',
                    },
                    children: [
                      {
                        type: 'element',
                        tagName: 'span',
                        properties: {
                          className: 'text-xs font-medium',
                        },
                        children: [
                          {
                            type: 'text',
                            value: language
                              ? `${getLanguageFromExtension(language)}`
                              : 'No file name',
                          },
                        ],
                      },
                      {
                        type: 'element',
                        tagName: 'button',
                        properties: {
                          className:
                            'copy-button ml-auto flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-600 focus:outline-none',
                          onClick: (event: Event) => {
                            clipboard.copy(extractCodeLines(node))

                            const button = event.currentTarget as HTMLElement
                            button.innerHTML = `
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check pointer-events-none text-green-600"><path d="M20 6 9 17l-5-5"/></svg>
                          <span>Copied</span>
                        `

                            setTimeout(() => {
                              button.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy pointer-events-none text-gray-400"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                            <span>Copy</span>
                          `
                            }, 2000)
                          },
                        },
                        children: [
                          {
                            type: 'element',
                            tagName: 'svg',
                            properties: {
                              xmlns: 'http://www.w3.org/2000/svg',
                              width: '16',
                              height: '16',
                              viewBox: '0 0 24 24',
                              fill: 'none',
                              stroke: 'currentColor',
                              strokeWidth: '2',
                              strokeLinecap: 'round',
                              strokeLinejoin: 'round',
                              className:
                                'lucide lucide-copy pointer-events-none text-gray-400',
                            },
                            children: [
                              {
                                type: 'element',
                                tagName: 'rect',
                                properties: {
                                  width: '14',
                                  height: '14',
                                  x: '8',
                                  y: '8',
                                  rx: '2',
                                  ry: '2',
                                },
                                children: [],
                              },
                              {
                                type: 'element',
                                tagName: 'path',
                                properties: {
                                  d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
                                },
                                children: [],
                              },
                            ],
                          },
                          { type: 'text', value: 'Copy' },
                        ],
                      },
                    ],
                  },
                  node,
                ],
              },
            ],
          }
        }
        return node
      })
    }
  }

  const { onViewFile, onViewFileContainer } = usePath()
  const [tokenCount, setTokenCount] = useState(0)
  const [lastTimestamp, setLastTimestamp] = useState<number | undefined>()
  const [tokenSpeed, setTokenSpeed] = useState(0)
  const messages = useAtomValue(getCurrentChatMessagesAtom)

  useEffect(() => {
    if (props.status !== MessageStatus.Pending) {
      return
    }
    const currentTimestamp = new Date().getTime() // Get current time in milliseconds
    if (!lastTimestamp) {
      // If this is the first update, just set the lastTimestamp and return
      if (props.content[0]?.text?.value !== '')
        setLastTimestamp(currentTimestamp)
      return
    }

    const timeDiffInSeconds = (currentTimestamp - lastTimestamp) / 1000 // Time difference in seconds
    const totalTokenCount = tokenCount + 1
    const averageTokenSpeed = totalTokenCount / timeDiffInSeconds // Calculate average token speed

    setTokenSpeed(averageTokenSpeed)
    setTokenCount(totalTokenCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.content])

  return (
    <div className="group relative mx-auto max-w-[700px] p-4">
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
            : (activeThread?.assistants[0].assistant_name ?? props.role)}
        </div>
        <p className="text-xs font-medium text-gray-400">
          {displayDate(props.created)}
        </p>
        <div
          className={twMerge(
            'absolute right-0 cursor-pointer transition-all',
            messages[messages.length - 1]?.id === props.id && !isUser
              ? 'absolute -bottom-8 right-4'
              : 'hidden group-hover:absolute group-hover:right-4 group-hover:top-4 group-hover:flex'
          )}
        >
          <MessageToolbar message={props} />
        </div>
        {messages[messages.length - 1]?.id === props.id &&
          (props.status === MessageStatus.Pending || tokenSpeed > 0) && (
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
        <>
          {props.content[0]?.type === ContentType.Image && (
            <div className="group/image relative mb-2 inline-flex cursor-pointer overflow-hidden rounded-xl">
              <div className="left-0 top-0 z-20 h-full w-full group-hover/image:inline-block">
                <RelativeImage
                  src={props.content[0]?.text.annotations[0]}
                  id={props.id}
                  onClick={() =>
                    onViewFile(`${props.content[0]?.text.annotations[0]}`)
                  }
                />
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

          {props.content[0]?.type === ContentType.Pdf && (
            <div className="group/file bg-secondary relative mb-2 inline-flex w-60 cursor-pointer gap-x-3 overflow-hidden rounded-lg p-4">
              <div
                className="absolute left-0 top-0 z-20 hidden h-full w-full bg-black/20 backdrop-blur-sm group-hover/file:inline-block"
                onClick={() =>
                  onViewFile(`${props.id}.${props.content[0]?.type}`)
                }
              />
              <Tooltip
                trigger={
                  <div
                    className="absolute right-2 top-2 z-20 hidden h-8 w-8 cursor-pointer items-center justify-center rounded-md bg-[hsla(var(--app-bg))] group-hover/file:flex"
                    onClick={onViewFileContainer}
                  >
                    <FolderOpenIcon size={20} />
                  </div>
                }
                content={<span>{openFileTitle()}</span>}
              />
              <Icon type={props.content[0].type} />
              <div className="w-full">
                <h6 className="line-clamp-1 w-4/5 font-medium">
                  {props.content[0].text.name?.replaceAll(/[-._]/g, ' ')}
                </h6>
                <p className="text-[hsla(var(--text-secondary)]">
                  {toGibibytes(Number(props.content[0].text.size))}
                </p>
              </div>
            </div>
          )}

          {editMessage === props.id ? (
            <div>
              <EditChatInput message={props} />
            </div>
          ) : (
            <div
              className={twMerge(
                'message max-width-[100%] flex flex-col gap-y-2 overflow-auto break-all leading-relaxed	'
              )}
              dir="ltr"
            >
              <Markdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[
                  rehypeKatex,
                  rehypeRaw,
                  [
                    rehypeHighlight,
                    {
                      detect: false,
                      ignoreMissing: true,
                    },
                  ],
                  [rehypeHighlightCodeLines, { showLineNumbers: true }],
                  wrapCodeBlocksWithoutVisit,
                ]}
                skipHtml
              >
                {text}
              </Markdown>
            </div>
          )}
        </>
      </div>
    </div>
  )
}

export default React.memo(SimpleTextMessage)
