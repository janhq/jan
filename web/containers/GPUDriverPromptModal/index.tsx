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
            <ModalTitle className="pr-4 leading-relaxed">
              Checking for machine that does not meet the requirements.
            </ModalTitle>
          </ModalHeader>
          <p>
            It appears that you are missing some dependencies required to run in
            GPU mode. Please follow the instructions below for more details{' '}
            <span
              className="cursor-pointer text-blue-600"
              onClick={() =>
                openExternalUrl(
                  'https://jan.ai/guides/troubleshooting/gpu-not-used/'
                )
              }
            >
              Jan is Not Using GPU
            </span>{' '}
            .
          </p>
          <div className="flex items-center space-x-2">
            <input
              id="default-checkbox"
              type="checkbox"
              onChange={onDoNotShowAgainChange}
              className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-blue-600 focus:ring-2 focus:ring-blue-500"
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
