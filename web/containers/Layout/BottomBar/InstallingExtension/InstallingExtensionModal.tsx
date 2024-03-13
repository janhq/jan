import { useCallback } from 'react'

import {
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  Progress,
} from '@janhq/uikit'
import { atom, useAtom, useAtomValue } from 'jotai'

import {
  formatDownloadPercentage,
  formatExtensionsName,
} from '@/utils/converter'

import { installingExtensionAtom } from '@/helpers/atoms/Extension.atom'

export const showInstallingExtensionModalAtom = atom(false)

const InstallingExtensionModal: React.FC = () => {
  const [showInstallingExtensionModal, setShowInstallingExtensionModal] =
    useAtom(showInstallingExtensionModalAtom)
  const installingExtensions = useAtomValue(installingExtensionAtom)

  const onAbortInstallingExtensionClick = useCallback(() => {}, [])

  return (
    <Modal
      open={showInstallingExtensionModal}
      onOpenChange={() => setShowInstallingExtensionModal(false)}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Installing Extension</ModalTitle>
        </ModalHeader>
        {Object.values(installingExtensions).map((item) => (
          <div className="pt-2" key={item.extensionId}>
            <Progress
              className="mb-2 h-2"
              value={
                formatDownloadPercentage(item.percentage, {
                  hidePercentage: true,
                }) as number
              }
            />
            <div className="flex items-center justify-between gap-x-2">
              <div className="flex gap-x-2">
                <p className="line-clamp-1">
                  {formatExtensionsName(item.extensionId)}
                </p>
                <span>{formatDownloadPercentage(item.percentage)}</span>
              </div>
              <Button
                themes="outline"
                size="sm"
                onClick={onAbortInstallingExtensionClick}
              >
                Cancel
              </Button>
            </div>
          </div>
        ))}
      </ModalContent>
    </Modal>
  )
}

export default InstallingExtensionModal
