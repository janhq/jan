import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import type { PermissionString } from '@janhq/extension-api'
import { IconChevronLeft } from '@tabler/icons-react'
import { route } from '@/constants/routes'
import { Card } from '@/containers/Card'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { ExtensionCard } from '@/containers/extensions/HostedExtensionCard'
import { PermissionList } from '@/containers/extensions/PermissionList'
import { TrustBadge } from '@/containers/extensions/TrustBadge'
import {
  useHostedExtensions,
  useInstalledRegistry,
  type InstalledRegistry,
} from '@/containers/extensions/useExtensions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useLocalize } from '@/lib/extensions/l10n'
import type { HostedExtension } from '@/lib/extensions/host'
import type { InstalledExtension } from '@/services/extensions/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.extension as any)({
  component: ExtensionDetails,
})

function UninstallButton({
  entry,
  registry,
}: {
  entry: InstalledExtension
  registry: InstalledRegistry
}) {
  const { t } = useTranslation()
  const localize = useLocalize()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const confirm = async () => {
    setOpen(false)
    await registry.change(() => registry.service.uninstall(entry.id), entry.id)
    navigate({ to: route.settings.extensions })
  }
  return (
    <>
      <Button
        size="xs"
        variant="destructive"
        disabled={registry.busy}
        onClick={() => setOpen(true)}
      >
        {t('extensions:details.uninstall')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('extensions:details.uninstallTitle', {
                name: localize(entry.manifest, entry.manifest.displayName),
              })}
            </DialogTitle>
            <DialogDescription>
              {t('extensions:details.uninstallDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('extensions:cancel')}
            </Button>
            <Button size="sm" variant="destructive" onClick={confirm}>
              {t('extensions:details.uninstall')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function InstalledDetails({
  entry,
  hosted,
  registry,
}: {
  entry: InstalledExtension
  hosted?: HostedExtension
  registry: InstalledRegistry
}) {
  const { t } = useTranslation()
  const localize = useLocalize()
  const { service, change, busy } = registry
  const revoke = (permission: PermissionString) =>
    change(
      () =>
        service.setGrants(
          entry.id,
          entry.granted.filter((p) => p !== permission)
        ),
      entry.id
    )
  const grantsLabel = t('extensions:details.permissions')
  return (
    <>
      <ExtensionCard
        manifest={entry.manifest}
        version={entry.version}
        hosted={hosted}
        badges={<TrustBadge entry={entry} />}
        actions={
          <>
            <UninstallButton entry={entry} registry={registry} />
            <Switch
              aria-label={t('extensions:enable', {
                name: localize(entry.manifest, entry.manifest.displayName),
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
      <Card>
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground">
            {t('extensions:details.version', { version: entry.version })}
          </span>
          {entry.previous && (
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              disabled={busy}
              onClick={() => change(() => service.rollback(entry.id), entry.id)}
            >
              {t('extensions:details.rollback', { version: entry.previous })}
            </Button>
          )}
        </div>
      </Card>
      <Card title={grantsLabel}>
        <PermissionList
          permissions={entry.granted}
          label={grantsLabel}
          action={(permission) => (
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => revoke(permission)}
            >
              {t('extensions:details.revoke')}
            </Button>
          )}
        />
      </Card>
    </>
  )
}

function BuiltinDetails({ extension }: { extension: HostedExtension }) {
  const { t } = useTranslation()
  const grantsLabel = t('extensions:details.permissions')
  return (
    <>
      <ExtensionCard manifest={extension.manifest} hosted={extension} />
      <p className="px-1 text-xs text-muted-foreground">
        {t('extensions:details.builtinFixed')}
      </p>
      <Card title={grantsLabel}>
        <PermissionList
          permissions={extension.manifest.permissions}
          label={grantsLabel}
        />
      </Card>
    </>
  )
}

function ExtensionDetails() {
  const { t } = useTranslation()
  const { extensionId } = Route.useParams() as { extensionId: string }
  const hosted = useHostedExtensions().find((e) => e.id === extensionId)
  const registry = useInstalledRegistry()
  const entry = registry.registry?.extensions.find((e) => e.id === extensionId)
  const loaded = registry.registry !== undefined || !registry.supported

  let body
  if (hosted?.source === 'builtin') body = <BuiltinDetails extension={hosted} />
  else if (entry)
    body = <InstalledDetails entry={entry} hosted={hosted} registry={registry} />
  else if (loaded)
    body = (
      <p className="px-1 text-sm text-muted-foreground">
        {t('extensions:details.notFound')}
      </p>
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
          <div className="flex flex-col gap-3 w-full">
            <Link
              to={route.settings.extensions}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <IconChevronLeft size={14} />
              {t('extensions:details.back')}
            </Link>
            {body}
          </div>
        </div>
      </div>
    </div>
  )
}
