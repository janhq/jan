import { useRef, useState } from 'react'
import { Box, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import {
  AnimatedLucideIcon,
  type AnimatedLucideIconHandle,
  type AnimatedLucidePreset,
} from '@/components/animated-icon/animated-lucide'
import SkillsManagerDialog from '@/containers/dialogs/SkillsManagerDialog'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { route } from '@/constants/routes'
import { isCoworkEnabled } from '@/lib/version'

type Item = {
  title: string
  icon: LucideIcon
  preset: AnimatedLucidePreset
  testId: string
  onClick: () => void
}

function ToolRow({ item }: { item: Item }) {
  const iconRef = useRef<AnimatedLucideIconHandle>(null)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        data-testid={item.testId}
        onBlur={() => iconRef.current?.stopAnimation()}
        onClick={item.onClick}
        onFocus={() => iconRef.current?.startAnimation()}
        onMouseEnter={() => iconRef.current?.startAnimation()}
        onMouseLeave={() => iconRef.current?.stopAnimation()}
      >
        <AnimatedLucideIcon
          ref={iconRef}
          icon={item.icon}
          preset={item.preset}
          className="text-foreground/70"
          size={16}
        />
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * Artifacts and Customize, the Cowork-only entries of the one sidebar. They show
 * wherever Cowork is available and never replace the rest of the navigation.
 */
export function NavCoworkTools() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [skillsOpen, setSkillsOpen] = useState(false)
  if (!isCoworkEnabled()) return null

  const items: Item[] = [
    {
      title: t('common:artifacts'),
      icon: Box,
      preset: 'box',
      testId: 'nav-artifacts',
      onClick: () => navigate({ to: route.artifacts }),
    },
    {
      title: t('common:customize'),
      icon: SlidersHorizontal,
      preset: 'sliders',
      testId: 'nav-customize',
      onClick: () => setSkillsOpen(true),
    },
  ]

  return (
    <>
      <SidebarMenu>
        {items.map((item) => (
          <ToolRow key={item.title} item={item} />
        ))}
      </SidebarMenu>
      <SkillsManagerDialog open={skillsOpen} onOpenChange={setSkillsOpen} />
    </>
  )
}
