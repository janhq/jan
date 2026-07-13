import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { MessageSquarePlus, Box, SlidersHorizontal, type LucideIcon } from 'lucide-react'

type CodeNavItem = {
  title: string
  icon: LucideIcon
  onClick: () => void
}

export function NavCode() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const items: CodeNavItem[] = [
    {
      title: t('common:newSession'),
      icon: MessageSquarePlus,
      onClick: () => navigate({ to: route.code }),
    },
    {
      title: t('common:artifacts'),
      icon: Box,
      onClick: () => navigate({ to: route.code }),
    },
    {
      title: t('common:customize'),
      icon: SlidersHorizontal,
      onClick: () => navigate({ to: route.code }),
    },
  ]

  return (
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
  )
}
