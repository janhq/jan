import { NavActions } from '@/components/sidebar/nav-actions'
import { ModelSelector } from '@/components/sidebar/model-selector'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { ThemeToggle } from '../themes/theme-toggle'
import { memo } from 'react'
import { useAuth } from '@/stores/auth-store'

interface NavHeaderProps {
  conversationId?: string
  conversationTitle?: string
}

export const NavHeader = memo(function NavHeader({
  conversationId,
  conversationTitle
}: NavHeaderProps = {}) {
  const { state, isMobile } = useSidebar()
  const isGuest = useAuth((state) => state.isGuest)

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 justify-between">
      <div className="flex flex-1 items-center gap-2 px-3">
        {!isGuest && (isMobile || state === 'collapsed') && (
          <SidebarTrigger className="text-muted-foreground" />
        )}
        <ModelSelector />
      </div>
      <div className="ml-auto px-3 flex items-center gap-2">
        <ThemeToggle />
        <NavActions
          conversationId={conversationId}
          conversationTitle={conversationTitle}
        />
      </div>
    </header>
  )
})
