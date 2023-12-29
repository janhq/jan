import React from 'react'

import { openExternalUrl } from '@janhq/core'

import {
  ModalClose,
  ModalFooter,
  ModalContent,
  Modal,
  ModalTitle,
  ModalHeader,
  Button,
} from '@janhq/uikit'

import { useAtom } from 'jotai'

import { isShowNotificationAtom, useSettings } from '@/hooks/useSettings'

const GPUDriverPrompt: React.FC = () => {
  const [showNotification, setShowNotification] = useAtom(
    isShowNotificationAtom
  )

  const { saveSettings } = useSettings()
  const onDoNotShowAgainChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = !e.target.checked
    saveSettings({ notify: isChecked })
  }

  const openChanged = () => {
    setShowNotification(false)
  }

  return (
    <div>
      <Modal open={showNotification} onOpenChange={openChanged}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Missing Nvidia Driver and Cuda Toolkit</ModalTitle>
          </ModalHeader>
          <p>
            It seems like you are missing Nvidia Driver or Cuda Toolkit or both.
            Please follow the instructions on the{' '}
            <span
              className="cursor-pointer text-blue-600"
              onClick={() =>
                openExternalUrl('https://developer.nvidia.com/cuda-toolkit')
              }
            >
              NVidia Cuda Toolkit Installation Page
            </span>{' '}
            and the{' '}
            <span
              className="cursor-pointer text-blue-600"
              onClick={() =>
                openExternalUrl('https://www.nvidia.com/Download/index.aspx')
              }
            >
              Nvidia Driver Installation Page
            </span>
            .
          </p>
          <div className="flex items-center space-x-2">
            <input
              id="default-checkbox"
              type="checkbox"
              onChange={onDoNotShowAgainChange}
              className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-blue-600 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:ring-offset-gray-800 dark:focus:ring-blue-600"
            />
            <span>Don&apos;t show again</span>
          </div>
          <ModalFooter>
            <div className="flex gap-x-2">
              <ModalClose asChild>
                <Button themes="ghost">OK</Button>
              </ModalClose>
            </div>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
export default GPUDriverPrompt
