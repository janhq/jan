import { PropsWithChildren } from 'react'

import { useMediaQuery } from '@janhq/joi'
import { useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { MainViewState } from '@/constants/screens'

import { LEFT_PANEL_WIDTH } from '../LeftPanelContainer'

import { RIGHT_PANEL_WIDTH } from '../RightPanelContainer'

import {
  mainViewStateAtom,
  showLeftPanelAtom,
  showRightPanelAtom,
} from '@/helpers/atoms/App.atom'
import { reduceTransparentAtom } from '@/helpers/atoms/Setting.atom'

type Props = {
  isShowStarterScreen?: boolean
} & PropsWithChildren

const CenterPanelContainer = ({ children, isShowStarterScreen }: Props) => {
  const reduceTransparent = useAtomValue(reduceTransparentAtom)
  const matches = useMediaQuery('(max-width: 880px)')
  const showLeftPanel = useAtomValue(showLeftPanelAtom)
  const showRightPanel = useAtomValue(showRightPanelAtom)
  const mainViewState = useAtomValue(mainViewStateAtom)

  return (
    <div
      className={twMerge('flex h-full w-full')}
      style={{
        maxWidth: matches
          ? '100%'
          : mainViewState === MainViewState.Thread && !isShowStarterScreen
            ? `calc(100% - (${showRightPanel ? Number(localStorage.getItem(RIGHT_PANEL_WIDTH)) : 0}px + ${showLeftPanel ? Number(localStorage.getItem(LEFT_PANEL_WIDTH)) : 0}px))`
            : '100%',
      }}
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
