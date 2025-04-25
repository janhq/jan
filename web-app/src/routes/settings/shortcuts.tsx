import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { CardSetting, CardSettingItem } from '@/containers/CardSetting'
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
            <CardSetting title="Application">
              <CardSettingItem
                title="New Chat"
                description="Create a new chat conversation"
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-muted rounded-md">
                    <span className="text-sm font-medium">
                      <PlatformMetaKey /> N
                    </span>
                  </div>
                }
              />
              <CardSettingItem
                title="Toggle Sidebar"
                description="Show or hide the sidebar"
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-muted rounded-md">
                    <span className="text-sm font-medium">
                      <PlatformMetaKey /> B
                    </span>
                  </div>
                }
              />
            </CardSetting>

            {/* Chat */}
            <CardSetting title="Chat">
              <CardSettingItem
                title="Send Message"
                description="Send the current message"
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-muted rounded-md">
                    <span className="text-sm font-medium">Enter</span>
                  </div>
                }
              />
              <CardSettingItem
                title="New Line"
                description="Insert a new line in the message"
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-muted rounded-md">
                    <span className="text-sm font-medium">Shift + Enter</span>
                  </div>
                }
              />
            </CardSetting>

            {/* Navigation */}
            <CardSetting title="Navigation">
              <CardSettingItem
                title="Go to Settings"
                description="Open the settings page"
                actions={
                  <div className="flex items-center justify-center px-3 py-1 bg-muted rounded-md">
                    <span className="text-sm font-medium">
                      <PlatformMetaKey /> ,
                    </span>
                  </div>
                }
              />
            </CardSetting>
          </div>
        </div>
      </div>
    </div>
  )
}
