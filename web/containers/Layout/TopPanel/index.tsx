import { Fragment } from 'react'

import { useTheme } from 'next-themes'

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
        <div className="unset-drag flex cursor-pointer gap-x-2">
          {mainViewState !== MainViewState.Hub && (
            <Fragment>
              {showLeftPanel ? (
                <PanelLeftCloseIcon
                  size={16}
                  onClick={() => setShowLeftPanel(false)}
                />
              ) : (
                <PanelLeftOpenIcon
                  size={16}
                  onClick={() => setShowLeftPanel(true)}
                />
              )}
            </Fragment>
          )}
          {showSystemMonitorPanel ? (
            <PanelTopOpenIcon
              size={16}
              onClick={() => setShowSystemMonitorPanel(false)}
            />
          ) : (
            <PanelTopCloseIcon
              size={16}
              onClick={() => setShowSystemMonitorPanel(true)}
            />
          )}
          {mainViewState !== MainViewState.Hub &&
            mainViewState !== MainViewState.Settings && (
              <Fragment>
                {showRightPanel ? (
                  <PanelRightOpenIcon
                    size={16}
                    onClick={() => setShowRightPanel(false)}
                  />
                ) : (
                  <PanelRightCloseIcon
                    size={16}
                    onClick={() => setShowRightPanel(true)}
                  />
                )}
              </Fragment>
            )}
        </div>
        <div className="unset-drag">
          {currentTheme === 'light' ? (
            <MoonIcon
              size={16}
              className="cursor-pointer"
              onClick={() => handleClickTheme('dark')}
            />
          ) : (
            <SunIcon
              size={16}
              className="cursor-pointer"
              onClick={() => handleClickTheme('light')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
export default TopPanel
