import { Fragment } from 'react'

import { Button, Tooltip } from '@janhq/joi'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  PanelLeftCloseIcon,
  PanelRightCloseIcon,
  MinusIcon,
  MenuIcon,
  SquareIcon,
  PaletteIcon,
  XIcon,
  PenSquareIcon,
  Settings2,
  History,
  PanelLeftOpenIcon,
} from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'

import { toaster } from '@/containers/Toast'

import { MainViewState } from '@/constants/screens'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import { useStarterScreen } from '@/hooks/useStarterScreen'

import {
  mainViewStateAtom,
  showLeftPanelAtom,
  showRightPanelAtom,
} from '@/helpers/atoms/App.atom'
import { assistantsAtom } from '@/helpers/atoms/Assistant.atom'
import {
  reduceTransparentAtom,
  selectedSettingAtom,
} from '@/helpers/atoms/Setting.atom'
import { activeTabThreadRightPanelAtom } from '@/helpers/atoms/ThreadRightPanel.atom'

const TopPanel = () => {
  const [showLeftPanel, setShowLeftPanel] = useAtom(showLeftPanelAtom)
  const [showRightPanel, setShowRightPanel] = useAtom(showRightPanelAtom)
  const [mainViewState, setMainViewState] = useAtom(mainViewStateAtom)
  const setSelectedSetting = useSetAtom(selectedSettingAtom)
  const reduceTransparent = useAtomValue(reduceTransparentAtom)
  const { requestCreateNewThread } = useCreateNewThread()
  const assistants = useAtomValue(assistantsAtom)
  const [activeTabThreadRightPanel, setActiveTabThreadRightPanel] = useAtom(
    activeTabThreadRightPanelAtom
  )

  const onCreateNewThreadClick = () => {
    if (!assistants.length)
      return toaster({
        title: 'No assistant available.',
        description: `Could not create a new thread. Please add an assistant.`,
        type: 'error',
      })
    requestCreateNewThread(assistants[0])
  }

  const { isShowStarterScreen } = useStarterScreen()

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
                  {mainViewState === MainViewState.Thread ? (
                    <Tooltip
                      trigger={<History size={16} />}
                      content="Threads History"
                    />
                  ) : (
                    <PanelLeftOpenIcon size={16} />
                  )}
                </Button>
              )}
            </Fragment>
          )}
          {mainViewState === MainViewState.Thread && !isShowStarterScreen && (
            <Button
              data-testid="btn-create-thread"
              onClick={onCreateNewThreadClick}
              theme="icon"
            >
              <PenSquareIcon
                size={16}
                className="cursor-pointer text-[hsla(var(--text-secondary))]"
              />
            </Button>
          )}
        </div>
        <div className="unset-drag flex items-center gap-x-2">
          {mainViewState !== MainViewState.Hub &&
            mainViewState !== MainViewState.Settings && (
              <Fragment>
                {showRightPanel ? (
                  <Button
                    theme="icon"
                    onClick={() => {
                      setShowRightPanel(false)
                      if (activeTabThreadRightPanel === 'model') {
                        setActiveTabThreadRightPanel(undefined)
                      }
                    }}
                  >
                    <PanelRightCloseIcon size={16} />
                  </Button>
                ) : (
                  <Button
                    theme="icon"
                    onClick={() => {
                      setShowRightPanel(true)
                      if (activeTabThreadRightPanel === undefined) {
                        setActiveTabThreadRightPanel('model')
                      }
                    }}
                  >
                    <Tooltip
                      trigger={<Settings2 size={16} />}
                      content="Thread Settings"
                    />
                  </Button>
                )}
              </Fragment>
            )}
          <Button
            theme="icon"
            onClick={() => {
              setMainViewState(MainViewState.Settings)
              setSelectedSetting('Preferences')
            }}
          >
            <PaletteIcon size={16} className="cursor-pointer" />
          </Button>

          {!isMac && (
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
