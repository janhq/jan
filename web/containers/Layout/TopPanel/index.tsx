import { Fragment } from 'react'

import { useTheme } from 'next-themes'

import { Button } from '@janhq/joi'
import { useAtom, useAtomValue } from 'jotai'
import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightOpenIcon,
  PanelRightCloseIcon,
  PanelTopCloseIcon,
  PanelTopOpenIcon,
  SunIcon,
  MoonIcon,
} from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import { MainViewState } from '@/constants/screens'

import {
  mainViewStateAtom,
  showLeftPanelAtom,
  showRightPanelAtom,
  showSystemMonitorPanelAtom,
} from '@/helpers/atoms/App.atom'

const TopPanel = () => {
  const mainViewState = useAtomValue(mainViewStateAtom)
  const [showLeftPanel, setShowLeftPanel] = useAtom(showLeftPanelAtom)
  const [showRightPanel, setShowRightPanel] = useAtom(showRightPanelAtom)
  const [showSystemMonitorPanel, setShowSystemMonitorPanel] = useAtom(
    showSystemMonitorPanelAtom
  )

  const { theme: currentTheme, setTheme } = useTheme()

  const handleClickTheme = (theme: string) => {
    setTheme(theme)
  }

  return (
    <div
      className={twMerge(
        'fixed z-50 flex h-9 w-full items-center border-b border-[hsla(var(--top-panel-border))] bg-[hsla(var(--top-panel-bg))] px-4 backdrop-blur-md',
        isMac && 'pl-20'
      )}
    >
      <div className="flex w-full items-center justify-between text-[hsla(var(--text-secondary))]">
        <div className="unset-drag flex cursor-pointer gap-x-0.5">
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
          {showSystemMonitorPanel ? (
            <Button
              theme="icon"
              onClick={() => setShowSystemMonitorPanel(false)}
            >
              <PanelTopOpenIcon size={16} />
            </Button>
          ) : (
            <Button
              theme="icon"
              onClick={() => setShowSystemMonitorPanel(true)}
            >
              <PanelTopCloseIcon size={16} />
            </Button>
          )}
          {mainViewState !== MainViewState.Hub &&
            mainViewState !== MainViewState.Settings && (
              <Fragment>
                {showRightPanel ? (
                  <Button theme="icon" onClick={() => setShowRightPanel(false)}>
                    <PanelRightOpenIcon size={16} />
                  </Button>
                ) : (
                  <Button theme="icon" onClick={() => setShowRightPanel(true)}>
                    <PanelRightCloseIcon size={16} />
                  </Button>
                )}
              </Fragment>
            )}
        </div>
        <div className="unset-drag">
          {currentTheme === 'light' ? (
            <Button theme="icon" onClick={() => handleClickTheme('dark')}>
              <MoonIcon size={16} className="cursor-pointer" />
            </Button>
          ) : (
            <Button theme="icon" onClick={() => handleClickTheme('light')}>
              <SunIcon size={16} className="cursor-pointer" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
export default TopPanel
