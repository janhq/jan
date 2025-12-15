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
import { AppsConnectorSettings } from '@/components/settings/apps-connectors-settings'
// import { PrivacySettings } from '@/components/settings/privacy-settings'
import {
  // LockKeyhole,
  Settings2,
  ShapesIcon,
  Globe,
  type LucideIcon,
  BugIcon,
  BookOpen,
  LeafIcon,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { GitHub } from '@/components/ui/svgs/github'
import { Discord } from '@/components/ui/svgs/discord'
import { PersonalizationSettings } from './personalization-setting'

interface SettingsDialogProps {
  open: boolean
  section?: string
}

type SettingsSection =
  | 'general'
  | 'apps-connectors'
  // | 'privacy'
  | 'personalization'

const sections: Array<{
  id: SettingsSection
  label: string
  icon: LucideIcon
}> = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'personalization', label: 'Personalization', icon: LeafIcon },
  { id: 'apps-connectors', label: 'Apps & connectors', icon: ShapesIcon },
  // { id: 'privacy', label: 'Privacy', icon: LockKeyhole },
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
      case 'apps-connectors':
        return <AppsConnectorSettings />
      case 'personalization':
        return <PersonalizationSettings />
      // case 'privacy':
      //   return <PrivacySettings />
      default:
        return <GeneralSettings />
    }
  }

  const renderSettingFooter = () => {
    return (
      <>
        <Separator className="my-4" />
        <p className="text-xs">
          Jan is built with ❤️ by the Menlo Research team. Special thanks to our
          open-source dependencies and our amazing community.
        </p>
        <Separator className="my-4" />
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/janhq/jan/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2"
          >
            <BugIcon className="text-muted-foreground size-4" />
            <span className="font-medium text-xs">Report Issue</span>
          </a>
          <a
            href="https://jan.ai/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2"
          >
            <BookOpen className="text-muted-foreground size-4" />
            <span className="font-medium text-xs">Docs</span>
          </a>
        </div>
        <Separator className="my-4" />
        <div className="flex items-center gap-2">
          <a
            href="https://jan.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="size-8 items-center flex justify-center rounded-full bg-muted"
          >
            <Globe className="text-muted-foreground size-4" />
          </a>
          <a
            href="https://discord.com/invite/FTk2MvZwJH"
            target="_blank"
            rel="noopener noreferrer"
            className="size-8 items-center flex justify-center rounded-full bg-muted"
          >
            <Discord className="fill-muted-foreground size-4" />
          </a>
          <a
            href="https://github.com/janhq/jan"
            target="_blank"
            rel="noopener noreferrer"
            className="size-8 items-center flex justify-center rounded-full bg-muted"
          >
            <GitHub className="fill-muted-foreground size-4" />
          </a>
        </div>
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        className="max-w-full max-h-full mt-10 lg:mt-0 sm:max-w-full  md:max-w-full lg:max-w-[80%] p-0 gap-0 rounded-xl overflow-hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 py-4 border-b border-muted text-left">
          <DialogTitle className="font-medium">Settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col lg:flex-row h-screen lg:h-[600px]">
          {/* Sidebar - Mobile: Horizontal Scrollable Tabs */}
          <div className="lg:w-60 lg:p-4 flex lg:flex-col justify-between shrink-0">
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
            <div className="text-muted-foreground hidden lg:block">
              {renderSettingFooter()}
            </div>
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
