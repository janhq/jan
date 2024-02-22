/* eslint-disable @typescript-eslint/naming-convention */
import React, { useContext, useEffect, useState } from 'react'

import { useDropzone } from 'react-dropzone'

import { useAtomValue, useSetAtom } from 'jotai'

import { UploadCloudIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import GenerateResponse from '@/containers/Loader/GenerateResponse'
import ModelReload from '@/containers/Loader/ModelReload'
import ModelStart from '@/containers/Loader/ModelStart'

import { fileUploadAtom } from '@/containers/Providers/Jotai'
import { showLeftSideBarAtom } from '@/containers/Providers/KeyListener'

import { snackbar } from '@/containers/Toast'

import { FeatureToggleContext } from '@/context/FeatureToggle'

import { activeModelAtom } from '@/hooks/useActiveModel'
import { queuedMessageAtom, reloadModelAtom } from '@/hooks/useSendChatMessage'

import ChatBody from '@/screens/Chat/ChatBody'

import ThreadList from '@/screens/Chat/ThreadList'

import ChatInput from './ChatInput'
import RequestDownloadModel from './RequestDownloadModel'
import Sidebar from './Sidebar'

import {
  activeThreadAtom,
  engineParamsUpdateAtom,
  isGeneratingResponseAtom,
} from '@/helpers/atoms/Thread.atom'

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

const ChatScreen: React.FC = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const showLeftSideBar = useAtomValue(showLeftSideBarAtom)
  const engineParamsUpdate = useAtomValue(engineParamsUpdateAtom)
  const [dragOver, setDragOver] = useState(false)

  const queuedMessage = useAtomValue(queuedMessageAtom)
  const reloadModel = useAtomValue(reloadModelAtom)
  const [dragRejected, setDragRejected] = useState({ code: '' })
  const setFileUpload = useSetAtom(fileUploadAtom)
  const { experimentalFeature } = useContext(FeatureToggleContext)

  const activeModel = useAtomValue(activeModelAtom)

  const isGeneratingResponse = useAtomValue(isGeneratingResponseAtom)

  const { getRootProps, isDragReject } = useDropzone({
    noClick: true,
    multiple: false,
    accept: {
      'application/pdf': ['.pdf'],
    },

    onDragOver: (e) => {
      // Retrieval file drag and drop is experimental feature
      if (!experimentalFeature) return
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
      // Retrieval file drag and drop is experimental feature
      if (!experimentalFeature) return
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

  useEffect(() => {
    if (dragRejected.code) {
      snackbar({
        description: renderError(dragRejected.code),
        type: 'error',
      })
    }
    setTimeout(() => {
      if (dragRejected.code) {
        setDragRejected({ code: '' })
      }
    }, 2000)
  }, [dragRejected.code])

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
                Message will be sent once the model has started
              </span>
            </div>
          )}

          {activeModel && isGeneratingResponse && <GenerateResponse />}
          <ChatInput />
        </div>
      </div>

      {/* Right side bar */}
      {activeThread && <Sidebar />}
    </div>
  )
}

export default ChatScreen
