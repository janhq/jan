import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/containers/Card'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useLocalize } from '@/lib/extensions/l10n'
import { getExtensionHost, type HostedExtension } from '@/lib/extensions/host'
import type { ValidatedManifest } from '@janhq/extension-api'
import { ExtensionSettingsForm } from './ExtensionSettingsForm'
import { errorMessage } from './useExtensions'

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
        p: ({ ...props }) => <p {...props} className="mb-0!" />,
      }}
    />
  )
}

/**
 * One extension: name, version, badges, state and its controls (`actions`),
 * then its settings once it registered them. Used by every section of the
 * list and by the details page.
 */
export function ExtensionCard({
  manifest,
  version = manifest.version,
  hosted,
  badges,
  actions,
  showSettings = true,
}: {
  manifest: ValidatedManifest
  version?: string
  /** The running copy, when the host has one. */
  hosted?: HostedExtension
  badges?: ReactNode
  actions?: ReactNode
  showSettings?: boolean
}) {
  const { t } = useTranslation()
  const localize = useLocalize()
  const settings = manifest.contributes?.settings ?? []
  return (
    <Card
      header={
        <div className="flex flex-col gap-1 mb-4">
          <div className="flex items-center gap-x-2">
            <h1 className="text-foreground font-studio font-medium text-base">
              {localize(manifest, manifest.displayName)}
            </h1>
            <Version version={version} />
            {badges}
            {hosted && (
              <span className="text-xs text-muted-foreground">
                {t(`extensions:state.${hosted.state}`)}
              </span>
            )}
            {actions && (
              <div className="ml-auto flex items-center gap-2">{actions}</div>
            )}
          </div>
          {manifest.description && (
            <Description content={localize(manifest, manifest.description)} />
          )}
          {hosted?.state === 'failed' && hosted.error && (
            <span className="text-xs text-destructive">
              {t('extensions:activationFailed', { error: hosted.error })}
            </span>
          )}
          {hosted?.state === 'crashed' && hosted.error && (
            <span className="text-xs text-destructive">
              {t('extensions:crashed.reason', { error: hosted.error })}
            </span>
          )}
        </div>
      }
    >
      {/* Settings are only readable once the extension registered them. */}
      {showSettings && hosted?.state === 'active' && settings.length > 0 && (
        <ExtensionSettingsForm extensionId={hosted.id} settings={settings} />
      )}
    </Card>
  )
}

/** A folder loaded with "Load unpacked": labelled, and unloadable. */
export function DevExtensionCard({ extension }: { extension: HostedExtension }) {
  const { t } = useTranslation()
  const localize = useLocalize()
  const unload = () =>
    getExtensionHost()
      .unload(extension.id)
      .catch((e: unknown) =>
        toast.error(
          t('extensions:unloadFailed', {
            extension: localize(
              extension.manifest,
              extension.manifest.displayName
            ),
            error: errorMessage(e),
          })
        )
      )
  return (
    <ExtensionCard
      manifest={extension.manifest}
      hosted={extension}
      badges={
        <span className="bg-primary/10 px-1 py-0.5 rounded text-primary text-xs">
          {t('extensions:development')}
        </span>
      }
      actions={
        <Button size="xs" variant="outline" onClick={unload}>
          {t('extensions:unload')}
        </Button>
      }
    />
  )
}
