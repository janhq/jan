import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { getExtensionHost, type HostedExtension } from '@/lib/extensions/host'
import { reloadInstalled } from '@/lib/extensions/installed-reload'
import type {
  ExtensionsService,
  ListResult,
} from '@/services/extensions/types'

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** The host's extensions, re-read whenever one changes state. */
export function useHostedExtensions(): HostedExtension[] {
  const host = getExtensionHost()
  const [extensions, setExtensions] = useState(() => host.list())
  useEffect(() => {
    const subscription = host.onDidChange(() => setExtensions(host.list()))
    setExtensions(host.list())
    return () => subscription.dispose()
  }, [host])
  return extensions
}

export interface InstalledRegistry {
  service: ExtensionsService
  supported: boolean
  /** Undefined until the first read finishes. */
  registry?: ListResult
  refresh: () => Promise<void>
  /** True while a `change` runs; the controls that start one wait for it. */
  busy: boolean
  /**
   * Runs a registry change, then brings the running copy of `reloadId` in
   * line with it and re-reads the registry. Failures become a toast.
   */
  change: (action: () => Promise<unknown>, reloadId?: string) => Promise<void>
}

/** The installed-extensions registry of the install pipeline. */
export function useInstalledRegistry(): InstalledRegistry {
  const { t } = useTranslation()
  const service = useServiceHub().extensions()
  const supported = service.isSupported()
  const [registry, setRegistry] = useState<ListResult>()
  const [pending, setPending] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setRegistry(await service.list())
    } catch (e) {
      toast.error(t('extensions:errors.list', { error: errorMessage(e) }))
    }
  }, [service, t])

  useEffect(() => {
    if (supported) void refresh()
  }, [supported, refresh])

  const change = useCallback(
    async (action: () => Promise<unknown>, reloadId?: string) => {
      setPending((n) => n + 1)
      try {
        await action()
        if (reloadId) await reloadInstalled(reloadId)
      } catch (e) {
        toast.error(t('extensions:errors.change', { error: errorMessage(e) }))
      } finally {
        setPending((n) => n - 1)
      }
      await refresh()
    },
    [refresh, t]
  )

  return { service, supported, registry, refresh, busy: pending > 0, change }
}
