import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ShortcutAction, PlatformShortcuts, type ShortcutSpec } from '@/lib/shortcuts'
import { PlatformMetaKey } from '@/containers/PlatformMetaKey'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.shortcuts as any)({
  component: Shortcuts,
})

interface ShortcutLabelProps {
  action: ShortcutAction
  className?: string
}

/**
 * Renders a keyboard shortcut label consistently across platforms
 */
function ShortcutLabel({ action, className = '' }: ShortcutLabelProps) {
  const spec = PlatformShortcuts[action]

  return (
    <div className={`flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md ${className}`}>
      <span className="font-medium">
        <ShortcutKeys spec={spec} />
      </span>
    </div>
  )
}

/**
 * Renders the key combination for a shortcut spec
 */
function ShortcutKeys({ spec }: { spec: ShortcutSpec }) {
  const parts: React.ReactNode[] = []

  // Helper function to format key names consistently
  const formatKey = (key: string) => {
    const lowerKey = key.toLowerCase()
    if (lowerKey === 'enter') return 'Enter'
    if (lowerKey === 'shift') return 'Shift'
    if (lowerKey === 'ctrl') return 'Ctrl'
    if (lowerKey === 'alt') return 'Alt'
    return key.toUpperCase()
  }

  // Add modifier keys
  if (spec.usePlatformMetaKey) {
    parts.push(<PlatformMetaKey key="meta" />)
  }
  if (spec.ctrlKey) {
    parts.push('Ctrl')
  }
  if (spec.metaKey) {
    parts.push('⌘')
  }
  if (spec.altKey) {
    parts.push('Alt')
  }
  if (spec.shiftKey) {
    parts.push('Shift')
  }

  // Add the main key with proper formatting
  parts.push(formatKey(spec.key))

  // Join with spaces
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && ' '}
        </span>
      ))}
    </>
  )
}

function Shortcuts() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common:settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Application */}
            <Card title={t('settings:shortcuts.application')}>
              <CardItem
                title={t('settings:shortcuts.newChat')}
                description={t('settings:shortcuts.newChatDesc')}
                actions={<ShortcutLabel action={ShortcutAction.NEW_CHAT} />}
              />
              <CardItem
                title={t('settings:shortcuts.toggleSidebar')}
                description={t('settings:shortcuts.toggleSidebarDesc')}
                actions={<ShortcutLabel action={ShortcutAction.TOGGLE_SIDEBAR} />}
              />
              <CardItem
                title={t('settings:shortcuts.zoomIn')}
                description={t('settings:shortcuts.zoomInDesc')}
                actions={<ShortcutLabel action={ShortcutAction.ZOOM_IN} />}
              />
              <CardItem
                title={t('settings:shortcuts.zoomOut')}
                description={t('settings:shortcuts.zoomOutDesc')}
                actions={<ShortcutLabel action={ShortcutAction.ZOOM_OUT} />}
              />
            </Card>

            {/* Chat */}
            <Card title={t('settings:shortcuts.chat')}>
              <CardItem
                title={t('settings:shortcuts.sendMessage')}
                description={t('settings:shortcuts.sendMessageDesc')}
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">
                      {t('settings:shortcuts.enter')}
                    </span>
                  </div>
                }
              />
              <CardItem
                title={t('settings:shortcuts.newLine')}
                description={t('settings:shortcuts.newLineDesc')}
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">
                      {t('settings:shortcuts.shiftEnter')}
                    </span>
                  </div>
                }
              />
            </Card>

            {/* Navigation */}
            <Card title={t('settings:shortcuts.navigation')}>
              <CardItem
                title={t('settings:shortcuts.goToSettings')}
                description={t('settings:shortcuts.goToSettingsDesc')}
                actions={<ShortcutLabel action={ShortcutAction.GO_TO_SETTINGS} />}
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
