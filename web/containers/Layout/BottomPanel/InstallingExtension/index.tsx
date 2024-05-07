import { Fragment, useCallback } from 'react'

import { Progress } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { showInstallingExtensionModalAtom } from './InstallingExtensionModal'

import { installingExtensionAtom } from '@/helpers/atoms/Extension.atom'

const InstallingExtension = () => {
  const installingExtensions = useAtomValue(installingExtensionAtom)
  const setShowInstallingExtensionModal = useSetAtom(
    showInstallingExtensionModalAtom
  )
  const shouldShowInstalling = installingExtensions.length > 0

  let totalPercentage = 0
  let totalExtensions = 0
  for (const installation of installingExtensions) {
    totalPercentage += installation.percentage
    totalExtensions++
  }
  const progress = (totalPercentage / totalExtensions) * 100

  const onClick = useCallback(() => {
    setShowInstallingExtensionModal(true)
  }, [setShowInstallingExtensionModal])

  return (
    <Fragment>
      {shouldShowInstalling ? (
        <div
          className="flex cursor-pointer flex-row items-center space-x-2"
          onClick={onClick}
        >
          <p className="font-medium text-[hsla(var(--text-secondary))]">
            Installing Additional Dependencies
          </p>

          <div className="flex flex-row items-center justify-center space-x-2 rounded-md px-2 py-[2px]">
            <Progress size="small" className="w-20" value={progress} />
            <span className=" font-medium text-[hsla(var(--primary-bg))]">
              {progress.toFixed(2)}%
            </span>
          </div>
        </div>
      ) : null}
    </Fragment>
  )
}

export default InstallingExtension
