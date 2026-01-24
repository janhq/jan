import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { Card, CardItem } from '@/containers/Card'

import HeaderPage from '@/containers/HeaderPage'

import SettingsMenu from '@/containers/SettingsMenu'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { ExtensionManager } from '@/lib/extension'
import { useTranslation } from '@/i18n/react-i18next-compat'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.extensions as any)({
  component: ExtensionsContent,
})

function ExtensionsContent() {
  const { t } = useTranslation()
  const extensions = ExtensionManager.getInstance().listExtensions()
  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common:settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* General */}
            <Card
              header={
                <div className="flex items-center justify-between mb-4">
                  <h1 className="text-main-view-fg font-medium text-base">
                    {t('settings:extensions.title')}
                  </h1>
                  {/* <div className="flex items-center gap-2">
                    <Button size="sm">Install Extension</Button>
                  </div> */}
                </div>
              }
            >
              {extensions.map((item, i) => {
                return (
                  <CardItem
                    key={i}
                    title={
                      <div className="flex items-center gap-x-2">
                        <h1 className="text-main-view-fg">
                          {item.productName ?? item.name}
                        </h1>
                        <div className="bg-main-view-fg/10 px-1 py-0.5 rounded text-main-view-fg/70 text-xs">
                          v{item.version}
                        </div>
                      </div>
                    }
                    description={
                      <RenderMarkdown
                        content={item.description ?? ''}
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
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
