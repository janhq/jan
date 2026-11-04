import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import { PanelLeft } from 'lucide-react'
import { ReactNode, memo } from 'react'
import { Button } from "@/components/ui/button"
import { useOptionalSidebar } from '@/components/ui/sidebar'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { DownloadManagement } from '@/containers/DownloadManegement'
import { useTitlebarLayout } from '@/stores/titlebar-layout-store'

type HeaderPageProps = {
  children?: ReactNode
}
const HeaderPage = memo(function HeaderPage({ children }: HeaderPageProps) {
  const { open, setLeftPanel } = useLeftPanel()
  const { t } = useTranslation()
  // Below the desktop breakpoint the sidebar is an overlay that is never part of
  // the page, whatever the persisted desktop preference says. The header then
  // owns the top-left strip and the only way to reach navigation.
  const sidebar = useOptionalSidebar()
  const isMobile = sidebar?.isMobile ?? false
  const ownsTopLeft = isMobile || !open
  // Collapsed, this header owns the top-left strip — indent past left-anchored Linux
  // window controls (size-8 each at left-4); macOS uses the pl-24 class below.
  const leftButtons = useTitlebarLayout((s) => s.layout.left.length)
  const linuxControlsPad =
    !IS_MACOS && ownsTopLeft && leftButtons > 0 ? leftButtons * 32 + 24 : undefined
  // Right-anchored controls (Windows, and Linux DEs that place them there) sit at
  // right-4 above the header — keep header content clear of them at every width.
  const rightButtons = useTitlebarLayout((s) => s.layout.right.length)
  const rightControlsPad = !IS_MACOS && rightButtons > 0 ? rightButtons * 32 + 24 : undefined

  return (
    <div
      className={cn(
        // Sit above the global drag surface, but let empty header space pass
        // through to it. Only interactive descendants receive pointer events.
        'relative z-30 h-15 flex items-center shrink-0 pointer-events-none [&_button]:pointer-events-auto [&_a]:pointer-events-auto [&_input]:pointer-events-auto [&_[role="button"]]:pointer-events-auto',
        (IS_MACOS && ownsTopLeft) ? 'pl-24' : ' pl-4',
        children === undefined && 'border-none'
      )}
      style={{
        ...(linuxControlsPad ? { paddingLeft: linuxControlsPad } : {}),
        ...(rightControlsPad ? { paddingRight: rightControlsPad } : {}),
      }}
    >
      <div
        className={cn(
          'flex items-center w-full gap-1',
        )}
      >
        {ownsTopLeft && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              className='rounded-full relative z-50'
              data-sidebar-toggle="header"
              data-testid="sidebar-toggle"
              onClick={(event) =>
                sidebar
                  ? sidebar.toggleSidebar(event.currentTarget)
                  : setLeftPanel(!open)
              }
              aria-label={t('common:sidebar.toggle')}
              title={t('common:sidebar.toggle')}
              aria-expanded={sidebar ? (isMobile ? sidebar.openMobile : sidebar.open) : open}
            >
              <PanelLeft
                className="text-muted-foreground relative size-4"
              />
            </Button>
            {/* After the toggle so the toggle stays put when this appears */}
            <DownloadManagement />
          </>
        )}
        <div
          className={cn(
            'flex-1 min-w-0'
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
})

export default HeaderPage
