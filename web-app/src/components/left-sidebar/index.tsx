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

export function LeftSidebar() {
  return (
    <Sidebar variant="floating" collapsible="offcanvas">
      <SidebarHeader className="flex px-1">
        <div className="flex items-center w-full justify-between">
          <span className="ml-2 font-medium font-studio">Jan</span>
          <SidebarTrigger className="text-muted-foreground rounded-full hover:bg-sidebar-foreground/8! -mt-0.5" />
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
  )
}
