import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import { IconLayoutSidebar } from '@tabler/icons-react'
import { ReactNode } from '@tanstack/react-router'

type HeaderPageProps = {
  children?: ReactNode
}
const HeaderPage = ({ children }: HeaderPageProps) => {
  const { open, setLeftPanel } = useLeftPanel()

  return (
    <div
      className={cn(
        'h-10 pl-18 text-main-view-fg flex items-center shrink-0 border-b border-main-view-fg/5',
        IS_MACOS && !open ? 'pl-18' : 'pl-4',
        children === undefined && 'border-none'
      )}
    >
      <div className="flex items-center w-full gap-2">
        {!open && (
          <button
            className="size-5 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-main-view-fg/10"
            onClick={() => setLeftPanel(!open)}
          >
            <IconLayoutSidebar
              size={18}
              className="text-main-view-fg relative z-20"
            />
          </button>
        )}
        {children}
      </div>
    </div>
  )
}

export default HeaderPage
