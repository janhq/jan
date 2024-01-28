/* eslint-disable @typescript-eslint/naming-convention */
import React, { useEffect, useState } from 'react'

import { useDropzone } from 'react-dropzone'

import { useAtomValue, useSetAtom } from 'jotai'

import { UploadCloudIcon, XIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import ModelReload from '@/containers/Loader/ModelReload'
import ModelStart from '@/containers/Loader/ModelStart'

import { currentPromptAtom, fileUploadAtom } from '@/containers/Providers/Jotai'
import { showLeftSideBarAtom } from '@/containers/Providers/KeyListener'

import useSendChatMessage from '@/hooks/useSendChatMessage'

import ChatBody from '@/screens/Chat/ChatBody'

import ThreadList from '@/screens/Chat/ThreadList'

import ChatInput from './ChatInput'
import RequestDownloadModel from './RequestDownloadModel'
import Sidebar from './Sidebar'

import {
  activeThreadAtom,
  engineParamsUpdateAtom,
} from '@/helpers/atoms/Thread.atom'

const ChatScreen: React.FC = () => {
  const setCurrentPrompt = useSetAtom(currentPromptAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const showLeftSideBar = useAtomValue(showLeftSideBarAtom)
  const engineParamsUpdate = useAtomValue(engineParamsUpdateAtom)
  const { queuedMessage, reloadModel } = useSendChatMessage()
  const [dragOver, setDragOver] = useState(false)
  const [dragRejected, setDragRejected] = useState({ code: '' })
  const setFileUpload = useSetAtom(fileUploadAtom)
  const { getRootProps, isDragReject } = useDropzone({
    noClick: true,
    multiple: false,
    accept: {
      // 'image/*': ['.png', '.jpg', '.jpeg'],
      'application/pdf': ['.pdf'],
    },
    onDragOver: (e) => {
      if (
        e.dataTransfer.items.length === 1 &&
        activeThread?.assistants[0].tools &&
        activeThread?.assistants[0].tools[0]?.enabled
      ) {
        setDragOver(true)
      } else if (
        activeThread?.assistants[0].tools &&
        !activeThread?.assistants[0].tools[0]?.enabled
      ) {
        setDragRejected({ code: 'retrieval-off' })
      } else {
        setDragRejected({ code: 'multiple-upload' })
      }
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (files, rejectFiles) => {
      if (
        !files ||
        files.length !== 1 ||
        rejectFiles.length !== 0 ||
        (activeThread?.assistants[0].tools &&
          !activeThread?.assistants[0].tools[0]?.enabled)
      )
        return
      const imageType = files[0]?.type.includes('image')
      setFileUpload([{ file: files[0], type: imageType ? 'image' : 'pdf' }])
      setDragOver(false)
      if (imageType) {
        setCurrentPrompt('What do you see in this image?')
      } else {
        setCurrentPrompt('Summarize this for me')
      }
    },
    onDropRejected: (e) => {
      if (
        activeThread?.assistants[0].tools &&
        !activeThread?.assistants[0].tools[0]?.enabled
      ) {
        setDragRejected({ code: 'retrieval-off' })
      } else {
        setDragRejected({ code: e[0].errors[0].code })
      }
      setDragOver(false)
    },
  })

  // TODO @faisal change this until we have sneakbar component
  useEffect(() => {
    setTimeout(() => {
      if (dragRejected.code) {
        setDragRejected({ code: '' })
      }
    }, 2000)
  }, [dragRejected.code])

  const renderError = (code: string) => {
    switch (code) {
      case 'multiple-upload':
        return 'Currently, we only support 1 attachment at the same time'

      case 'retrieval-off':
        return 'Turn on Retrieval in Assistant Settings to use this feature'

      case 'file-invalid-type':
        return 'We do not support this file type'

      default:
        return 'Oops, something error, please try again.'
    }
  }

  return (
    <div className="flex h-full w-full">
      {/* Left side bar */}
      {showLeftSideBar ? (
        <div className="flex h-full w-60 flex-shrink-0 flex-col overflow-y-auto border-r border-border">
          <ThreadList />
        </div>
      ) : null}

      <div
        className="relative flex h-full w-full flex-col overflow-auto bg-background outline-none"
        {...getRootProps()}
      >
        {dragRejected.code !== '' && (
          <div className="absolute bottom-3 left-1/2 z-50 inline-flex w-full -translate-x-1/2 justify-center px-16">
            <div className="flex items-start justify-between gap-x-4 rounded-lg bg-foreground px-4 py-2 text-white dark:border dark:border-border dark:bg-zinc-900">
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M20 10C20 15.5228 15.5228 20 10 20H0.993697C0.110179 20 -0.332289 18.9229 0.292453 18.2929L2.2495 16.3195C0.843343 14.597 1.21409e-08 12.397 1.21409e-08 10C1.21409e-08 4.47715 4.47715 0 10 0C15.5228 0 20 4.47715 20 10ZM13.2071 6.79289C13.5976 7.18342 13.5976 7.81658 13.2071 8.20711L11.4142 10L13.2071 11.7929C13.5976 12.1834 13.5976 12.8166 13.2071 13.2071C12.8166 13.5976 12.1834 13.5976 11.7929 13.2071L10 11.4142L8.20711 13.2071C7.81658 13.5976 7.18342 13.5976 6.79289 13.2071C6.40237 12.8166 6.40237 12.1834 6.79289 11.7929L8.58579 10L6.79289 8.20711C6.40237 7.81658 6.40237 7.18342 6.79289 6.79289C7.18342 6.40237 7.81658 6.40237 8.20711 6.79289L10 8.58579L11.7929 6.79289C12.1834 6.40237 12.8166 6.40237 13.2071 6.79289Z"
                  fill="#F87171"
                />
              </svg>
              <p>{renderError(dragRejected.code)}</p>
              <XIcon
                size={24}
                className="cursor-pointer"
                onClick={() => setDragRejected({ code: '' })}
              />
            </div>
          </div>
        )}

        {dragOver && (
          <div className="absolute z-50 mx-auto h-full w-full bg-background/50 p-8 backdrop-blur-lg">
            <div
              className={twMerge(
                'flex h-full w-full items-center justify-center rounded-lg border border-dashed border-blue-500',
                isDragReject && 'border-red-500'
              )}
            >
              <div className="mx-auto w-1/2 text-center">
                <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-200">
                  <UploadCloudIcon size={24} className="text-blue-600" />
                </div>
                <div className="mt-4 text-blue-600">
                  <h6 className="font-bold">
                    {isDragReject
                      ? 'Currently, we only support 1 attachment at the same time with PDF format'
                      : 'Drop file here'}
                  </h6>
                  {!isDragReject && <p className="mt-2">(PDF)</p>}
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="flex h-full w-full flex-col justify-between">
          {activeThread ? (
            <div className="flex h-full w-full overflow-y-auto overflow-x-hidden">
              <ChatBody />
            </div>
          ) : (
            <RequestDownloadModel />
          )}

          {!engineParamsUpdate && <ModelStart />}

          {reloadModel && (
            <>
              <ModelReload />
              <div className="mb-2 text-center">
                <span className="text-muted-foreground">
                  Model is reloading to apply new changes.
                </span>
              </div>
            </>
          )}

          {queuedMessage && !reloadModel && (
            <div className="mb-2 text-center">
              <span className="text-muted-foreground">
                Message queued. It can be sent once the model has started
              </span>
            </div>
          )}
          <ChatInput />
        </div>
      </div>
      {/* Right side bar */}
      {activeThread && <Sidebar />}
    </div>
  )
}

export default ChatScreen
