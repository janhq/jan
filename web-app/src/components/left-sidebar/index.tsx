import { DownloadManagement } from '@/containers/DownloadManegement'
import { NavChats } from './NavChats'
import { NavCode } from './NavCode'
import { NavMain } from './NavMain'
import { NavProjects } from './NavProjects'
import { NavTabs } from './NavTabs'
import { useLeftPanel } from '@/hooks/useLeftPanel'

import {
  Sidebar,
  SidebarContent,
  SidebarTrigger,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { useTitlebarLayout } from '@/stores/titlebar-layout-store'
import { useLocation } from '@tanstack/react-router'
import { isCoworkRoute } from '@/constants/routes'

export function LeftSidebar() {
  const { open: isLeftPanelOpen } = useLeftPanel()
  const { pathname } = useLocation()
  const isCode = isCoworkRoute(pathname)
  // Right-align the header when native controls own the top-left (macOS, or a Linux
  // DE placing buttons left); "Jan" moves into the right cluster except on macOS.
  const leftButtons = useTitlebarLayout((s) => s.layout.left.length)
  const controlsOnLeft = !IS_MACOS && leftButtons > 0
  const reserveLeft = IS_MACOS || controlsOnLeft
  return (
    <div className='relative z-50'>
      <Sidebar variant="floating" collapsible="offcanvas">
        <SidebarHeader className="flex px-1">
          <div className={cn("flex items-center w-full justify-between", reserveLeft && "justify-end")}>
            {!reserveLeft && <span className="ml-2 font-medium font-studio">Jan</span>}
            <div className="flex items-center">
              {controlsOnLeft && (
                <span className="mr-2 font-medium font-studio">Jan</span>
              )}
              {isLeftPanelOpen && <DownloadManagement />}
              <SidebarTrigger className="text-muted-foreground rounded-full hover:bg-sidebar-foreground/8! -mt-0.5 relative z-50 ml-0.5" />
            </div>
          </div>
          <NavTabs />
          {isCode ? <NavCode /> : <NavMain />}
        </SidebarHeader>
        <SidebarContent className="mask-b-from-95% mask-t-from-98%">
          {!isCode && (
            <>
              <NavProjects />
              <NavChats />
            </>
          )}
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
    </div>
  )
}
