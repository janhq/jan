/** Maps a raw backend identifier to a human-readable display name. */
export function getBackendDisplayName(backend: string): string {
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

export type InstallRecommendation = {
  label: string
  description: string
  url?: string
  /** Raw lib names that triggered this recommendation */
  libs: string[]
}

/**
 * Groups raw missing library names into actionable install recommendations.
 * Returns recommendations and any libs not covered by a known group.
 */
export function getInstallRecommendations(
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

  // Bundled backend libs must be checked FIRST so that names like
  // libggml-cuda.so are claimed here rather than by the CUDA filter below.
  // These are shipped inside the backend archive — missing means corrupted download.
  const bundledLibs = missingLibs.filter((lib) => {
    const l = lib.toLowerCase()
    return l.includes('ggml') || l.includes('llama')
  })
  if (bundledLibs.length > 0) {
    bundledLibs.forEach((l) => coveredLibs.add(l))
    recommendations.push({
      label: 'Re-download the backend',
      description:
        'Some core backend files are missing or corrupted — this usually means the download was interrupted or the archive was only partially extracted. Delete the backend and re-download it from Jan settings.',
      libs: bundledLibs,
    })
  }

  // CUDA runtime/compute libs. Filters against coveredLibs so that bundled
  // libs like libggml-cuda.so are not double-counted here.
  const cudaLibs = missingLibs.filter((lib) => {
    if (coveredLibs.has(lib)) return false
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

  // NCCL — only relevant on CUDA backends; guard on cudaVersion to avoid
  // false positives on CPU/Vulkan backends.
  const ncclLibs = cudaVersion !== null
    ? missingLibs.filter((lib) => !coveredLibs.has(lib) && lib.toLowerCase().includes('nccl'))
    : []
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
  const cudnnLibs = missingLibs.filter((lib) => !coveredLibs.has(lib) && lib.toLowerCase().includes('cudnn'))
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
    if (coveredLibs.has(lib)) return false
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

