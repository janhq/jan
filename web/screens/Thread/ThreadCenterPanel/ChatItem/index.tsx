import React, { forwardRef, useEffect, useMemo, useState } from 'react'

import {
  ContentType,
  events,
  MessageEvent,
  MessageStatus,
  ThreadContent,
  ThreadMessage,
} from '@janhq/core'

import { Tooltip } from '@janhq/joi'

import { FolderOpenIcon } from 'lucide-react'

import ErrorMessage from '@/containers/ErrorMessage'

import { usePath } from '@/hooks/usePath'

import { toGibibytes } from '@/utils/converter'
import { openFileTitle } from '@/utils/titleUtils'

import Icon from '../FileUploadPreview/Icon'
import TextMessage from '../TextMessage'
import { RelativeImage } from '../TextMessage/RelativeImage'

type Ref = HTMLDivElement

type Props = {
  loadModelError?: string
  isCurrentMessage?: boolean
} & ThreadMessage

const ChatItem = forwardRef<Ref, Props>((message, ref) => {
  const [content, setContent] = useState<ThreadContent[]>(message.content)
  const [status, setStatus] = useState<MessageStatus>(message.status)
  const [errorMessage, setErrorMessage] = useState<ThreadMessage | undefined>(
    message.isCurrentMessage && message.status === MessageStatus.Error
      ? message
      : undefined
  )
  const messageType = useMemo(() => content[0]?.type ?? '', [content])

  const annotation = useMemo(
    () => content[0]?.text?.annotations[0] ?? '',
    [content]
  )
  const { onViewFile, onViewFileContainer } = usePath()

  function onMessageUpdate(data: ThreadMessage) {
    if (data.id === message.id) {
      setContent(data.content)
      if (data.status !== status) setStatus(data.status)
      if (data.status === MessageStatus.Error && message.isCurrentMessage)
        setErrorMessage(data)
    }
  }

  useEffect(() => {
    if (!message.isCurrentMessage && errorMessage) setErrorMessage(undefined)
  }, [message, errorMessage])

  useEffect(() => {
    if (message.status === MessageStatus.Pending)
      events.on(MessageEvent.OnMessageUpdate, onMessageUpdate)
    return () => {
      events.off(MessageEvent.OnMessageUpdate, onMessageUpdate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {status !== MessageStatus.Error && content?.length > 0 && (
        <div ref={ref} className="relative">
          {messageType === ContentType.Image && (
            <div className="group/image relative mb-2 inline-flex cursor-pointer overflow-hidden rounded-xl">
              <div className="left-0 top-0 z-20 h-full w-full group-hover/image:inline-block">
                <RelativeImage
                  src={annotation}
                  id={message.id}
                  onClick={() => onViewFile(annotation)}
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

          {messageType === ContentType.Pdf && (
            <div className="group/file bg-secondary relative mb-2 inline-flex w-60 cursor-pointer gap-x-3 overflow-hidden rounded-lg p-4">
              <div
                className="absolute left-0 top-0 z-20 hidden h-full w-full bg-black/20 backdrop-blur-sm group-hover/file:inline-block"
                onClick={() => onViewFile(`${message.id}.${messageType}`)}
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
              <Icon type={content[0].type} />
              <div className="w-full">
                <h6 className="line-clamp-1 w-4/5 font-medium">
                  {content[0].text.name?.replaceAll(/[-._]/g, ' ')}
                </h6>
                <p className="text-[hsla(var(--text-secondary)]">
                  {toGibibytes(Number(content[0].text.size))}
                </p>
              </div>
            </div>
          )}
          {messageType === ContentType.Text && (
            <TextMessage {...message} content={content} status={status} />
          )}
        </div>
      )}
      {errorMessage && !message.loadModelError && (
        <ErrorMessage message={errorMessage} />
      )}
    </>
  )
})

export default ChatItem
