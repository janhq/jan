import type {
  EmbeddingModelReport,
  GpuOffloadReport,
} from '@/services/models/types'
import type { DetectedGpu } from '@/lib/gpuBackendMatch'

/**
 * Development-only overrides for the first-run readiness reports.
 *
 * The degraded paths -- a missing CUDA library, an unreachable GPU, a broken
 * embedder, Apple Metal -- each need hardware or a broken install to reach, so
 * without this they ship untested by anyone who does not own the machine.
 *
 * Enable from the devtools console and reload; the names are the keys of
 * SETUP_SCENARIOS below:
 *
 *   localStorage.setItem('setup-scenario', 'missingLibrary')
 *   localStorage.removeItem('setup-scenario')   // back to real probes
 *
 * Inert in a production build: `import.meta.env.DEV` is statically false there,
 * so the whole lookup is dropped.
 */

export interface SetupScenario {
  hardware: { cpu?: { name?: string }; gpus?: DetectedGpu[] } | null
  gpu: GpuOffloadReport
  embedding: EmbeddingModelReport
}

const NVIDIA: DetectedGpu = {
  name: 'NVIDIA GeForce RTX 3090',
  vendor: 'NVIDIA',
  total_memory: 24576,
  driver_version: '550.54.14',
}

const CUDA = 'linux-cuda-13-common_cpus-x64'

export const SETUP_SCENARIOS: Record<string, SetupScenario> = {
  /** Mid-provisioning: the backend is still downloading. */
  provisioning: {
    hardware: { cpu: { name: 'Ryzen 9 7950X' }, gpus: [NVIDIA] },
    gpu: {
      status: 'ok',
      backend: '',
      gpuExpected: false,
      engineDeviceCount: 0,
      pending: true,
    },
    embedding: { status: 'ok', pending: true },
  },

  /** The reported case: a CUDA build whose GPU libraries are not installed. */
  missingLibrary: {
    hardware: { cpu: { name: 'Ryzen 9 7950X' }, gpus: [NVIDIA] },
    gpu: {
      status: 'warning',
      backend: CUDA,
      gpuExpected: true,
      engineDeviceCount: 0,
      reason: 'missingLibrary',
      missingLibraries: ['libnccl.so.2', 'libcublas.so.12'],
      error:
        'libnccl.so.2: cannot open shared object file: No such file or directory',
    },
    embedding: {
      status: 'ok',
      modelId: 'sentence-transformer-mini',
      dimension: 384,
    },
  },

  /** Driver or runtime too old: the library loads but enumerates no device. */
  gpuUnreachable: {
    hardware: { cpu: { name: 'Ryzen 9 7950X' }, gpus: [NVIDIA] },
    gpu: {
      status: 'warning',
      backend: CUDA,
      gpuExpected: true,
      engineDeviceCount: 0,
      reason: 'runtimeUnreachable',
      error: 'no CUDA-capable device is detected',
    },
    embedding: {
      status: 'ok',
      modelId: 'sentence-transformer-mini',
      dimension: 384,
    },
  },

  /** A discrete GPU sitting idle behind a CPU-only build. */
  gpuUnused: {
    hardware: { cpu: { name: 'Ryzen 9 7950X' }, gpus: [NVIDIA] },
    gpu: {
      status: 'ok',
      backend: 'linux-common_cpus-x64',
      gpuExpected: false,
      engineDeviceCount: 0,
    },
    embedding: {
      status: 'ok',
      modelId: 'sentence-transformer-mini',
      dimension: 384,
    },
  },

  /** Apple Silicon: Metal is implicit, so the engine reports no GPU build. */
  metal: {
    hardware: { cpu: { name: 'Apple M3 Max' }, gpus: [] },
    gpu: {
      status: 'ok',
      backend: 'macos-arm64',
      gpuExpected: false,
      engineDeviceCount: 0,
    },
    embedding: {
      status: 'ok',
      modelId: 'sentence-transformer-mini',
      dimension: 384,
    },
  },

  /** No GPU at all: the badge should say CPU without implying a fault. */
  cpuOnly: {
    hardware: { cpu: { name: 'Intel Core i5-10400' }, gpus: [] },
    gpu: {
      status: 'ok',
      backend: 'linux-common_cpus-x64',
      gpuExpected: false,
      engineDeviceCount: 0,
    },
    embedding: {
      status: 'ok',
      modelId: 'sentence-transformer-mini',
      dimension: 384,
    },
  },

  /** The embedder installed but cannot produce a usable vector. */
  brokenEmbedder: {
    hardware: { cpu: { name: 'Ryzen 9 7950X' }, gpus: [NVIDIA] },
    gpu: {
      status: 'ok',
      backend: CUDA,
      gpuExpected: true,
      engineDeviceCount: 1,
    },
    embedding: {
      status: 'warning',
      modelId: 'sentence-transformer-mini',
      problem: 'degenerate',
      dimension: 384,
      error: 'embedding vector was all zeroes (check the pooling type)',
    },
  },

  /** Every check unhappy at once, to see how the page prioritises. */
  everythingBroken: {
    hardware: null,
    gpu: {
      status: 'warning',
      backend: CUDA,
      gpuExpected: true,
      engineDeviceCount: 0,
      reason: 'missingLibrary',
      missingLibraries: ['libcudart.so.13'],
      error: 'libcudart.so.13: cannot open shared object file',
    },
    embedding: {
      status: 'warning',
      modelId: 'sentence-transformer-mini',
      problem: 'missing',
      error: 'llama.cpp router is not running. Please restart the app.',
    },
  },
}

export const SETUP_SCENARIO_STORAGE_KEY = 'setup-scenario'

/** The active scenario, or undefined in a production build. */
export function activeSetupScenario(): SetupScenario | undefined {
  if (!import.meta.env.DEV) return undefined
  try {
    const name = localStorage.getItem(SETUP_SCENARIO_STORAGE_KEY)
    if (!name) return undefined
    const scenario = SETUP_SCENARIOS[name]
    if (!scenario) {
      console.warn(
        `[setup] Unknown scenario "${name}". Available: ${Object.keys(
          SETUP_SCENARIOS
        ).join(', ')}`
      )
      return undefined
    }
    console.info(`[setup] Simulating the "${name}" scenario.`)
    return scenario
  } catch {
    return undefined
  }
}
