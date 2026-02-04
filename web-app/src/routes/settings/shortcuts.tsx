import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
<<<<<<< HEAD
import HeaderPage from '@/containers/HeaderPage'
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ShortcutAction, PlatformShortcuts, type ShortcutSpec } from '@/lib/shortcuts'
import { PlatformMetaKey } from '@/containers/PlatformMetaKey'
<<<<<<< HEAD
=======
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import HeaderPage from '@/containers/HeaderPage'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

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
<<<<<<< HEAD
    <div className={`flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md ${className}`}>
      <span className="font-medium">
        <ShortcutKeys spec={spec} />
      </span>
    </div>
=======
    <KbdGroup className={className}>
      <ShortcutKeys spec={spec} />
    </KbdGroup>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
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
=======
    parts.push(<Kbd key="meta"><PlatformMetaKey /></Kbd>)
  }
  if (spec.ctrlKey) {
    parts.push(<Kbd key="ctrl">Ctrl</Kbd>)
  }
  if (spec.metaKey) {
    parts.push(<Kbd key="cmd">⌘</Kbd>)
  }
  if (spec.altKey) {
    parts.push(<Kbd key="alt">Alt</Kbd>)
  }
  if (spec.shiftKey) {
    parts.push(<Kbd key="shift">Shift</Kbd>)
  }

  // Add the main key with proper formatting
  parts.push(<Kbd key="main">{formatKey(spec.key)}</Kbd>)

  return <>{parts}</>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
}

function Shortcuts() {
  const { t } = useTranslation()

  return (
<<<<<<< HEAD
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common:settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
=======
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Application */}
            <Card title={t('settings:shortcuts.application')}>
              <CardItem
                title={t('settings:shortcuts.newChat')}
                description={t('settings:shortcuts.newChatDesc')}
                actions={<ShortcutLabel action={ShortcutAction.NEW_CHAT} />}
              />
              <CardItem
<<<<<<< HEAD
=======
                title={t('settings:shortcuts.newProject')}
                description={t('settings:shortcuts.newProjectDesc')}
                actions={<ShortcutLabel action={ShortcutAction.NEW_PROJECT} />}
              />
              <CardItem
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">
                      {t('settings:shortcuts.enter')}
                    </span>
                  </div>
=======
                  <KbdGroup>
                    <Kbd>Enter</Kbd>
                  </KbdGroup>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                }
              />
              <CardItem
                title={t('settings:shortcuts.newLine')}
                description={t('settings:shortcuts.newLineDesc')}
                actions={
<<<<<<< HEAD
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">
                      {t('settings:shortcuts.shiftEnter')}
                    </span>
                  </div>
=======
                  <KbdGroup>
                    <Kbd>Shift</Kbd>
                    <Kbd>Enter</Kbd>
                  </KbdGroup>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                }
              />
            </Card>

            {/* Navigation */}
            <Card title={t('settings:shortcuts.navigation')}>
              <CardItem
<<<<<<< HEAD
=======
                title={t('settings:shortcuts.search')}
                description={t('settings:shortcuts.searchDesc')}
                actions={<ShortcutLabel action={ShortcutAction.SEARCH} />}
              />
              <CardItem
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
