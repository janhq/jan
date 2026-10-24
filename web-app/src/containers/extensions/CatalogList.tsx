import { useCallback, useEffect, useId, useState } from 'react'
import { IconTrash } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Card } from '@/containers/Card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  compareVersions,
  latestVersion,
  validateSource,
  type SourceErrors,
} from '@/lib/extensions/index-sources'
import type {
  Catalog,
  IndexExtension,
  IndexSource,
  InstalledExtension,
  RemovedPin,
  SourcesNotice,
  StagedInstall,
} from '@/services/extensions/types'
import { UnsignedSourceBadge } from './TrustBadge'
import { errorMessage, type InstalledRegistry } from './useExtensions'

type Begin = (
  stage: () => Promise<StagedInstall>,
  sourceName?: string
) => Promise<void>

function Field({
  label,
  value,
  onChange,
  error,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        aria-invalid={error !== undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

// The plugin stores a source URL as the WHATWG URL serializes it.
const sameUrl = (a: string, b: string) => {
  try {
    return new URL(a.trim()).href === new URL(b).href
  } catch {
    return false
  }
}

function AddSourceForm({
  removedPins,
  onAdd,
}: {
  /** Keys of removed keyed sources: re-adding one without a key warns. */
  removedPins: RemovedPin[]
  onAdd: (url: string, name: string, publicKey?: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [errors, setErrors] = useState<SourceErrors>({})
  // The removed pin the user was warned about for the URL as typed; a
  // second press of Add with the same URL goes ahead without a key.
  const [warned, setWarned] = useState<RemovedPin>()
  const err = (code?: string) =>
    code ? t(`extensions:sources.errors.${code}`) : undefined

  const changeUrl = (value: string) => {
    setUrl(value)
    setWarned(undefined)
  }

  const submit = async () => {
    const found = validateSource({ url, name, publicKey })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const key = publicKey.trim() || undefined
    const pin = key ? undefined : removedPins.find((p) => sameUrl(url, p.url))
    if (pin && warned !== pin) {
      setWarned(pin)
      return
    }
    await onAdd(url.trim(), name.trim(), key)
    setUrl('')
    setName('')
    setPublicKey('')
    setWarned(undefined)
  }

  return (
    <div className="flex flex-col gap-2">
      <Field
        label={t('extensions:sources.url')}
        value={url}
        onChange={changeUrl}
        error={err(errors.url)}
      />
      <Field
        label={t('extensions:sources.name')}
        value={name}
        onChange={setName}
        error={err(errors.name)}
      />
      <Field
        label={t('extensions:sources.publicKey')}
        value={publicKey}
        onChange={setPublicKey}
        error={err(errors.publicKey)}
      />
      {warned && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
        >
          <span>{t('extensions:sources.removedPin.warning')}</span>
          <span className="text-muted-foreground">
            {t('extensions:sources.removedPin.key')}
          </span>
          <code className="break-all">{warned.publicKey}</code>
        </div>
      )}
      <Button size="sm" className="self-end" onClick={submit}>
        {t('extensions:sources.add')}
      </Button>
    </div>
  )
}

function CatalogEntry({
  entry,
  installed,
  onInstall,
}: {
  entry: IndexExtension
  installed?: InstalledExtension
  onInstall: (version: string) => void
}) {
  const { t } = useTranslation()
  const latest = latestVersion(entry.versions)
  const newer =
    latest &&
    (!installed || compareVersions(latest.version, installed.version) > 0)
  const label = !installed
    ? t('extensions:catalog.install')
    : newer
      ? t('extensions:catalog.update', { version: latest.version })
      : t('extensions:catalog.installed')
  return (
    <li className="flex items-start gap-2 py-2">
      <div className="flex flex-col gap-0.5 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{entry.displayName}</span>
          {latest && (
            <span className="text-xs text-muted-foreground">
              v{latest.version}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {t('extensions:catalog.by', { publisher: entry.publisher })}
          </span>
        </div>
        {entry.description && (
          <span className="text-xs text-muted-foreground">
            {entry.description}
          </span>
        )}
      </div>
      {latest?.provenance && (
        <a
          href={latest.provenance}
          target="_blank"
          rel="noopener noreferrer"
          title={latest.provenance}
          className="bg-foreground/10 px-1 py-0.5 rounded text-foreground/70 text-xs underline"
        >
          {t('extensions:catalog.provenance')}
        </a>
      )}
      <Button
        size="xs"
        variant={newer ? 'default' : 'outline'}
        disabled={!newer}
        onClick={() => latest && onInstall(latest.version)}
      >
        {label}
      </Button>
    </li>
  )
}

/**
 * Asks before re-pinning a source's key to the one its signed index names
 * as next. Nothing changes until the user confirms here.
 */
function RotateKeyDialog({
  source,
  nextPublicKey,
  onConfirm,
  onCancel,
}: {
  source: IndexSource
  nextPublicKey: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('extensions:sources.rotate.title', { name: source.name })}
          </DialogTitle>
          <DialogDescription>
            {t('extensions:sources.rotate.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1 text-xs">
          <span>{t('extensions:sources.rotate.current')}</span>
          <code className="break-all">{source.publicKey}</code>
          <span>{t('extensions:sources.rotate.next')}</span>
          <code className="break-all">{nextPublicKey}</code>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('extensions:cancel')}
          </Button>
          <Button size="sm" onClick={onConfirm}>
            {t('extensions:sources.rotate.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Asks before a keyed source and its pinned key are removed. */
function RemoveKeyedSourceDialog({
  source,
  onConfirm,
  onCancel,
}: {
  source: IndexSource
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('extensions:sources.removeKeyed.title', { name: source.name })}
          </DialogTitle>
          <DialogDescription>
            {t('extensions:sources.removeKeyed.description')}
          </DialogDescription>
        </DialogHeader>
        <code className="break-all text-xs">{source.publicKey}</code>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('extensions:cancel')}
          </Button>
          <Button size="sm" variant="destructive" onClick={onConfirm}>
            {t('extensions:sources.removeKeyed.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** What a repair of the stored sources dropped. */
function SourcesNoticeBanner({ notice }: { notice: SourcesNotice }) {
  const { t } = useTranslation()
  const dropped = notice.dropped
    .map((d) =>
      d.name && d.url ? `${d.name} (${d.url})` : (d.name ?? d.url ?? '?')
    )
    .join(', ')
  return (
    <div
      role="status"
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
    >
      {notice.dropped.length > 0
        ? t('extensions:sources.notice.dropped', {
            sources: dropped,
            path: notice.movedTo,
          })
        : t('extensions:sources.notice.unreadable', { path: notice.movedTo })}
    </div>
  )
}

function SourceCatalog({
  source,
  registry,
  onRemove,
  onRotated,
  begin,
}: {
  source: IndexSource
  registry: InstalledRegistry
  onRemove: () => void
  /** Called once a key rotation was accepted, to re-read the sources. */
  onRotated: () => Promise<void>
  begin: Begin
}) {
  const { t } = useTranslation()
  const { service, change } = registry
  const [catalog, setCatalog] = useState<Catalog>()
  const [error, setError] = useState<string>()
  const [rotating, setRotating] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    let live = true
    service.getCatalog(source.id).then(
      (index) => live && setCatalog(index),
      (e: unknown) =>
        live &&
        setError(
          t('extensions:errors.catalog', {
            source: source.name,
            error: errorMessage(e),
          })
        )
    )
    return () => {
      live = false
    }
  }, [service, source.id, source.name, source.publicKey, t])

  const rotate = (next: string) => {
    setRotating(false)
    return change(async () => {
      await service.acceptNextKey(source.id, next)
      await onRotated()
    })
  }
  const offer = catalog?.nextPublicKey ?? undefined

  const installedById = new Map(
    (registry.registry?.extensions ?? []).map((e) => [e.id, e])
  )
  return (
    <Card
      header={
        <div className="flex items-center gap-2 mb-2">
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-foreground font-studio font-medium text-base">
              {source.name}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {source.url}
            </span>
            {source.publicKey ? (
              <span className="text-xs text-muted-foreground">
                {t('extensions:sources.keyPinned')}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <UnsignedSourceBadge />
                <span className="text-xs text-muted-foreground">
                  {t('extensions:sources.unsignedHint')}
                </span>
              </span>
            )}
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t('extensions:sources.remove', { name: source.name })}
            onClick={() =>
              source.publicKey ? setConfirmRemove(true) : onRemove()
            }
          >
            <IconTrash size={14} />
          </Button>
        </div>
      }
    >
      {confirmRemove && (
        <RemoveKeyedSourceDialog
          source={source}
          onConfirm={() => {
            setConfirmRemove(false)
            onRemove()
          }}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
      {offer && (
        <div className="flex items-center gap-2 mb-2 rounded-md border border-border p-2">
          <span className="text-xs flex-1">
            {t('extensions:sources.rotate.offer')}
          </span>
          <Button size="xs" variant="outline" onClick={() => setRotating(true)}>
            {t('extensions:sources.rotate.review')}
          </Button>
        </div>
      )}
      {offer && rotating && (
        <RotateKeyDialog
          source={source}
          nextPublicKey={offer}
          onConfirm={() => void rotate(offer)}
          onCancel={() => setRotating(false)}
        />
      )}
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : !catalog ? (
        <span className="text-xs text-muted-foreground">
          {t('extensions:catalog.loading')}
        </span>
      ) : catalog.index.extensions.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          {t('extensions:catalog.empty')}
        </span>
      ) : (
        <ul className="divide-y divide-border">
          {catalog.index.extensions.map((entry) => (
            <CatalogEntry
              key={entry.id}
              entry={entry}
              installed={installedById.get(entry.id)}
              onInstall={(version) =>
                begin(
                  () => service.stageFromIndex(source.id, entry.id, version),
                  source.name
                )
              }
            />
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * The index sources the user added, each with its catalog. Installing
 * from a catalog goes through the same consent as a file (`begin`).
 */
export function CatalogList({
  registry,
  begin,
}: {
  registry: InstalledRegistry
  begin: Begin
}) {
  const { t } = useTranslation()
  const { service, change } = registry
  const [sources, setSources] = useState<IndexSource[]>([])
  const [removedPins, setRemovedPins] = useState<RemovedPin[]>([])
  const [notice, setNotice] = useState<SourcesNotice | null>(null)

  const refresh = useCallback(async () => {
    const listed = await service.listSources()
    setSources(listed.sources)
    setRemovedPins(listed.removedPins)
    setNotice(listed.notice)
  }, [service])

  useEffect(() => {
    void refresh().catch(() => undefined)
  }, [refresh])

  const add = (url: string, name: string, publicKey?: string) =>
    change(async () => {
      await service.addSource(url, name, publicKey)
      await refresh()
    })

  const remove = (id: string) =>
    change(async () => {
      await service.removeSource(id)
      await refresh()
    })

  return (
    <div className="flex flex-col gap-3">
      <Card
        header={
          <div className="flex flex-col gap-1 mb-2">
            <span className="text-foreground font-studio font-medium text-base">
              {t('extensions:sources.title')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('extensions:sources.description')}
            </span>
          </div>
        }
      >
        <AddSourceForm removedPins={removedPins} onAdd={add} />
      </Card>
      {notice && <SourcesNoticeBanner notice={notice} />}
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('extensions:sources.none')}
        </p>
      ) : (
        sources.map((source) => (
          <SourceCatalog
            key={source.id}
            source={source}
            registry={registry}
            onRemove={() => remove(source.id)}
            onRotated={refresh}
            begin={begin}
          />
        ))
      )}
    </div>
  )
}
