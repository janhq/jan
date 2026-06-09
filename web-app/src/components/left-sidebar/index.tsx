import { DownloadManagement } from '@/containers/DownloadManegement'
import { NavChats } from './NavChats'
import { NavMain } from './NavMain'
import { NavProjects } from './NavProjects'

import {
  Sidebar,
  SidebarContent,
  SidebarTrigger,
  SidebarHeader,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { isPlatformTauri, isPlatformMacOS } from '@/lib/platform/utils'

export function LeftSidebar() {
  return (
    <div className="relative z-[var(--app-layer-sidebar)] h-svh">
      <div className="fixed left-(--app-titlebar-control-left) top-0 z-[var(--app-layer-left-titlebar-controls)] flex h-[var(--app-titlebar-height)] items-center gap-1">
        <DownloadManagement />
        <SidebarTrigger className="text-muted-foreground rounded-full hover:bg-sidebar-foreground/8!" />
      </div>
      <Sidebar variant="sidebar" collapsible="offcanvas">
        <SidebarHeader className="flex px-1">
          <div
            className={cn(
              'flex min-h-8 items-center w-full justify-end',
              isPlatformTauri() && isPlatformMacOS() && 'pl-16'
            )}
          >
            <div />
          </div>
          <NavMain />
        </SidebarHeader>
        <SidebarContent className="min-h-0 overflow-y-auto overscroll-contain mask-b-from-95% mask-t-from-98%">
          <NavProjects />
          <NavChats />
        </SidebarContent>
      </Sidebar>
    </div>
  )
}
