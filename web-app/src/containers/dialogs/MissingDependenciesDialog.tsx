import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { events, AppEvent } from '@janhq/core'
import { useEffect, useState } from 'react'

type VerificationFailedPayload = {
  backend: string
  version: string
  missingLibraries: string[]
}

/** Maps a raw backend identifier to a human-readable display name. */
function getBackendDisplayName(backend: string): string {
  const b = backend.toLowerCase()
  if (b.includes('cuda-13') || b.includes('cuda13')) return 'NVIDIA CUDA 13 Backend'
  if (b.includes('cuda-12') || b.includes('cuda12')) return 'NVIDIA CUDA 12 Backend'
  if (b.includes('cuda-11') || b.includes('cuda11')) return 'NVIDIA CUDA 11 Backend'
  if (b.includes('cuda')) return 'NVIDIA CUDA Backend'
  if (b.includes('vulkan')) return 'Vulkan Backend'
  if (b.includes('metal')) return 'Apple Metal Backend'
  if (b.includes('cpu') || b.includes('common_cpu') || b.includes('common-cpu')) return 'CPU Backend'
  return backend
}

type InstallRecommendation = {
  label: string
  description: string
  url: string
  /** Raw lib names that triggered this recommendation */
  libs: string[]
}

/**
 * Groups raw missing library names into actionable install recommendations.
 * Returns recommendations and any libs not covered by a known group.
 */
function getInstallRecommendations(
  missingLibs: string[],
  backend: string
): { recommendations: InstallRecommendation[]; uncovered: string[] } {
  const b = backend.toLowerCase()
  const isWindows = IS_WINDOWS
  const isLinux = IS_LINUX

  const cudaVersion = b.includes('cuda-13') || b.includes('cuda13')
    ? '13'
    : b.includes('cuda-12') || b.includes('cuda12')
      ? '12'
      : b.includes('cuda-11') || b.includes('cuda11')
        ? '11'
        : null

  const recommendations: InstallRecommendation[] = []
  const coveredLibs = new Set<string>()

  // CUDA runtime/compute libs (excluding NCCL which has its own package)
  const cudaLibs = missingLibs.filter((lib) => {
    const l = lib.toLowerCase()
    return (
      l.startsWith('libcuda') ||
      l.startsWith('cuda') ||
      l.includes('cublas') ||
      l.includes('curand') ||
      l.includes('cufft') ||
      l.includes('cusolver') ||
      l.includes('cusparse') ||
      l.includes('cudart') ||
      l.startsWith('nvcuda') ||
      l === 'cuda.dll'
    )
  })

  if (cudaLibs.length > 0) {
    cudaLibs.forEach((l) => coveredLibs.add(l))
    const versionSuffix = cudaVersion ? ` ${cudaVersion}` : ''
    recommendations.push({
      label: `NVIDIA CUDA Toolkit${versionSuffix}`,
      description: isWindows
        ? `Install the CUDA Toolkit${versionSuffix} from NVIDIA. During installation, select "CUDA" components.`
        : `Install the CUDA Toolkit${versionSuffix} from NVIDIA. On Debian/Ubuntu: sudo apt install cuda-toolkit-${cudaVersion ?? '12'}. On RHEL/Fedora: use the NVIDIA repo.`,
      url: 'https://developer.nvidia.com/cuda-downloads',
      libs: cudaLibs,
    })
  }

  // NCCL — separate from CUDA Toolkit, distributed via NVIDIA Deep Learning repo
  const ncclLibs = missingLibs.filter((lib) => lib.toLowerCase().includes('nccl'))
  if (ncclLibs.length > 0) {
    ncclLibs.forEach((l) => coveredLibs.add(l))
    recommendations.push({
      label: 'NVIDIA NCCL',
      description: isWindows
        ? 'Install NCCL from the NVIDIA Developer site. NCCL is used for multi-GPU collective communications.'
        : 'Install NCCL via the NVIDIA package repository. On Debian/Ubuntu: sudo apt install libnccl2 libnccl-dev. See the NVIDIA NCCL install guide for your distro.',
      url: 'https://developer.nvidia.com/nccl/nccl-download',
      libs: ncclLibs,
    })
  }

  // cuDNN libs
  const cudnnLibs = missingLibs.filter((lib) => lib.toLowerCase().includes('cudnn'))
  if (cudnnLibs.length > 0) {
    cudnnLibs.forEach((l) => coveredLibs.add(l))
    recommendations.push({
      label: 'NVIDIA cuDNN',
      description: isWindows
        ? 'Install cuDNN from the NVIDIA Developer site and place the DLLs alongside the application or in System32.'
        : 'Install cuDNN via the NVIDIA package repository or download the tarball and copy libs to /usr/local/cuda/lib64.',
      url: 'https://developer.nvidia.com/cudnn-downloads',
      libs: cudnnLibs,
    })
  }

  // Vulkan libs
  const vulkanLibs = missingLibs.filter((lib) => {
    const l = lib.toLowerCase()
    return l.includes('vulkan') || l === 'libvulkan.so' || l === 'libvulkan.so.1' || l === 'vulkan-1.dll'
  })
  if (vulkanLibs.length > 0) {
    vulkanLibs.forEach((l) => coveredLibs.add(l))
    const vulkanUrl = isWindows
      ? 'https://vulkan.lunarg.com/sdk/home#windows'
      : isLinux
        ? 'https://vulkan.lunarg.com/sdk/home#linux'
        : 'https://vulkan.lunarg.com/sdk/home'
    recommendations.push({
      label: 'Vulkan Runtime',
      description: isWindows
        ? 'Install the Vulkan Runtime from LunarG. Your GPU driver may already include it — update your GPU driver first.'
        : 'Install the Vulkan loader: on Ubuntu/Debian: sudo apt install libvulkan1. On Arch: sudo pacman -S vulkan-icd-loader. On RHEL/Fedora: sudo dnf install vulkan-loader.',
      url: vulkanUrl,
      libs: vulkanLibs,
    })
  }

  const uncovered = missingLibs.filter((lib) => !coveredLibs.has(lib))
  return { recommendations, uncovered }
}

