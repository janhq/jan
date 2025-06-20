import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { PlatformMetaKey } from '@/containers/PlatformMetaKey'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.shortcuts as any)({
  component: Shortcuts,
})

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
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">
                      <PlatformMetaKey /> N
                    </span>
                  </div>
                }
              />
              <CardItem
                title={t('settings:shortcuts.toggleSidebar')}
                description={t('settings:shortcuts.toggleSidebarDesc')}
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">
                      <PlatformMetaKey /> B
                    </span>
                  </div>
                }
              />
              <CardItem
                title={t('settings:shortcuts.zoomIn')}
                description={t('settings:shortcuts.zoomInDesc')}
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">
                      <PlatformMetaKey /> +
                    </span>
                  </div>
                }
              />
              <CardItem
                title={t('settings:shortcuts.zoomOut')}
                description={t('settings:shortcuts.zoomOutDesc')}
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">
                      <PlatformMetaKey /> -
                    </span>
                  </div>
                }
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
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">
                      <PlatformMetaKey /> ,
                    </span>
                  </div>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
