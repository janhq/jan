import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { Card, CardItem } from '@/containers/Card'

<<<<<<< HEAD
import HeaderPage from '@/containers/HeaderPage'

=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
import SettingsMenu from '@/containers/SettingsMenu'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { ExtensionManager } from '@/lib/extension'
import { useTranslation } from '@/i18n/react-i18next-compat'
<<<<<<< HEAD
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.extensions as any)({
  component: Extensions,
})

function Extensions() {
  return (
    <PlatformGuard feature={PlatformFeature.EXTENSIONS_SETTINGS}>
      <ExtensionsContent />
    </PlatformGuard>
  )
}

=======
import HeaderPage from '@/containers/HeaderPage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.extensions as any)({
  component: ExtensionsContent,
})

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
function ExtensionsContent() {
  const { t } = useTranslation()
  const extensions = ExtensionManager.getInstance().listExtensions()
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
            {/* General */}
            <Card
              header={
                <div className="flex items-center justify-between mb-4">
<<<<<<< HEAD
                  <h1 className="text-main-view-fg font-medium text-base">
=======
                  <h1 className="text-foreground font-studio font-medium text-base">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
                        <h1 className="text-main-view-fg">
                          {item.productName ?? item.name}
                        </h1>
                        <div className="bg-main-view-fg/10 px-1 py-0.5 rounded text-main-view-fg/70 text-xs">
=======
                        <h1 className="text-foreground font-studio font-medium text-base">
                          {item.productName ?? item.name}
                        </h1>
                        <div className="bg-foreground/10 px-1 py-0.5 rounded text-foreground/70 text-xs">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
<<<<<<< HEAD
                            <p {...props} className="!mb-0" />
=======
                            <p {...props} className="mb-0!" />
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
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
