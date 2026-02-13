import { DownloadManagement } from '@/containers/DownloadManegement'
import { NavChats } from './NavChats'
import { NavMain } from './NavMain'
import { NavProjects } from './NavProjects'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

export function LeftSidebar() {
  return (
    <div className='relative z-50'>
      <Sidebar variant="floating" collapsible="offcanvas">
        <SidebarHeader className="flex px-1">
          <div className={cn("flex items-center w-full justify-between", IS_MACOS && "justify-end")}>
            {!IS_MACOS && <span className="ml-2 font-medium font-studio">Jan</span>}
            <SidebarTrigger className="text-muted-foreground rounded-full hover:bg-sidebar-foreground/8! -mt-0.5 relative z-50" />
          </div>
          <NavMain />
        </SidebarHeader>
        <SidebarContent className="mask-b-from-95% mask-t-from-98%">
          <NavProjects />
          <NavChats />
        </SidebarContent>
        <SidebarFooter>
          <DownloadManagement />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </div>
  )
}
