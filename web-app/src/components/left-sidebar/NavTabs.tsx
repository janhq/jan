import { Link, useLocation } from '@tanstack/react-router'
import { Handshake, HomeIcon } from 'lucide-react'
import { route, isCoworkRoute } from '@/constants/routes'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { startNewSession } from '@/hooks/useCoworkSessions'
import { useCoworkRun } from '@/hooks/useCoworkRun'

type TabItem = {
  label: string
  to: string
  icon: typeof HomeIcon
  isActive: boolean
  onClick?: () => void
}

// The tab is the start page, like Home: it opens a fresh session rather than
// landing on whichever one was viewed last. Sessions are picked from the list.
const openCoworkStart = () =>
  startNewSession(Object.keys(useCoworkRun.getState().runId))

export function NavTabs() {
  const { t } = useTranslation()
  const { pathname } = useLocation()

  const isCowork = isCoworkRoute(pathname)
  // Home owns the chat surfaces (new chat, threads, projects); Cowork owns /cowork.
  const isHome =
    pathname === route.home ||
    pathname.startsWith('/threads') ||
    pathname.startsWith('/project')

  const tabs: TabItem[] = [
    { label: t('common:home'), to: route.home, icon: HomeIcon, isActive: isHome },
    {
      label: t('common:cowork'),
      to: route.cowork,
      icon: Handshake,
      isActive: isCowork,
      onClick: openCoworkStart,
    },
  ]

  return (
    <div className="mt-1 flex items-center gap-0.5 rounded-lg bg-sidebar-foreground/5 p-0.5">
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <Link
            key={tab.to}
            to={tab.to}
            onClick={tab.onClick}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium transition-colors',
              tab.isActive
                ? 'bg-sidebar text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon size={15} />
            <span>{tab.label}</span>
          </Link>
        )
      })}
    </div>
  )
}
