import { DownloadManagement } from '@/containers/DownloadManegement'
import { NavCoworkTools } from './NavCoworkTools'
import { NavHistory } from './NavHistory'
import { NavMain } from './NavMain'
import { NavProjects } from './NavProjects'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { useEffect, useRef } from 'react'
import { useLocation } from '@tanstack/react-router'

import {
  Sidebar,
  SidebarContent,
  SidebarTrigger,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { useTitlebarLayout } from '@/stores/titlebar-layout-store'

export function LeftSidebar() {
  const { open: isLeftPanelOpen } = useLeftPanel()
  // Right-align the header and hide "Jan" when native controls own the top-left
  // (macOS, or a Linux DE placing buttons left).
  const leftButtons = useTitlebarLayout((s) => s.layout.left.length)
  const reserveLeft = IS_MACOS || leftButtons > 0
  const { isMobile, setOpenMobile } = useSidebar()
  // The mobile overlay is modal: leave it when a navigation lands on a new page
  // (dialogs opened from its rows keep it open underneath).
  const pathname = useLocation({ select: (location) => location.pathname })
  const lastPathname = useRef(pathname)
  useEffect(() => {
    if (lastPathname.current !== pathname) {
      lastPathname.current = pathname
      setOpenMobile(false)
    }
  }, [pathname, setOpenMobile])
  return (
    <div className='relative z-50'>
      <Sidebar variant="floating" collapsible="offcanvas">
        <SidebarHeader className="flex px-1">
          <div className={cn("flex items-center w-full justify-between", reserveLeft && "justify-end")}>
            {!reserveLeft && <span className="ml-2 font-medium font-studio">Jan</span>}
            <div className="flex items-center">
              {/* On mobile the page header already hosts the download indicator. */}
              {isLeftPanelOpen && !isMobile && <DownloadManagement />}
              <SidebarTrigger className="text-muted-foreground rounded-full hover:bg-sidebar-foreground/8! -mt-0.5 relative z-50 ml-0.5" />
            </div>
          </div>
          <NavMain
            afterSearch={<NavCoworkTools section="artifacts" />}
            beforeSettings={<NavCoworkTools />}
          />
        </SidebarHeader>
        <SidebarContent className="mask-b-from-95% mask-t-from-98%">
          <NavProjects />
          <NavHistory />
        </SidebarContent>
        {!isMobile && <SidebarRail />}
      </Sidebar>
    </div>
  )
}
