import { useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { Handshake, HomeIcon, type LucideIcon } from 'lucide-react'
import { route, isCoworkRoute } from '@/constants/routes'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useThreads } from '@/hooks/useThreads'
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
}

function NavTab({ tab }: { tab: TabItem }) {
  const iconRef = useRef<AnimatedLucideIconHandle>(null)

  return (
    <Link
      to={tab.to}
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
  const lastHomePath = useRef<string>(route.home)

  const isCowork = isCoworkRoute(surfacePath)
  // Home owns the chat surfaces (new chat, threads, projects); Cowork owns /cowork.
  const isHome =
    surfacePath === route.home ||
    surfacePath.startsWith('/threads') ||
    surfacePath.startsWith('/project')
  if (isHome) lastHomePath.current = surfacePath
  const homePath = isHome ? surfacePath : lastHomePath.current
  const threadId = homePath.startsWith('/threads/')
    ? homePath.slice('/threads/'.length)
    : undefined
  const threadExists = useThreads(
    (s) => !threadId || Boolean(s.threads[threadId])
  )

  const tabs: TabItem[] = [
    {
      label: t('common:home'),
      to: threadExists ? homePath : route.home,
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
