import { Fragment } from 'react'

import { Button } from '@janhq/joi'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightOpenIcon,
  PanelRightCloseIcon,
  MinusIcon,
  MenuIcon,
  SquareIcon,
  PaletteIcon,
  XIcon,
} from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { MainViewState } from '@/constants/screens'

import {
  mainViewStateAtom,
  showLeftPanelAtom,
  showRightPanelAtom,
} from '@/helpers/atoms/App.atom'
import {
  reduceTransparentAtom,
  selectedSettingAtom,
} from '@/helpers/atoms/Setting.atom'

const TopPanel = () => {
  const [showLeftPanel, setShowLeftPanel] = useAtom(showLeftPanelAtom)
  const [showRightPanel, setShowRightPanel] = useAtom(showRightPanelAtom)
  const [mainViewState, setMainViewState] = useAtom(mainViewStateAtom)
  const setSelectedSetting = useSetAtom(selectedSettingAtom)
  const reduceTransparent = useAtomValue(reduceTransparentAtom)

  return (
    <div
      className={twMerge(
        'fixed z-50 flex h-9 w-full items-center px-4',
        isMac && 'border-t-0 pl-20',
        reduceTransparent &&
          'border-b border-[hsla(var(--app-border))] bg-[hsla(var(--top-panel-bg))]'
      )}
    >
      {!isMac && <LogoMark width={24} height={24} className="-ml-1 mr-2" />}
      <div className="flex w-full items-center justify-between text-[hsla(var(--text-secondary))]">
        <div className="unset-drag flex cursor-pointer gap-x-0.5">
          {!isMac && (
            <Button
              theme="icon"
              onClick={() => {
                window?.electronAPI?.showOpenMenu(100, 100)
              }}
            >
              <MenuIcon size={16} />
            </Button>
          )}
          {mainViewState !== MainViewState.Hub && (
            <Fragment>
              {showLeftPanel ? (
                <Button theme="icon" onClick={() => setShowLeftPanel(false)}>
                  <PanelLeftCloseIcon size={16} />
                </Button>
              ) : (
                <Button theme="icon" onClick={() => setShowLeftPanel(true)}>
                  <PanelLeftOpenIcon size={16} />
                </Button>
              )}
            </Fragment>
          )}
        </div>
        <div className="unset-drag flex items-center gap-x-2">
          {mainViewState !== MainViewState.Hub &&
            mainViewState !== MainViewState.Settings && (
              <Fragment>
                {showRightPanel ? (
                  <Button theme="icon" onClick={() => setShowRightPanel(false)}>
                    <PanelRightCloseIcon size={16} />
                  </Button>
                ) : (
                  <Button theme="icon" onClick={() => setShowRightPanel(true)}>
                    <PanelRightOpenIcon size={16} />
                  </Button>
                )}
              </Fragment>
            )}
          <Button
            theme="icon"
            onClick={() => {
              setMainViewState(MainViewState.Settings)
              setSelectedSetting('Appearance')
            }}
          >
            <PaletteIcon size={16} className="cursor-pointer" />
          </Button>

          {isWindows && (
            <div className="flex items-center gap-x-2">
              <Button
                theme="icon"
                onClick={() => window?.electronAPI?.setMinimizeApp()}
              >
                <MinusIcon size={16} />
              </Button>
              <Button
                theme="icon"
                onClick={() => window?.electronAPI?.setMaximizeApp()}
              >
                <SquareIcon size={14} />
              </Button>
              <Button
                theme="icon"
                onClick={() => window?.electronAPI?.setCloseApp()}
              >
                <XIcon size={16} />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
export default TopPanel
