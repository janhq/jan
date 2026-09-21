import { useState } from 'react'
import { DownloadManagement } from '@/containers/DownloadManegement'
import { NavChats } from './NavChats'
import { NavCowork } from './NavCowork'
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
import { useLocation } from '@tanstack/react-router'
import { isCoworkRoute, route } from '@/constants/routes'

export function LeftSidebar() {
  const { open: isLeftPanelOpen } = useLeftPanel()
  const { pathname } = useLocation()
  const inSettings =
    pathname === route.settings.index || pathname.startsWith('/settings/')
  const [lastSurfacePath, setLastSurfacePath] = useState(pathname)
  if (!inSettings && lastSurfacePath !== pathname) setLastSurfacePath(pathname)
  const surfacePath = inSettings ? lastSurfacePath : pathname
  const isCowork = isCoworkRoute(surfacePath)
  return (
    <div className='relative z-50'>
      <Sidebar variant="floating" collapsible="offcanvas">
        <SidebarHeader className="flex px-1">
          <div className="flex items-center w-full justify-end">
            <div className="flex items-center">
              {isLeftPanelOpen && <DownloadManagement />}
              <SidebarTrigger className="text-muted-foreground rounded-full hover:bg-sidebar-foreground/8! -mt-0.5 relative z-50 ml-0.5" />
            </div>
          </div>
          <NavTabs surfacePath={surfacePath} />
          {isCowork ? <NavCowork /> : <NavMain />}
        </SidebarHeader>
        <SidebarContent className="mask-b-from-95% mask-t-from-98%">
          {!isCowork && (
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
