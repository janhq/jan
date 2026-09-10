import { useRef } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { Handshake, HomeIcon, type LucideIcon } from 'lucide-react'
import { route, isCoworkRoute } from '@/constants/routes'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { startNewSession } from '@/hooks/useCoworkSessions'
import { useCoworkRun } from '@/hooks/useCoworkRun'
import {
  AnimatedLucideIcon,
  type AnimatedLucideIconHandle,
  type AnimatedLucidePreset,
} from '@/components/animated-icon/animated-lucide'

type TabItem = {
  label: string
  to: string
  icon: LucideIcon
  preset: AnimatedLucidePreset
  isActive: boolean
  onClick?: () => void
}

// The tab is the start page, like Home: it opens a fresh session rather than
// landing on whichever one was viewed last. Sessions are picked from the list.
const openCoworkStart = () =>
  startNewSession(Object.keys(useCoworkRun.getState().runId))

function NavTab({ tab }: { tab: TabItem }) {
  const iconRef = useRef<AnimatedLucideIconHandle>(null)

  return (
    <Link
      to={tab.to}
      onClick={tab.onClick}
      aria-current={tab.isActive ? 'page' : undefined}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium transition-colors',
        tab.isActive
          ? 'bg-sidebar text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
      onBlur={() => iconRef.current?.stopAnimation()}
      onFocus={() => iconRef.current?.startAnimation()}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
    >
      <AnimatedLucideIcon
        ref={iconRef}
        icon={tab.icon}
        preset={tab.preset}
        size={15}
      />
      <span>{tab.label}</span>
    </Link>
  )
}

export function NavTabs({ surfacePath }: { surfacePath: string }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()

  const isCowork = isCoworkRoute(surfacePath)
  // Home owns the chat surfaces (new chat, threads, projects); Cowork owns /cowork.
  const isHome =
    surfacePath === route.home ||
    surfacePath.startsWith('/threads') ||
    surfacePath.startsWith('/project')

  const tabs: TabItem[] = [
    {
      label: t('common:home'),
      to: route.home,
      icon: HomeIcon,
      preset: 'home',
      isActive: isHome,
    },
    {
      label: t('common:cowork'),
      to: route.cowork,
      icon: Handshake,
      preset: 'handshake',
      isActive: isCowork,
      onClick:
        isCowork && pathname.startsWith('/settings')
          ? undefined
          : openCoworkStart,
    },
  ]

  return (
    <div className="mt-1 flex items-center gap-0.5 rounded-lg bg-sidebar-foreground/5 p-0.5">
      {tabs.map((tab) => (
        <NavTab key={tab.to} tab={tab} />
      ))}
    </div>
  )
}
