import { useAtom, useSetAtom } from 'jotai'
import {
  PanelLeftCloseIcon,
  PanelRightCloseIcon,
  PanelTopCloseIcon,
  PanelTopOpenIcon,
  SunIcon,
} from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import {
  showLeftPanelAtom,
  showRightPanelAtom,
  showSystemMonitorPanelAtom,
} from '@/helpers/atoms/App.atom'

const TopPanel = () => {
  const setShowLeftPanel = useSetAtom(showLeftPanelAtom)
  const setShowRightPanel = useSetAtom(showRightPanelAtom)
  const [showSystemMonitorPanel, setShowSystemMonitorPanel] = useAtom(
    showSystemMonitorPanelAtom
  )

  return (
    <div
      className={twMerge(
        'fixed z-50 flex h-9 w-full items-center border-b border-[hsla(var(--top-panel-border))] bg-[hsla(var(--top-panel-bg))] px-4 backdrop-blur-md',
        isMac && 'pl-20'
      )}
    >
      <div className="flex w-full items-center justify-between text-[hsla(var(--text-secondary))]">
        <div className="unset-drag flex cursor-pointer gap-x-2">
          <PanelLeftCloseIcon size={16} />
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

          <PanelRightCloseIcon size={16} />
        </div>
        <div className="unset-drag">
          <SunIcon size={16} className="cursor-pointer" />
        </div>
      </div>
    </div>
  )
}
export default TopPanel
