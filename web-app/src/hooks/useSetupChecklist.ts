import { useCallback, useEffect, useRef, useState } from 'react'
import { AppEvent, DownloadEvent, events } from '@janhq/core'
import { getServiceHub } from '@/hooks/useServiceHub'
import { activeSetupScenario } from '@/lib/setupSimulation'
import {
  backendGpuFamily,
  describeGpus,
  evaluateBackendGpuMatch,
  type BackendGpuFamily,
  type DetectedGpu,
} from '@/lib/gpuBackendMatch'
import type {
  EmbeddingModelReport,
  EmbeddingVectorProblem,
  GpuOffloadReason,
  GpuOffloadReport,
} from '@/services/models/types'

export type SetupStageId = 'system' | 'engine' | 'search'
export type SetupStageStatus = 'pending' | 'running' | 'ok' | 'warning'

export interface SetupStageState {
  id: SetupStageId
  status: SetupStageStatus
  /** Key under the `setup` i18n namespace; the hook never produces prose. */
  messageKey?: string
  values?: Record<string, string | number>
  /** Raw technical detail for a disclosure area; never translated. */
  detail?: string
  /**
   * Structured form of the names in `values.libraries`, so install advice can be
   * rendered from them rather than parsed back out of the display string.
   */
  missingLibraries?: string[]
  /** The backend the libraries belong to, for platform-specific advice. */
  backend?: string
}

const STAGE_ORDER: SetupStageId[] = ['system', 'engine', 'search']

/** Emitted by the llamacpp extension; it predates the AppEvent enum. */
const ENGINE_SETTINGS_CHANGED = 'settingsChanged'

// `missingLibrary` is the same symptom as `runtimeUnreachable` with the cause
// identified, so it gets its own message naming the dependency.
const ENGINE_REASON_KEYS: Record<GpuOffloadReason, string> = {
  noGpuHardware: 'checkEngineNoGpuHardware',
  runtimeUnreachable: 'checkEngineRuntimeUnreachable',
  missingLibrary: 'checkEngineMissingLibrary',
}

// `missing`/`empty` mean nothing came back; `nonFinite`/`degenerate` mean a
// vector came back that would poison similarity scoring. Different causes,
// so different advice.
const VECTOR_PROBLEM_KEYS: Record<EmbeddingVectorProblem, string> = {
  missing: 'checkSearchNoVector',
  empty: 'checkSearchNoVector',
  nonFinite: 'checkSearchInvalidVector',
  degenerate: 'checkSearchInvalidVector',
}

/**
 * Whether inference will actually run on the GPU, for the badge the setup screen
 * shows. `willUse` stays undefined while the engine is still setting itself up,
 * since neither answer is known yet.
 */
export interface GpuVerdict {
  willUse?: boolean
  /** Detected hardware, e.g. `NVIDIA RTX 4070 (8 GB)`; empty when none. */
  label: string
}

function gpuVerdict(
  report: GpuOffloadReport | undefined,
  gpus: DetectedGpu[]
): GpuVerdict {
  const label = describeGpus(gpus)
  if (!report || report.pending || report.unavailable) return { label }

  // Metal is compiled into every macOS build and always present, so the engine
  // never reports it as "a GPU build" and never enumerates it as a device.
  // Reading those absences literally told Apple Silicon users they were on CPU.
  if (backendGpuFamily(report.backend) === 'metal') {
    return { willUse: true, label }
  }

  // Elsewhere a GPU build that found no device runs on the CPU regardless of
  // what is installed, so the device count decides rather than the name.
  return { willUse: report.gpuExpected && report.engineDeviceCount > 0, label }
}

const pendingStages = (): SetupStageState[] =>
  STAGE_ORDER.map((id) => ({ id, status: 'pending' }))

const errorDetail = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

type HardwareInfo = {
  cpu?: { name?: string }
  gpus?: DetectedGpu[]
}

// Naming the vendor a build requires is more actionable than naming the API,
// and the two vendor-locked families map one-to-one onto a vendor.
const FAMILY_VENDOR_NAMES: Partial<Record<BackendGpuFamily, string>> = {
  cuda: 'NVIDIA',
  hip: 'AMD',
}

