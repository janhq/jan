import { useCallback, useEffect } from 'react'

import { abortDownload } from '@janhq/core'
import { Button, Modal, Progress } from '@janhq/joi'
import { atom, useAtom, useAtomValue } from 'jotai'

import {
  formatDownloadPercentage,
  formatExtensionsName,
} from '@/utils/converter'

import {
  InstallingExtensionState,
  installingExtensionAtom,
} from '@/helpers/atoms/Extension.atom'

export const showInstallingExtensionModalAtom = atom(false)

const InstallingExtensionModal = () => {
  const [showInstallingExtensionModal, setShowInstallingExtensionModal] =
    useAtom(showInstallingExtensionModalAtom)
  const installingExtensions = useAtomValue(installingExtensionAtom)

  useEffect(() => {
    if (installingExtensions.length === 0) {
      setShowInstallingExtensionModal(false)
    }
  }, [installingExtensions, setShowInstallingExtensionModal])

  const onAbortInstallingExtensionClick = useCallback(
    (item: InstallingExtensionState) => {
      if (item.localPath) {
        abortDownload(item.localPath)
      }
    },
    []
  )

  return (
    <Modal
      title="Installing Extension"
      open={showInstallingExtensionModal}
      onOpenChange={() => setShowInstallingExtensionModal(false)}
      content={
        <div>
          {Object.values(installingExtensions).map((item) => (
            <div className="pt-2" key={item.extensionId}>
              <Progress
                className="mb-2"
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
                  theme="ghost"
                  size="small"
                  onClick={() => onAbortInstallingExtensionClick(item)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ))}
        </div>
      }
    />
  )
}

export default InstallingExtensionModal