export default function MissingDependenciesDialog() {
  const { t } = useTranslation()
  const [payload, setPayload] = useState<VerificationFailedPayload | undefined>()
  const [showRawLibs, setShowRawLibs] = useState(false)

  useEffect(() => {
    const handler = (data: VerificationFailedPayload) => {
      setPayload(data)
      setShowRawLibs(false)
    }
    events.on(AppEvent.onBackendVerificationFailed, handler)
    return () => {
      events.off(AppEvent.onBackendVerificationFailed, handler)
    }
  }, [])

  const displayName = payload ? getBackendDisplayName(payload.backend) : ''
  const { recommendations, uncovered } = payload
    ? getInstallRecommendations(payload.missingLibraries, payload.backend)
    : { recommendations: [], uncovered: [] }
  const allRawLibs = payload?.missingLibraries ?? []

  return (
    <Dialog
      open={!!payload}
      onOpenChange={(open) => !open && setPayload(undefined)}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
              <AlertTriangle className="size-4 text-destructive" />
            </div>
            <div>
              <DialogTitle>
                {t('common:missingDependenciesDialog.title')}
              </DialogTitle>
              <DialogDescription className="mt-1 text-main-view-fg/70">
                {t('common:missingDependenciesDialog.description', {
                  backend: displayName,
                })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3">
          {recommendations.length > 0 ? (
            <>
              <p className="text-sm text-main-view-fg/60">
                {t('common:missingDependenciesDialog.installLabel')}
              </p>
              <ul className="space-y-2">
                {recommendations.map((rec) => (
                  <li
                    key={rec.label}
                    className="rounded-lg border border-main-view-fg/10 bg-main-view-fg/2 p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-main-view-fg">
                        {rec.label}
                      </span>
                      <a
                        href={rec.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 shrink-0"
                      >
                        {t('common:missingDependenciesDialog.download')}
                        <ExternalLink className="size-3" />
                      </a>
                    </div>
                    <p className="text-xs text-main-view-fg/60 leading-relaxed">
                      {rec.description}
                    </p>
                  </li>
                ))}
              </ul>

              {uncovered.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-main-view-fg/50">
                    {t('common:missingDependenciesDialog.additionalLibraries')}
                  </p>
                  <ul className="space-y-1">
                    {uncovered.map((lib) => (
                      <li
                        key={lib}
                        className="text-xs font-mono text-main-view-fg/70 bg-main-view-fg/5 px-2 py-1 rounded border border-main-view-fg/5 break-all"
                      >
                        {lib}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            // No known group — fall back to raw list
            <div className="space-y-1">
              <p className="text-sm text-main-view-fg/60">
                {t('common:missingDependenciesDialog.missingLibraries')}
              </p>
              <ul className="max-h-[180px] overflow-y-auto space-y-1">
                {allRawLibs.map((lib) => (
                  <li
                    key={lib}
                    className="text-sm font-mono text-main-view-fg/80 bg-main-view-fg/10 px-2 py-1 rounded border border-main-view-fg/5 break-all"
                  >
                    {lib}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Collapsible raw lib names when recommendations are shown */}
          {recommendations.length > 0 && allRawLibs.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowRawLibs((v) => !v)}
                className="flex items-center gap-1 text-xs text-main-view-fg/40 hover:text-main-view-fg/60 transition-colors"
              >
                {showRawLibs ? (
                  <ChevronUp className="size-3" />
                ) : (
                  <ChevronDown className="size-3" />
                )}
                {t('common:missingDependenciesDialog.showRawLibraries', {
                  count: allRawLibs.length,
                })}
              </button>
              {showRawLibs && (
                <ul className="mt-2 max-h-[120px] overflow-y-auto space-y-1">
                  {allRawLibs.map((lib) => (
                    <li
                      key={lib}
                      className="text-xs font-mono text-main-view-fg/50 bg-main-view-fg/5 px-2 py-0.5 rounded break-all"
                    >
                      {lib}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="link"
            onClick={() => setPayload(undefined)}
            autoFocus
            className="flex-1 text-right sm:flex-none border border-main-view-fg/20 !px-2"
          >
            {t('common:dismiss')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
