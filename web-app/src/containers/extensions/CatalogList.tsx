import { useCallback, useEffect, useId, useState } from 'react'
import { IconTrash } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
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
  CuratedIndex,
  IndexExtension,
  IndexSource,
  InstalledExtension,
  StagedInstall,
} from '@/services/extensions/types'
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

function AddSourceForm({
  onAdd,
}: {
  onAdd: (url: string, name: string, publicKey?: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [errors, setErrors] = useState<SourceErrors>({})
  const err = (code?: string) =>
    code ? t(`extensions:sources.errors.${code}`) : undefined

  const submit = async () => {
    const found = validateSource({ url, name, publicKey })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    await onAdd(url.trim(), name.trim(), publicKey.trim() || undefined)
    setUrl('')
    setName('')
    setPublicKey('')
  }

  return (
    <div className="flex flex-col gap-2">
      <Field
        label={t('extensions:sources.url')}
        value={url}
        onChange={setUrl}
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
    (!installed || compareVersions(latest.version, installed.active) > 0)
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

function SourceCatalog({
  source,
  registry,
  onRemove,
  begin,
}: {
  source: IndexSource
  registry: InstalledRegistry
  onRemove: () => void
  begin: Begin
}) {
  const { t } = useTranslation()
  const { service } = registry
  const [catalog, setCatalog] = useState<CuratedIndex>()
  const [error, setError] = useState<string>()

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
  }, [service, source.id, source.name, t])

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
            {source.publicKey && (
              <span className="text-xs text-muted-foreground">
                {t('extensions:sources.keyPinned')}
              </span>
            )}
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t('extensions:sources.remove', { name: source.name })}
            onClick={onRemove}
          >
            <IconTrash size={14} />
          </Button>
        </div>
      }
    >
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : !catalog ? (
        <span className="text-xs text-muted-foreground">
          {t('extensions:catalog.loading')}
        </span>
      ) : catalog.extensions.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          {t('extensions:catalog.empty')}
        </span>
      ) : (
        <ul className="divide-y divide-border">
          {catalog.extensions.map((entry) => (
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

  const refresh = useCallback(async () => {
    setSources(await service.listSources())
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
        <AddSourceForm onAdd={add} />
      </Card>
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
            begin={begin}
          />
        ))
      )}
    </div>
  )
}
