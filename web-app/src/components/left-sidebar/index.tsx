import { DownloadManagement } from '@/containers/DownloadManegement'
import { NavCoworkTools } from './NavCoworkTools'
import { NavHistory } from './NavHistory'
import { NavMain } from './NavMain'
import { NavProjects } from './NavProjects'
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

export function LeftSidebar() {
  const { open: isLeftPanelOpen } = useLeftPanel()
  // Right-align the header and hide "Jan" when native controls own the top-left
  // (macOS, or a Linux DE placing buttons left).
  const leftButtons = useTitlebarLayout((s) => s.layout.left.length)
  const reserveLeft = IS_MACOS || leftButtons > 0
  return (
    <div className='relative z-50'>
      <Sidebar variant="floating" collapsible="offcanvas">
        <SidebarHeader className="flex px-1">
          <div className={cn("flex items-center w-full justify-between", reserveLeft && "justify-end")}>
            {!reserveLeft && <span className="ml-2 font-medium font-studio">Jan</span>}
            <div className="flex items-center">
              {isLeftPanelOpen && <DownloadManagement />}
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
        <SidebarRail />
      </Sidebar>
    </div>
  )
}
