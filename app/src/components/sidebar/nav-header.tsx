import { NavActions } from '@/components/sidebar/nav-actions'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { useAuth } from '@/stores/auth-store'
import { useIsMobile } from '@/hooks/use-mobile'

export function NavHeader() {
  const { state } = useSidebar()
  const isAuthenticated = useAuth((state) => state.isAuthenticated)
  const isMobile = useIsMobile()

  return (
    <header className="flex h-14 shrink-0 items-center gap-2">
      <div className="flex flex-1 items-center gap-2 px-3">
        {((isMobile && isAuthenticated) ||
          (state === 'collapsed' && isAuthenticated)) && (
          <SidebarTrigger className="text-muted-foreground" />
        )}
        <span className="ml-2">Model Selector</span>
      </div>
      <div className="ml-auto px-3">
        <NavActions />
      </div>
    </header>
  )
}
