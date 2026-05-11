import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useFavoriteModel } from '@/hooks/useFavoriteModel'
import { formatBytes } from '@/lib/utils'
import { useAppState } from '@/hooks/useAppState'
import { useShallow } from 'zustand/shallow'

import { IconTrash } from '@tabler/icons-react'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'

type DialogDeleteAllModelsProps = {
  provider: ModelProvider
}

export const DialogDeleteAllModels = ({
  provider,
}: DialogDeleteAllModelsProps) => {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { setProviders, deleteModel: deleteModelCache } = useModelProvider()
  const { removeFavorite } = useFavoriteModel()
  const [activeModels] = useAppState(useShallow((s) => [s.activeModels]))
  const [open, setOpen] = useState(false)
  const [totalBytes, setTotalBytes] = useState<number | undefined>(undefined)
  const [isDeleting, setIsDeleting] = useState(false)

  const downloadedIdsKey = provider.models
    .filter((m) => !m.imported)
    .map((m) => m.id)
    .sort()
    .join('|')
  const downloadedIds = useMemo(
    () => (downloadedIdsKey ? downloadedIdsKey.split('|') : []),
    [downloadedIdsKey]
  )
  const importedCount = provider.models.length - downloadedIds.length
  const modelCount = downloadedIds.length

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setTotalBytes(undefined)
    serviceHub
      .models()
      .fetchModels()
      .then((infos) => {
        if (cancelled) return
        const ids = new Set(downloadedIds)
        const total = infos
          .filter((i) => ids.has(i.id) && i.providerId === provider.provider)
          .reduce((sum, i) => sum + (i.sizeBytes || 0), 0)
        setTotalBytes(total)
      })
      .catch(() => {
        if (!cancelled) setTotalBytes(0)
      })
    return () => {
      cancelled = true
    }
  }, [open, provider.provider, serviceHub, downloadedIds])

  const handleDeleteAll = async () => {
    if (isDeleting) return
    setIsDeleting(true)
    const ids = downloadedIds
    let failed = 0

    for (const id of ids) {
      try {
        if (activeModels.includes(id)) {
          try {
            await serviceHub.models().stopModel(id, provider.provider)
          } catch {
            // best-effort stop; continue with delete
          }
        }
        removeFavorite(id)
        deleteModelCache(id)
        await serviceHub.models().deleteModel(id, provider.provider)
      } catch (err) {
        failed++
        console.error(`Failed to delete model ${id}:`, err)
      }
    }

    try {
      const providers = await serviceHub.providers().getProviders()
      const filtered = providers.map((p) =>
        p.provider === provider.provider
          ? { ...p, models: p.models.filter((m) => !ids.includes(m.id)) }
          : p
      )
      setProviders(filtered)
    } catch (err) {
      console.error('Failed to refresh providers after bulk delete:', err)
    }

    const succeeded = ids.length - failed
    if (succeeded > 0) {
      toast.success(
        t('providers:deleteAllModels.success', { count: succeeded })
      )
    }
    if (failed > 0) {
      toast.error(t('providers:deleteAllModels.partialFailure', { count: failed }))
    }

    setIsDeleting(false)
    setOpen(false)
  }

  if (modelCount === 0) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !isDeleting && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <IconTrash size={18} className="text-muted-foreground" />
          <span>{t('providers:deleteAllModels.button')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('providers:deleteAllModels.title')}</DialogTitle>
          <DialogDescription>
            {t('providers:deleteAllModels.description', { count: modelCount })}{' '}
            {t('providers:deleteAllModels.warning')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-md bg-main-view-fg/5 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {t('providers:deleteAllModels.sizeLabel')}
          </span>
          <span className="font-medium text-foreground">
            {totalBytes === undefined
              ? t('providers:deleteAllModels.calculating')
              : formatBytes(totalBytes, { fallback: '—' })}
          </span>
        </div>

        {importedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('providers:deleteAllModels.importedExcluded', {
              count: importedCount,
            })}
          </p>
        )}

        <DialogFooter className="mt-2">
          <DialogClose asChild>
            <Button variant="ghost" size="sm" disabled={isDeleting}>
              {t('providers:deleteModel.cancel')}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDeleteAll}
            disabled={isDeleting}
            autoFocus
          >
            {isDeleting
              ? t('providers:deleteAllModels.deleting')
              : t('providers:deleteAllModels.confirm', { count: modelCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
