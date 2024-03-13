import { Fragment } from 'react'

import { Progress } from '@janhq/uikit'
import { useAtomValue } from 'jotai'

import { installingExtensionAtom } from '@/helpers/atoms/Extension.atom'

const InstallingExtension: React.FC = () => {
  const installingExtensions = useAtomValue(installingExtensionAtom)
  const shouldShowInstalling = installingExtensions.length > 0

  let totalPercentage = 0
  let totalExtensions = 0
  for (const installation of installingExtensions) {
    totalPercentage += installation.percentage
    totalExtensions++
  }
  const progress = (totalPercentage / totalExtensions) * 100

  return (
    <Fragment>
      {shouldShowInstalling ? (
        <div className="flex cursor-pointer flex-row items-center space-x-2">
          <p className="text-xs font-semibold text-muted-foreground">
            Installing Extension
          </p>

          <div className="flex flex-row items-center justify-center space-x-2 rounded-md bg-secondary px-2 py-[2px]">
            <Progress className="h-2 w-24" value={progress} />
            <span className="text-xs font-bold text-muted-foreground">
              {progress.toFixed(2)}%
            </span>
          </div>
        </div>
      ) : null}
    </Fragment>
  )
}

export default InstallingExtension
