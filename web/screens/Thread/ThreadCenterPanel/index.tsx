/* eslint-disable @typescript-eslint/naming-convention */

import { memo, useEffect, useState } from 'react'

import { Accept, useDropzone } from 'react-dropzone'

import { useAtomValue, useSetAtom } from 'jotai'

import { UploadCloudIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import CenterPanelContainer from '@/containers/CenterPanelContainer'
import GenerateResponse from '@/containers/Loader/GenerateResponse'
import ModelReload from '@/containers/Loader/ModelReload'
import ModelStart from '@/containers/Loader/ModelStart'
import { fileUploadAtom } from '@/containers/Providers/Jotai'
import { snackbar } from '@/containers/Toast'

import { activeModelAtom } from '@/hooks/useActiveModel'
import { reloadModelAtom } from '@/hooks/useSendChatMessage'

import ChatBody from '@/screens/Thread/ThreadCenterPanel/ChatBody'

import { uploader } from '@/utils/file'

import ChatInput from './ChatInput'
import RequestDownloadModel from './RequestDownloadModel'

import { showSystemMonitorPanelAtom } from '@/helpers/atoms/App.atom'
import { experimentalFeatureEnabledAtom } from '@/helpers/atoms/AppConfig.atom'
import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'

import {
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

const ThreadCenterPanel = () => {
  const [dragRejected, setDragRejected] = useState({ code: '' })
  const setFileUpload = useSetAtom(fileUploadAtom)
  const experimentalFeature = useAtomValue(experimentalFeatureEnabledAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)
  const upload = uploader()
  const acceptedFormat: Accept = activeAssistant?.model.settings?.vision_model
    ? {
        'application/pdf': ['.pdf'],
        'image/jpeg': ['.jpeg'],
        'image/png': ['.png'],
        'image/jpg': ['.jpg'],
      }
    : {
        'application/pdf': ['.pdf'],
      }

  const { getRootProps, isDragReject } = useDropzone({
    noClick: true,
    multiple: false,
    accept: acceptedFormat,

    onDragOver: (e) => {
      // Retrieval file drag and drop is experimental feature
      if (!experimentalFeature) return
      if (
        e.dataTransfer.items.length === 1 &&
        ((activeAssistant?.tools && activeAssistant?.tools[0]?.enabled) ||
          activeAssistant?.model.settings?.vision_model)
      ) {
        setDragOver(true)
      } else if (
        activeAssistant?.tools &&
        !activeAssistant?.tools[0]?.enabled
      ) {
        setDragRejected({ code: 'retrieval-off' })
      } else {
        setDragRejected({ code: 'multiple-upload' })
      }
    },
    onDragLeave: () => setDragOver(false),
    onDrop: async (files, rejectFiles) => {
      // Retrieval file drag and drop is experimental feature
      if (!experimentalFeature) return
      if (
        !files ||
        files.length !== 1 ||
        rejectFiles.length !== 0 ||
        (activeAssistant?.tools &&
          !activeAssistant?.tools[0]?.enabled &&
          !activeAssistant?.model.settings?.vision_model)
      )
        return
      const imageType = files[0]?.type.includes('image')
      if (imageType) {
        setFileUpload({ file: files[0], type: 'image' })
      } else {
        upload.addFile(files[0])
        upload.upload().then((data) => {
          setFileUpload({
            file: files[0],
            type: imageType ? 'image' : 'pdf',
            id: data?.successful?.[0]?.response?.body?.id,
            name: data?.successful?.[0]?.response?.body?.filename,
          })
        })
      }
      setDragOver(false)
    },
    onDropRejected: (e) => {
      if (activeAssistant?.tools && !activeAssistant?.tools[0]?.enabled) {
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

  const engineParamsUpdate = useAtomValue(engineParamsUpdateAtom)
  const [dragOver, setDragOver] = useState(false)

  const reloadModel = useAtomValue(reloadModelAtom)

  const activeModel = useAtomValue(activeModelAtom)

  const isGeneratingResponse = useAtomValue(isGeneratingResponseAtom)

  const showSystemMonitorPanel = useAtomValue(showSystemMonitorPanelAtom)

  const [height, setHeight] = useState<number>(0)

  useEffect(() => {
    if (showSystemMonitorPanel) {
      const element = document.querySelector('.system-monitor-panel')

      if (element) {
        setHeight(element.clientHeight) // You can also use offsetHeight if needed
      }
    } else {
      setHeight(0)
    }
  }, [showSystemMonitorPanel])

  return (
    <CenterPanelContainer>
      <div
        className="relative flex h-full w-full flex-col outline-none"
        {...getRootProps()}
      >
        {dragOver && (
          <div className="absolute z-50 mx-auto h-full w-full p-8 backdrop-blur-lg">
            <div
              className={twMerge(
                'flex h-full w-full items-center justify-center rounded-lg border border-dashed border-[hsla(var(--primary-bg))]',
                isDragReject && 'border-[hsla(var(--destructive-bg))]'
              )}
            >
              <div className="mx-auto w-1/2 text-center">
                <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full">
                  <UploadCloudIcon
                    size={24}
                    className="text-[hsla(var(--primary-bg))]"
                  />
                </div>
                <div className="mt-4 text-[hsla(var(--primary-bg))]">
                  <h6 className="font-bold">
                    {isDragReject
                      ? `Currently, we only support 1 attachment at the same time with ${
                          activeAssistant?.model.settings?.vision_model
                            ? 'PDF, JPEG, JPG, PNG'
                            : 'PDF'
                        } format`
                      : 'Drop file here'}
                  </h6>
                  {!isDragReject && (
                    <p className="mt-2">
                      {activeAssistant?.model.settings?.vision_model
                        ? 'PDF, JPEG, JPG, PNG'
                        : 'PDF'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        <div
          className={twMerge(
            'flex h-full w-full flex-col justify-between'
            // showSystemMonitorPanel && `h-[calc(100%-${height}px)]`
          )}
          style={{ height: `calc(100% - ${height}px)` }}
        >
          {activeThread ? (
            <div className="flex h-full w-full overflow-x-hidden">
              <ChatBody />
            </div>
          ) : (
            <RequestDownloadModel />
          )}

          {!engineParamsUpdate && <ModelStart />}

          {reloadModel && <ModelReload />}

          {activeModel && isGeneratingResponse && <GenerateResponse />}
          <ChatInput />
        </div>
      </div>
    </CenterPanelContainer>
  )
}

export default memo(ThreadCenterPanel)
