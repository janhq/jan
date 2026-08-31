import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
  SidebarGroup,
  SidebarGroupLabel,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import {
  Box,
  SlidersHorizontal,
  MoreHorizontal,
  Trash2,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import {
  MessageCircleIcon,
  type MessageCircleIconHandle,
} from '@/components/animated-icon/message-circle'
import { useCoworkSessions, type CoworkSession } from '@/hooks/useCoworkSessions'
import { useCoworkRun, useIsSessionActive } from '@/hooks/useCoworkRun'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import SkillsManagerDialog from '@/containers/dialogs/SkillsManagerDialog'

type CoworkNavItem = {
  title: string
  icon: LucideIcon
  onClick: () => void
}

// Leaving a session behind is the moment an abandoned empty one becomes
// unreachable (it has no sidebar row) — sweep those out of the store, keeping
// any session whose first run is still streaming its turns in useCoworkRun.
const pruneEmpty = () => {
  const running = Object.keys(useCoworkRun.getState().runId)
  useCoworkSessions.getState().pruneEmptySessions(running)
}

// Own component (not inlined in a .map()) so it can be memoized: each row's
// running state comes from its own per-session selector (useIsSessionActive),
// so a session starting or stopping a run only re-renders its own row, not the
// whole session list — mirroring ThreadList.tsx's memoized ThreadItem +
// useIsThreadActive.
const SessionItem = memo(function SessionItem({
  session,
  isCurrent,
  isMobile,
  onSelect,
  onRequestDelete,
}: {
  session: CoworkSession
  isCurrent: boolean
  isMobile: boolean
  onSelect: (id: string) => void
  onRequestDelete: (pending: { id: string; title: string }) => void
}) {
  const { t } = useTranslation()
  const isRunning = useIsSessionActive(session.id)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isCurrent}
        onClick={() => onSelect(session.id)}
      >
        {isRunning && (
          <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span className="truncate">{session.title}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            showOnHover
            className="hover:bg-sidebar-foreground/8"
          >
            <MoreHorizontal />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-48"
          side={isMobile ? 'bottom' : 'right'}
          align={isMobile ? 'end' : 'start'}
        >
          <DropdownMenuItem
            variant="destructive"
            onSelect={() =>
              onRequestDelete({ id: session.id, title: session.title })
            }
          >
            <Trash2 />
            <span>{t('common:deleteSession')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
})

export function NavCowork() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isMobile } = useSidebar()
  const sessions = useCoworkSessions((s) => s.sessions)
  const currentId = useCoworkSessions((s) => s.currentId)
  // A session only earns a sidebar row once it has messages. A first run's
  // turns are transient in useCoworkRun until committed, so a streaming
  // session stays listed via its active run — otherwise switching away
  // mid-first-run would make it unreachable.
  const runIds = useCoworkRun((s) => s.runId)
  const visibleSessions = useMemo(
    () => sessions.filter((s) => s.turns.length > 0 || runIds[s.id] != null),
    [sessions, runIds]
  )
  const [skillsOpen, setSkillsOpen] = useState(false)
  // Session pending deletion; drives the confirm dialog (null = closed).
  const [pendingDelete, setPendingDelete] = useState<{
    id: string
    title: string
  } | null>(null)

  const goCowork = useCallback(() => navigate({ to: route.cowork }), [navigate])
  const newSessionIconRef = useRef<MessageCircleIconHandle>(null)
  const newSession = () => {
    useCoworkSessions.getState().createSession()
    pruneEmpty()
    goCowork()
  }
  const selectSession = useCallback(
    (id: string) => {
      useCoworkSessions.getState().selectSession(id)
      pruneEmpty()
      goCowork()
    },
    [goCowork]
  )

  const items: CoworkNavItem[] = [
    {
      title: t('common:artifacts'),
      icon: Box,
      onClick: () => navigate({ to: route.artifacts }),
    },
    {
      title: t('common:customize'),
      icon: SlidersHorizontal,
      onClick: () => setSkillsOpen(true),
    },
  ]

  const confirmDelete = () => {
    if (pendingDelete) useCoworkSessions.getState().deleteSession(pendingDelete.id)
    setPendingDelete(null)
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={newSession}
            onMouseEnter={() => newSessionIconRef.current?.startAnimation()}
            onMouseLeave={() => newSessionIconRef.current?.stopAnimation()}
          >
            <MessageCircleIcon
              ref={newSessionIconRef}
              className="text-foreground/70"
              size={16}
            />
            <span>{t('common:newSession')}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {items.map((item) => {
          const Icon = item.icon
          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton onClick={item.onClick}>
                <Icon className="text-foreground/70" size={16} />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>

      {/* px-0: the group's own p-2 would indent the session rows past the nav
          rows above it, which share the header's px-1. */}
      {visibleSessions.length > 0 && (
        <SidebarGroup className="px-0 group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>{t('common:sessions')}</SidebarGroupLabel>
          <SidebarMenu>
            {visibleSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isCurrent={session.id === currentId}
                isMobile={isMobile}
                onSelect={selectSession}
                onRequestDelete={setPendingDelete}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      )}

      <SkillsManagerDialog open={skillsOpen} onOpenChange={setSkillsOpen} />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common:deleteSessionTitle')}</DialogTitle>
            <DialogDescription>
              {t('common:deleteSessionBody', { title: pendingDelete?.title })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPendingDelete(null)}
            >
              {t('common:cancel')}
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmDelete}>
              {t('common:delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
