import { NavActions } from '@/components/sidebar/nav-actions'
import { ModelSelector } from '@/components/sidebar/model-selector'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { useAuth } from '@/stores/auth-store'
import { useIsMobile } from '@/hooks/use-mobile'

export function NavHeader() {
  const { state } = useSidebar()
  const isAuthenticated = useAuth((state) => state.isAuthenticated)
  const isGuest = useAuth((state) => state.isGuest)
  const isMobile = useIsMobile()

  return (
    <header className="flex h-14 shrink-0 items-center gap-2">
      <div className="flex flex-1 items-center gap-2 px-3">
        {((isMobile && isAuthenticated && !isGuest) ||
          (state === 'collapsed' && isAuthenticated && !isGuest)) && (
          <SidebarTrigger className="text-muted-foreground" />
        )}
        <ModelSelector />
      </div>
      <div className="ml-auto px-3">
        <NavActions />
      </div>
    </header>
  )
}
