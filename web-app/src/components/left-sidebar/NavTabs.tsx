import { Link, useLocation } from '@tanstack/react-router'
import { Handshake, HomeIcon } from 'lucide-react'
import { route } from '@/constants/routes'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'

type TabItem = {
  label: string
  to: string
  icon: typeof HomeIcon
  isActive: boolean
}

export function NavTabs() {
  const { t } = useTranslation()
  const { pathname } = useLocation()

  // /artifacts belongs to the Cowork surface, so it keeps the Cowork nav
  // instead of falling back to Home.
  const isCode = pathname === route.code || pathname === route.artifacts
  // Home owns the chat surfaces (new chat, threads, projects); Code owns /code.
  const isHome =
    pathname === route.home ||
    pathname.startsWith('/threads') ||
    pathname.startsWith('/project')

  const tabs: TabItem[] = [
    { label: t('common:home'), to: route.home, icon: HomeIcon, isActive: isHome },
    { label: t('common:code'), to: route.code, icon: Handshake, isActive: isCode },
  ]

  return (
    <div className="mt-1 flex items-center gap-0.5 rounded-lg bg-sidebar-foreground/5 p-0.5">
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <Link
            key={tab.to}
            to={tab.to}
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
