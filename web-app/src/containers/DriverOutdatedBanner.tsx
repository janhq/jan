import { IconAlertTriangle, IconExternalLink } from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import type { GPU } from '@/hooks/useHardware'
import { useTranslation } from '@/i18n/react-i18next-compat'

/// Minimum NVIDIA driver on Windows required to enable CUDA 12.4 — the
/// lowest CUDA tier ggml-org ships for Windows in `llamacpp-upstream`.
/// Kept in sync with `min_cuda12_driver` in
/// `src-tauri/plugins/tauri-plugin-llamacpp-upstream/src/backend.rs`.
const MIN_WIN_CUDA12_DRIVER = '551.61'

const NVIDIA_DRIVERS_URL = 'https://www.nvidia.com/drivers'

/**
 * String-numeric version comparison that matches the Rust
 * `compare_versions` helper used on the backend side. Returns
 * a negative number when `a < b`, zero when equal, positive when `a > b`.
 * Missing trailing components are treated as zero.
 */
function compareDriverVersions(a: string, b: string): number {
  const partsA = a.split('.')
  const partsB = b.split('.')
  const maxLen = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < maxLen; i++) {
    const numA = parseInt(partsA[i] ?? '0', 10) || 0
    const numB = parseInt(partsB[i] ?? '0', 10) || 0
    if (numA < numB) return -1
    if (numA > numB) return 1
  }
  return 0
}

/**
 * Returns the first NVIDIA GPU whose driver is too old for any CUDA tier
 * ggml-org publishes for Windows (i.e. below `MIN_WIN_CUDA12_DRIVER`).
 * Returns `null` when no such GPU is present (no banner needed).
 *
 * The H7 cohort behind AtomicBot-ai/Atomic-Chat#25 — users on NVIDIA
 * driver 528.xx–550.xx that previously had CUDA 12.0 via the legacy
 * janhq mirror and now silently fall back to CPU after the ggml-org
 * switch (ADR 2026-05-22).
 */
export function findOutdatedNvidiaGpu(gpus: GPU[]): GPU | null {
  for (const gpu of gpus) {
    if (!gpu?.nvidia_info) continue
    if (!gpu.driver_version) continue
    if (compareDriverVersions(gpu.driver_version, MIN_WIN_CUDA12_DRIVER) < 0) {
      return gpu
    }
  }
  return null
}

interface DriverOutdatedBannerProps {
  gpus: GPU[]
  className?: string
}

/**
 * Yellow actionable banner shown when the host has an NVIDIA card whose
 * driver is too old for any CUDA tier shipped by `llamacpp-upstream`.
 *
 * Renders nothing when there is no qualifying GPU — the caller can
 * always mount it unconditionally.
 */
export function DriverOutdatedBanner({
  gpus,
  className,
}: DriverOutdatedBannerProps) {
  const { t } = useTranslation()
  const gpu = findOutdatedNvidiaGpu(gpus)
  if (!gpu) return null

  return (
    <div
      role="alert"
      className={
        'flex items-start gap-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm ' +
        (className ?? '')
      }
    >
      <IconAlertTriangle
        size={20}
        className="mt-0.5 shrink-0 text-yellow-600 dark:text-yellow-400"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="font-medium text-foreground">
          {t('system-monitor:driverOutdated.title')}
        </span>
        <span className="text-muted-foreground">
          {t('system-monitor:driverOutdated.description', {
            gpu: gpu.name,
            driver: gpu.driver_version,
            minDriver: MIN_WIN_CUDA12_DRIVER,
          })}
        </span>
        <div>
          <Button asChild size="sm" variant="outline" className="gap-1">
            <a
              href={NVIDIA_DRIVERS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconExternalLink size={14} />
              {t('system-monitor:driverOutdated.updateAction')}
            </a>
          </Button>
        </div>
      </div>
    </div>
  )
}

export default DriverOutdatedBanner
