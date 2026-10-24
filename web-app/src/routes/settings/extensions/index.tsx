import { useId, type ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Tabs } from 'radix-ui'
import { route } from '@/constants/routes'
import { Card, CardItem } from '@/containers/Card'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { CatalogList } from '@/containers/extensions/CatalogList'
import {
  DevExtensionCard,
  ExtensionCard,
} from '@/containers/extensions/HostedExtensionCard'
import { LoadUnpacked } from '@/containers/extensions/LoadUnpacked'
import { SafeModeBanner } from '@/containers/extensions/SafeModeBanner'
import { TrustBadge } from '@/containers/extensions/TrustBadge'
import {
  useHostedExtensions,
  useInstalledRegistry,
  type InstalledRegistry,
} from '@/containers/extensions/useExtensions'
import { useStagedInstall } from '@/containers/extensions/useStagedInstall'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { HostedExtension } from '@/lib/extensions/host'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { InstalledExtension } from '@/services/extensions/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.extensions as any)({
  component: ExtensionsContent,
})

/**
 * `IS_DEV` is defined only by `tauri dev` (`IS_DEV=true`), and the define
 * passes the env string through, so an unset variable leaves it undefined.
 */
const isDevBuild = (): boolean =>
  typeof IS_DEV !== 'undefined' &&
  (IS_DEV === true || (IS_DEV as unknown as string) === 'true')

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2
        id={id}
        className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

function DetailsLink({ id }: { id: string }) {
  const { t } = useTranslation()
  return (
    <Button size="xs" variant="outline" asChild>
      <Link to={route.settings.extension} params={{ extensionId: id }}>
        {t('extensions:details.open')}
      </Link>
    </Button>
  )
}

function InstalledCard({
  entry,
  hosted,
  registry,
}: {
  entry: InstalledExtension
  hosted?: HostedExtension
  registry: InstalledRegistry
}) {
  const { t } = useTranslation()
  const { service, change, busy } = registry
  return (
    <ExtensionCard
      manifest={entry.manifest}
      version={entry.version}
      hosted={hosted}
      badges={<TrustBadge entry={entry} />}
      actions={
        <>
          <DetailsLink id={entry.id} />
          <Switch
            aria-label={t('extensions:enable', {
              name: entry.manifest.displayName,
            })}
            checked={entry.enabled}
            disabled={busy}
            onCheckedChange={(on) =>
              change(() => service.setEnabled(entry.id, on), entry.id)
            }
          />
        </>
      }
    />
  )
}

function InstalledTab({
  hosted,
  registry,
  begin,
  stageError,
}: {
  hosted: HostedExtension[]
  registry: InstalledRegistry
  begin: ReturnType<typeof useStagedInstall>['begin']
  stageError?: string
}) {
  const { t } = useTranslation()
  const dialog = useServiceHub().dialog()
  const { service, supported, change, busy } = registry
  const safeMode = registry.registry?.safeMode ?? false
  const installed = registry.registry?.extensions ?? []
  const byId = new Map(hosted.map((e) => [e.id, e]))
  // Installed ones the registry list leaves out because the host refused
  // their manifest; the host still holds them as failed, with the reason.
  const listed = new Set(installed.map((e) => e.id))
  const unlisted = hosted.filter(
    (e) => e.source === 'installed' && !listed.has(e.id)
  )
  const builtins = hosted.filter((e) => e.source === 'builtin')
  const dev = hosted.filter((e) => e.source === 'dev')

  const installFromFile = async () => {
    const selection = await dialog.open({
      filters: [
        { name: t('extensions:install.bundleFilter'), extensions: ['tgz'] },
      ],
    })
    const path = Array.isArray(selection) ? selection[0] : selection
    if (path) await begin(() => service.stageBundle(path))
  }

  const setSafeMode = (on: boolean) => change(() => service.setSafeMode(on))

  return (
    <div className="flex flex-col gap-4 w-full">
      {safeMode && <SafeModeBanner onTurnOff={() => setSafeMode(false)} />}
      <div className="flex items-start justify-end gap-2">
        {/* Folder loading is a developer tool; release builds never show it. */}
        {isDevBuild() && <LoadUnpacked />}
        {supported && (
          <div className="flex flex-col items-end gap-1">
            <Button size="sm" onClick={installFromFile}>
              {t('extensions:install.fromFile')}
            </Button>
            {stageError && (
              <span role="alert" className="text-xs text-destructive">
                {stageError}
              </span>
            )}
          </div>
        )}
      </div>
      {supported && (
        <Card>
          <CardItem
            title={t('extensions:safeMode.title')}
            description={t('extensions:safeMode.description')}
            actions={
              <Switch
                aria-label={t('extensions:safeMode.title')}
                checked={safeMode}
                disabled={busy}
                onCheckedChange={setSafeMode}
              />
            }
          />
        </Card>
      )}
      <Section title={t('extensions:sections.builtin')}>
        {builtins.map((e) => (
          <ExtensionCard
            key={e.id}
            manifest={e.manifest}
            hosted={e}
            actions={<DetailsLink id={e.id} />}
          />
        ))}
      </Section>
      {supported && (
        <Section title={t('extensions:sections.installed')}>
          {installed.length === 0 && unlisted.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">
              {t('extensions:noneInstalled')}
            </p>
          ) : (
            <>
              {installed.map((entry) => (
                <InstalledCard
                  key={entry.id}
                  entry={entry}
                  hosted={byId.get(entry.id)}
                  registry={registry}
                />
              ))}
              {unlisted.map((e) => (
                <ExtensionCard key={e.id} manifest={e.manifest} hosted={e} />
              ))}
            </>
          )}
        </Section>
      )}
      {dev.length > 0 && (
        <Section title={t('extensions:sections.development')}>
          {dev.map((e) => (
            <DevExtensionCard key={e.id} extension={e} />
          ))}
        </Section>
      )}
    </div>
  )
}

function ExtensionsContent() {
  const { t } = useTranslation()
  const hosted = useHostedExtensions()
  const registry = useInstalledRegistry()
  const install = useStagedInstall(registry)
  const installedTab = (
    <InstalledTab
      hosted={hosted}
      registry={registry}
      begin={install.begin}
      stageError={install.error}
    />
  )
  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          {registry.supported ? (
            <Tabs.Root defaultValue="installed" className="flex flex-col gap-3">
              <Tabs.List className="flex gap-1 p-1 bg-secondary/50 rounded-lg self-start">
                {(['installed', 'catalog'] as const).map((tab) => (
                  <Tabs.Trigger
                    key={tab}
                    value={tab}
                    className="px-3 py-1 text-sm rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground text-muted-foreground"
                  >
                    {t(`extensions:tabs.${tab}`)}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
              <Tabs.Content value="installed">{installedTab}</Tabs.Content>
              <Tabs.Content value="catalog">
                <CatalogList registry={registry} begin={install.begin} />
              </Tabs.Content>
            </Tabs.Root>
          ) : (
            installedTab
          )}
        </div>
      </div>
      {install.dialog}
    </div>
  )
}
