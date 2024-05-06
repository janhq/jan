import {
  PanelLeftCloseIcon,
  PanelRightCloseIcon,
  PanelTopCloseIcon,
  SunIcon,
} from 'lucide-react'
import { twMerge } from 'tailwind-merge'

const TopBar = () => {
  return (
    <div
      className={twMerge(
        'fixed z-50 flex h-9 w-full items-center border-b border-[hsla(var(--top-bar-border-b,var(--app-border)))] bg-[hsla(var(--top-bar-bg,var(--app-bg)))] px-4 backdrop-blur-md',
        isMac && 'pl-20'
      )}
    >
      <div className="flex w-full items-center justify-between text-[hsla(var(--top-bar-icon,var(--app-icon)))]">
        <div className="unset-drag flex gap-x-2">
          <PanelLeftCloseIcon size={16} className="cursor-pointer" />
          <PanelTopCloseIcon size={16} className="cursor-pointer" />
          <PanelRightCloseIcon size={16} className="cursor-pointer" />
        </div>
        <div className="unset-drag">
          <SunIcon size={16} className="cursor-pointer" />
        </div>
      </div>
    </div>
  )
}
export default TopBar
