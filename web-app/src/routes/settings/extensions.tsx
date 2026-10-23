import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { Card, CardItem } from '@/containers/Card'

import SettingsMenu from '@/containers/SettingsMenu'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { ExtensionSettingsForm } from '@/containers/extensions/ExtensionSettingsForm'
import { ExtensionManager } from '@/lib/extension'
import { getExtensionHost, type HostedExtension } from '@/lib/extensions/host'
import { useTranslation } from '@/i18n/react-i18next-compat'
import HeaderPage from '@/containers/HeaderPage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.extensions as any)({
  component: ExtensionsContent,
})

/** The host's extensions, re-read whenever one changes state. */
function useHostedExtensions(): HostedExtension[] {
  const host = getExtensionHost()
  const [extensions, setExtensions] = useState(() => host.list())
  useEffect(() => {
    const subscription = host.onDidChange(() => setExtensions(host.list()))
    setExtensions(host.list())
    return () => subscription.dispose()
  }, [host])
  return extensions
}

function Version({ version }: { version: string }) {
  return (
    <div className="bg-foreground/10 px-1 py-0.5 rounded text-foreground/70 text-xs">
      v{version}
    </div>
  )
}

function Description({ content }: { content: string }) {
  return (
    <RenderMarkdown
      content={content}
      components={{
        // Make links open in a new tab
        a: ({ ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer" />
        ),
        // Custom paragraph component remove margin
        p: ({ ...props }) => <p {...props} className="mb-0!" />,
      }}
    />
  )
}

function HostedExtensionCard({ extension }: { extension: HostedExtension }) {
  const { t } = useTranslation()
  const { manifest, state, error } = extension
  const settings = manifest.contributes?.settings ?? []
  return (
    <Card
      header={
        <div className="flex flex-col gap-1 mb-4">
          <div className="flex items-center gap-x-2">
            <h1 className="text-foreground font-studio font-medium text-base">
              {manifest.displayName}
            </h1>
            <Version version={manifest.version} />
            <span className="text-xs text-muted-foreground">
              {t(`extensions:state.${state}`)}
            </span>
          </div>
          {manifest.description && (
            <Description content={manifest.description} />
          )}
          {state === 'failed' && error && (
            <span className="text-xs text-destructive">
              {t('extensions:activationFailed', { error })}
            </span>
          )}
        </div>
      }
    >
      {/* Settings are only readable once the extension registered them. */}
      {state === 'active' && settings.length > 0 && (
        <ExtensionSettingsForm extensionId={extension.id} settings={settings} />
      )}
    </Card>
  )
}

function ExtensionsContent() {
  const { t } = useTranslation()
  const hosted = useHostedExtensions()
  const extensions = ExtensionManager.getInstance().listExtensions()
  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {hosted.map((extension) => (
              <HostedExtensionCard key={extension.id} extension={extension} />
            ))}
            {/* Legacy extensions, read-only until they move onto the host */}
            <Card
              header={
                <div className="flex items-center justify-between mb-4">
                  <h1 className="text-foreground font-studio font-medium text-base">
                    {t('settings:extensions.title')}
                  </h1>
                </div>
              }
            >
              {extensions.map((item, i) => {
                return (
                  <CardItem
                    key={i}
                    title={
                      <div className="flex items-center gap-x-2">
                        <h1 className="text-foreground font-studio font-medium text-base">
                          {item.productName ?? item.name}
                        </h1>
                        {item.version && <Version version={item.version} />}
                      </div>
                    }
                    description={<Description content={item.description ?? ''} />}
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
