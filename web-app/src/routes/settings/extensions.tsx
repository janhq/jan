import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { CardSetting, CardSettingItem } from '@/containers/CardSetting'
import { Button } from '@/components/ui/button'
import HeaderPage from '@/containers/HeaderPage'

import SettingsMenu from '@/containers/SettingsMenu'
import { t } from 'i18next'
import { RenderMarkdown } from '@/containers/RenderMarkdown'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.extensions as any)({
  component: Extensions,
})

const mockExtension = [
  {
    name: 'Jan Assistant',
    version: '1.0.2',
    description:
      'Powers the default AI assistant that works with all your installed models.',
  },
  {
    name: 'Conversational',
    version: '1.0.0',
    description:
      'Enables conversations and state persistence via your filesystem.',
  },

  {
    name: 'Engine Management',
    version: '1.0.3',
    description: 'Manages AI engines and their configurations.',
  },

  {
    name: 'Hardware Management',
    version: '1.0.0',
    description: 'Manages Better Hardware settings.',
  },

  {
    name: 'Model Management',
    version: '1.0.36',
    description: 'Handles model lists, their details, and settings.',
  },
]

function Extensions() {
  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* General */}
            <CardSetting
              header={
                <div className="flex items-center justify-between mb-4">
                  <h1 className="text-main-view-fg font-medium text-base">
                    Extensions
                  </h1>
                  <div className="flex items-center gap-2">
                    <Button size="sm">Install Extension</Button>
                  </div>
                </div>
              }
            >
              {mockExtension.map((item, i) => {
                return (
                  <CardSettingItem
                    key={i}
                    title={
                      <div className="flex items-center gap-x-2">
                        <h1 className="text-main-view-fg font-medium text-base">
                          {item.name}
                        </h1>
                        <div className="bg-main-view-fg/10 px-1 py-0.5 rounded text-main-view-fg/70 text-xs">
                          v{item.version}
                        </div>
                      </div>
                    }
                    description={
                      <RenderMarkdown
                        content={item.description}
                        components={{
                          // Make links open in a new tab
                          a: ({ ...props }) => (
                            <a
                              {...props}
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          ),
                          // Custom paragraph component remove margin
                          p: ({ ...props }) => (
                            <p {...props} className="!mb-0" />
                          ),
                        }}
                      />
                    }
                  />
                )
              })}
            </CardSetting>
          </div>
        </div>
      </div>
    </div>
  )
}