function systemStage(info: HardwareInfo | null): SetupStageState {
  const gpus = info?.gpus ?? []
  if (gpus.length === 0) {
    return {
      id: 'system',
      status: 'ok',
      messageKey: 'checkSystemCpuOnly',
      values: { cpu: info?.cpu?.name ?? '' },
    }
  }

  // Every GPU is listed: on a hybrid laptop the integrated one often sorts
  // first, and reporting only that reads as "no discrete GPU found".
  const driver = gpus.find((gpu) => gpu.driver_version)?.driver_version
  return {
    id: 'system',
    status: 'ok',
    messageKey: driver ? 'checkSystemGpu' : 'checkSystemGpuNoDriver',
    values: { gpus: describeGpus(gpus), driver: driver ?? '' },
  }
}

function engineStage(
  report: GpuOffloadReport,
  gpus: DetectedGpu[]
): SetupStageState {
  if (report.unavailable) {
    return {
      id: 'engine',
      status: 'warning',
      messageKey: 'checkEngineUnavailable',
    }
  }
  if (report.pending) {
    return {
      id: 'engine',
      status: 'running',
      messageKey: 'checkEnginePreparing',
    }
  }
  if (report.status === 'ok') {
    // The engine only reports whether a GPU build found a device. It cannot
    // report the inverse, so a GPU left idle by a CPU-only build -- or a build
    // for the wrong vendor -- is caught here instead.
    const match = evaluateBackendGpuMatch(gpus, report.backend)
    // On a fresh install the engine is still downloading a backend, so there is
    // nothing to judge yet. Reported as in-progress, never as a warning: it
    // resolves on its own and the checklist re-runs when it does.
    if (match.kind === 'unknown') {
      return {
        id: 'engine',
        status: 'running',
        messageKey: 'checkEnginePreparing',
      }
    }
    if (match.kind === 'gpuUnused') {
      return {
        id: 'engine',
        status: 'warning',
        messageKey: 'checkEngineGpuUnused',
        values: { backend: report.backend, gpus: describeGpus(match.gpus) },
      }
    }
    if (match.kind === 'vendorMismatch') {
      return {
        id: 'engine',
        status: 'warning',
        messageKey: 'checkEngineVendorMismatch',
        values: {
          backend: report.backend,
          vendor: FAMILY_VENDOR_NAMES[match.family] ?? match.family,
          gpus: describeGpus(match.gpus),
        },
      }
    }
    return {
      id: 'engine',
      status: 'ok',
      messageKey: report.gpuExpected ? 'checkEngineGpu' : 'checkEngineCpu',
      values: { backend: report.backend },
    }
  }
  // A failed device probe leaves no reason code, so report the raw cause rather
  // than guess between "no GPU" and "unreachable GPU".
  const messageKey = report.reason
    ? ENGINE_REASON_KEYS[report.reason]
    : 'checkEngineProbeFailed'

  return {
    id: 'engine',
    status: 'warning',
    messageKey,
    values: {
      backend: report.backend,
      libraries: (report.missingLibraries ?? []).join(', '),
    },
    detail: report.error,
    missingLibraries: report.missingLibraries,
    backend: report.backend,
  }
}

function searchStage(report: EmbeddingModelReport): SetupStageState {
  if (report.unavailable) {
    return {
      id: 'search',
      status: 'warning',
      messageKey: 'checkSearchUnavailable',
    }
  }
  if (report.pending) {
    return {
      id: 'search',
      status: 'running',
      messageKey: 'checkSearchPreparing',
    }
  }
  if (report.status === 'ok') {
    return {
      id: 'search',
      status: 'ok',
      messageKey: 'checkSearchReady',
      values: { model: report.modelId ?? '', dimension: report.dimension ?? 0 },
    }
  }
  return {
    id: 'search',
    status: 'warning',
    messageKey: report.problem
      ? VECTOR_PROBLEM_KEYS[report.problem]
      : 'checkSearchProbeFailed',
    values: { model: report.modelId ?? '' },
    detail: report.error,
  }
}

/**
 * Runs the first-run readiness checks and reports each as a checklist row.
 * Every check is advisory: a failure produces a warning row, never a block, so
 * a false negative cannot strand a user whose install actually works.
 */
