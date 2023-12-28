import { useState } from 'react'

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

import { useSettings } from '@/hooks/useSettings'

export default function GPUDriverPromptModal({ open }: { open: boolean }) {
  const [isOpen, setIsOpen] = useState(open)
  const { saveSettings } = useSettings()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onDoNotShowAgainChange = (e: any) => {
    const isChecked = !e.target.checked
    saveSettings({ notify: isChecked })
  }

  const openChanged = (isOpened: boolean) => {
    setIsOpen(isOpened)
  }
  return (
    <Modal open={isOpen} onOpenChange={openChanged}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Missing Cuda Toolkit</ModalTitle>
        </ModalHeader>
        <p>
          It seems like you are missing Cuda Toolkit. Please follow the
          instructions on the{' '}
          <span
            className="cursor-pointer text-blue-600"
            onClick={() =>
              openExternalUrl('https://developer.nvidia.com/cuda-toolkit')
            }
          >
            NVidia Cuda Toolkit Installation Page
          </span>
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
  )
}
