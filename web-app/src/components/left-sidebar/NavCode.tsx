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
  AlertCircle,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import {
  MessageCircleIcon,
  type MessageCircleIconHandle,
} from '@/components/animated-icon/message-circle'
import { useCodeSessions } from '@/hooks/useCodeSessions'
import { useCodeRun } from '@/hooks/useCodeRun'
import { useRef, useState } from 'react'
import SkillsManagerDialog from '@/containers/dialogs/SkillsManagerDialog'

type CodeNavItem = {
  title: string
  icon: LucideIcon
  onClick: () => void
}

export function NavCode() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isMobile } = useSidebar()
  const sessions = useCodeSessions((s) => s.sessions)
  const currentId = useCodeSessions((s) => s.currentId)
  // Sessions with a run blocked on a permission prompt, so a backgrounded
  // session's gated tool call doesn't hang silently with no visual cue.
  const pendingPerms = useCodeRun((s) => s.pendingPerms)
  // Same busy-thread spinner the regular chat's ThreadList uses, keyed by
  // Code session id instead of thread id.
  const runningSessions = useCodeRun((s) => s.running)
  const [skillsOpen, setSkillsOpen] = useState(false)
  // Session pending deletion; drives the confirm dialog (null = closed).
  const [pendingDelete, setPendingDelete] = useState<{
    id: string
    title: string
  } | null>(null)

  const goCode = () => navigate({ to: route.code })
  const newSessionIconRef = useRef<MessageCircleIconHandle>(null)
  const newSession = () => {
    useCodeSessions.getState().createSession()
    goCode()
  }

  const items: CodeNavItem[] = [
    {
      title: t('common:artifacts'),
      icon: Box,
      onClick: goCode,
    },
    {
      title: t('common:customize'),
      icon: SlidersHorizontal,
      onClick: () => setSkillsOpen(true),
    },
  ]

  const confirmDelete = () => {
    if (pendingDelete) useCodeSessions.getState().deleteSession(pendingDelete.id)
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

      {sessions.length > 0 && (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>{t('common:sessions')}</SidebarGroupLabel>
          <SidebarMenu>
            {sessions.map((session) => {
              const needsInput =
                session.id !== currentId &&
                (pendingPerms[session.id]?.length ?? 0) > 0
              const isRunning = runningSessions[session.id] ?? false
              return (
              <SidebarMenuItem key={session.id}>
                <SidebarMenuButton
                  isActive={session.id === currentId}
                  onClick={() => {
                    useCodeSessions.getState().selectSession(session.id)
                    goCode()
                  }}
                >
                  {isRunning && !needsInput && (
                    <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                  )}
                  <span className="truncate">{session.title}</span>
                  {needsInput && (
                    <AlertCircle
                      size={14}
                      className="ml-auto shrink-0 text-amber-500"
                      aria-label={t('common:needsInput')}
                    >
                      <title>{t('common:needsInput')}</title>
                    </AlertCircle>
                  )}
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
                        setPendingDelete({
                          id: session.id,
                          title: session.title,
                        })
                      }
                    >
                      <Trash2 />
                      <span>{t('common:deleteSession')}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
              )
            })}
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
