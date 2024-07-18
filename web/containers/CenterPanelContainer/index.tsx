import { PropsWithChildren } from 'react'

import { useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { mainViewStateAtom, MainViewState } from '@/helpers/atoms/App.atom'
import { downloadedModelsAtom } from '@/helpers/atoms/Model.atom'
import { reduceTransparentAtom } from '@/helpers/atoms/Setting.atom'

const CenterPanelContainer = ({ children }: PropsWithChildren) => {
  const reduceTransparent = useAtomValue(reduceTransparentAtom)
  const mainViewState = useAtomValue(mainViewStateAtom)
  const downloadedModels = useAtomValue(downloadedModelsAtom)

  return (
    <div
      className={twMerge(
        'flex h-full w-full',
        !reduceTransparent && mainViewState !== MainViewState.Hub && 'px-1.5',
        !downloadedModels.length &&
          mainViewState === MainViewState.Thread &&
          'px-0'
      )}
    >
      <div
        className={twMerge(
          'h-full w-full overflow-hidden bg-[hsla(var(--center-panel-bg))]',
          !reduceTransparent &&
            'rounded-lg border border-[hsla(var(--app-border))]'
        )}
      >
        {children}
      </div>
    </div>
  )
}

export default CenterPanelContainer
