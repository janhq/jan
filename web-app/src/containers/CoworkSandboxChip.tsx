import { useCallback, useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { getSandboxStatus, refreshSandboxStatus } from '@/lib/agentTools'

/** Per-OS remedy. Never shown the raw `backend` value, which is `"none"` here. */
function fixKeyFor(platform: string): string {
  if (platform.includes('mac') || platform.includes('darwin')) {
    return 'common:sandbox.fixMac'
  }
  if (platform.includes('win')) return 'common:sandbox.fixWindows'
  return 'common:sandbox.fixLinux'
}

/**
 * Shown only when no OS sandbox can confine a shell, in which case `bash` is
 * withheld entirely rather than run unconfined. Without this the capability
 * just silently isn't offered, which reads as a broken agent.
 */
export function CoworkSandboxChip() {
  const { t } = useTranslation()
  const [enforces, setEnforces] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let alive = true
    void getSandboxStatus().then((s) => {
      if (alive) setEnforces(s.enforces)
    })
    return () => {
      alive = false
    }
  }, [])

  const recheck = useCallback(() => {
    setChecking(true)
    void refreshSandboxStatus()
      .then((s) => setEnforces(s.enforces))
      .finally(() => setChecking(false))
  }, [])

  // null while probing: stay out of the way rather than flash a warning.
  if (enforces !== false) return null

  const platform =
    typeof navigator === 'undefined' ? '' : navigator.platform.toLowerCase()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 rounded-full bg-amber-500/10 text-amber-600 shrink-0 hover:bg-amber-500/20 dark:text-amber-400"
          aria-label={t('common:sandbox.a11y')}
        >
          <TriangleAlert size={12} className="shrink-0" />
          <span>{t('common:sandbox.noTerminal')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <h3 className="text-sm font-medium">{t('common:sandbox.title')}</h3>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t('common:sandbox.body')}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {t(fixKeyFor(platform))}
        </p>
        <div className="mt-3 flex">
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={checking}
            onClick={recheck}
          >
            {t('common:sandbox.recheck')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
