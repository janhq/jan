import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { GeneralSettings } from '@/components/settings/general-settings'
import {
  Settings2,
  type LucideIcon,
  LeafIcon,
  Share2Icon,
  LockKeyhole,
} from 'lucide-react'

import { PersonalizationSettings } from './personalization-setting'
import { SharesSettings } from './shares-settings'
import { PrivacySettings } from './privacy-settings'

interface SettingsDialogProps {
  open: boolean
  section?: string
}

type SettingsSection =
  | 'general'
  // | 'apps-connectors'
  | 'privacy'
  | 'personalization'
  | 'shares'

const sections: Array<{
  id: SettingsSection
  label: string
  icon: LucideIcon
}> = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'personalization', label: 'Personalization', icon: LeafIcon },
  { id: 'shares', label: 'Share Links', icon: Share2Icon },
  // { id: 'apps-connectors', label: 'Connectors', icon: ShapesIcon },
  { id: 'privacy', label: 'Privacy', icon: LockKeyhole },
]

export function SettingsDialog({
  open,
  section = 'general',
}: SettingsDialogProps) {
  const router = useRouter()
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    section as SettingsSection
  )

  const handleClose = () => {
    const url = new URL(window.location.href)
    url.searchParams.delete('setting')
    router.navigate({ to: url.pathname + url.search })
  }

  const handleSectionChange = (newSection: SettingsSection) => {
    setActiveSection(newSection)
    const url = new URL(window.location.href)
    url.searchParams.set('setting', newSection)
    router.navigate({ to: url.pathname + url.search })
  }

  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return <GeneralSettings />
      // case 'apps-connectors':
      //   return <AppsConnectorSettings />
      case 'personalization':
        return <PersonalizationSettings />
      case 'shares':
        return <SharesSettings />
      case 'privacy':
        return <PrivacySettings />
      default:
        return <GeneralSettings />
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        className="md:max-w-2xl lg:max-w-[800px] lg:max-h-[700px] p-0 gap-0 rounded-xl overflow-hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 py-4 border-b border-muted text-left">
          <DialogTitle className="font-medium">Settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col lg:flex-row max-h-screen lg:h-[500px]">
          {/* Sidebar - Mobile: Horizontal Scrollable Tabs */}
          <div className="lg:w-48 lg:p-4 flex lg:flex-col justify-between shrink-0">
            <nav className="flex lg:flex-col gap-1 w-full whitespace-nowrap overflow-x-auto lg:overflow-x-visible p-4 lg:p-0 border-b lg:border-b-0">
              {sections.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleSectionChange(s.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors text-left whitespace-nowrap shrink-0',
                    activeSection === s.id
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                  )}
                >
                  <s.icon className="size-4 shrink-0" />
                  <span>{s.label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 pb-30 lg:pb-6">
            {renderContent()}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