export function useSetupChecklist(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true
  const [stages, setStages] = useState<SetupStageState[]>(pendingStages)
  const [gpu, setGpu] = useState<GpuVerdict>({ label: '' })
  const [isRunning, setIsRunning] = useState(false)
  const runningRef = useRef(false)

  const rerunQueuedRef = useRef(false)

  const rerun = useCallback(async () => {
    // A request arriving mid-run is queued rather than dropped: it usually
    // carries newer state than the run in flight observed.
    if (runningRef.current) {
      rerunQueuedRef.current = true
      return
    }
    runningRef.current = true
    setIsRunning(true)
    setStages(STAGE_ORDER.map((id) => ({ id, status: 'running' })))

    const hub = getServiceHub()
    // A development override stands in for hardware nobody on the team has; it
    // is compiled out of a production build.
    const scenario = activeSetupScenario()
    // Run together and settle independently: one dead probe must not suppress
    // the verdicts of the others.
    const [system, engine, search] = scenario
      ? ([
          { status: 'fulfilled', value: scenario.hardware },
          { status: 'fulfilled', value: scenario.gpu },
          { status: 'fulfilled', value: scenario.embedding },
        ] as const)
      : await Promise.allSettled([
          hub.hardware().getHardwareInfo(),
          hub.models().verifyGpuOffload(),
          hub.models().verifyEmbeddingModel(),
        ])

    const hardware =
      system.status === 'fulfilled'
        ? (system.value as HardwareInfo | null)
        : null

    const next: SetupStageState[] = [
      system.status === 'fulfilled'
        ? systemStage(hardware)
        : {
            id: 'system',
            status: 'warning',
            messageKey: 'checkSystemFailed',
            detail: errorDetail(system.reason),
          },
      engine.status === 'fulfilled'
        ? engineStage(engine.value, hardware?.gpus ?? [])
        : {
            id: 'engine',
            status: 'warning',
            messageKey: 'checkEngineProbeFailed',
            detail: errorDetail(engine.reason),
          },
      search.status === 'fulfilled'
        ? searchStage(search.value)
        : {
            id: 'search',
            status: 'warning',
            messageKey: 'checkSearchProbeFailed',
            detail: errorDetail(search.reason),
          },
    ]

    setStages(next)
    setGpu(
      gpuVerdict(
        engine.status === 'fulfilled' ? engine.value : undefined,
        hardware?.gpus ?? []
      )
    )
    setIsRunning(false)
    runningRef.current = false

    if (rerunQueuedRef.current) {
      rerunQueuedRef.current = false
      void rerun()
    }
  }, [])

  useEffect(() => {
    if (enabled) void rerun()
  }, [enabled, rerun])

  // The first run of these checks races the engine's own background setup: the
  // backend is picked, then downloaded, then the router starts, then the
  // embedding model is fetched. Each milestone invalidates an earlier verdict,
  // so the checklist follows them instead of reporting a single early snapshot.
  useEffect(() => {
    if (!enabled) return

    const onEngineSettingChanged = (payload?: { key?: string }) => {
      if (
        payload?.key === 'llamacpp_version' ||
        payload?.key === 'llamacpp_backend'
      ) {
        void rerun()
      }
    }
    const onDownloadSuccess = (payload?: { downloadType?: string }) => {
      if (payload?.downloadType === 'Engine') void rerun()
    }
    const onModelImported = (payload?: { embedding?: boolean }) => {
      if (payload?.embedding) void rerun()
    }

    events.on(ENGINE_SETTINGS_CHANGED, onEngineSettingChanged)
    events.on(DownloadEvent.onFileDownloadSuccess, onDownloadSuccess)
    events.on(AppEvent.onModelImported, onModelImported)

    return () => {
      events.off(ENGINE_SETTINGS_CHANGED, onEngineSettingChanged)
      events.off(DownloadEvent.onFileDownloadSuccess, onDownloadSuccess)
      events.off(AppEvent.onModelImported, onModelImported)
    }
  }, [enabled, rerun])

  return {
    stages,
    warnings: stages.filter((s) => s.status === 'warning'),
    gpu,
    isRunning,
    rerun,
  }
}
