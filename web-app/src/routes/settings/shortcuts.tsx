import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from 'react-i18next'
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
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Application */}
            <Card title="Application">
              <CardItem
                title="New Chat"
                description="Create a new chat conversation"
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">
                      <PlatformMetaKey /> N
                    </span>
                  </div>
                }
              />
              <CardItem
                title="Toggle Sidebar"
                description="Show or hide the sidebar"
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">
                      <PlatformMetaKey /> B
                    </span>
                  </div>
                }
              />
              <CardItem
                title="Zoom In"
                description="Increase the zoom level"
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">
                      <PlatformMetaKey /> +
                    </span>
                  </div>
                }
              />
              <CardItem
                title="Zoom Out"
                description="Decrease the zoom level"
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
            <Card title="Chat">
              <CardItem
                title="Send Message"
                description="Send the current message"
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">Enter</span>
                  </div>
                }
              />
              <CardItem
                title="New Line"
                description="Insert a new line in the message"
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-main-view-fg/5 rounded-md">
                    <span className="font-medium">Shift + Enter</span>
                  </div>
                }
              />
            </Card>

            {/* Navigation */}
            <Card title="Navigation">
              <CardItem
                title="Go to Settings"
                description="Open the settings page"
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
