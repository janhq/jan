import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import { useMobileScreen, useSmallScreen } from '@/hooks/useMediaQuery'
import {
  IconLayoutSidebar,
} from '@tabler/icons-react'
import { ReactNode } from 'react'

type HeaderPageProps = {
  children?: ReactNode
}
const HeaderPage = ({ children }: HeaderPageProps) => {
  const { open, setLeftPanel } = useLeftPanel()
  const isMobile = useMobileScreen()
  const isSmallScreen = useSmallScreen()

  return (
    <div
      className={cn(
        'h-10 text-main-view-fg flex items-center shrink-0 border-b border-main-view-fg/5',
        // Mobile-first responsive padding
        isMobile ? 'px-3' : 'px-4',
        // macOS-specific padding when panel is closed
        (IS_MACOS && isSmallScreen) || (IS_MACOS && !open) ? 'pl-20' : '',
        children === undefined && 'border-none'
      )}
    >
      <div
        className={cn(
          'flex items-center w-full',
          // Adjust gap based on screen size
          isMobile ? 'gap-2' : 'gap-3'
        )}
      >
        {!open && (
          <button
            className={cn(
              'cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-main-view-fg/10',
              // Larger touch target on mobile
              isMobile ? 'size-8 min-w-8' : 'size-5'
            )}
            onClick={() => setLeftPanel(!open)}
            aria-label="Toggle sidebar"
          >
            <IconLayoutSidebar
              size={18}
              className="text-main-view-fg relative z-20"
            />
          </button>
        )}
        <div
          className={cn(
            'flex-1 min-w-0', // Allow content to shrink on small screens
            isMobile && 'overflow-hidden'
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

export default HeaderPage
