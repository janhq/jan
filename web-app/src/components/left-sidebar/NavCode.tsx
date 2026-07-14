import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
} from '@/components/ui/sidebar'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { MessageSquarePlus, Box, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { useCodeSessions } from '@/hooks/useCodeSessions'
import { useState } from 'react'
import SkillsManagerDialog from '@/containers/dialogs/SkillsManagerDialog'

type CodeNavItem = {
  title: string
  icon: LucideIcon
  onClick: () => void
}

export function NavCode() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const sessions = useCodeSessions((s) => s.sessions)
  const currentId = useCodeSessions((s) => s.currentId)
  const [skillsOpen, setSkillsOpen] = useState(false)

  const goCode = () => navigate({ to: route.code })

  const items: CodeNavItem[] = [
    {
      title: t('common:newSession'),
      icon: MessageSquarePlus,
      onClick: () => {
        useCodeSessions.getState().createSession()
        goCode()
      },
    },
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

  return (
    <>
      <SidebarMenu>
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
            {sessions.map((session) => (
              <SidebarMenuItem key={session.id}>
                <SidebarMenuButton
                  isActive={session.id === currentId}
                  onClick={() => {
                    useCodeSessions.getState().selectSession(session.id)
                    goCode()
                  }}
                >
                  <span className="truncate">{session.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      )}

      <SkillsManagerDialog open={skillsOpen} onOpenChange={setSkillsOpen} />
    </>
  )
}
