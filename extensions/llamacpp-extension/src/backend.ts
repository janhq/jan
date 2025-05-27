// Windows: intel64 and ARM + Nvidia, Intel, AMD,
// Linux: jntel64 and arm + same as windows,
// Mac: arm + intel64 metal

// folder structure
// <Jan's data folder>/llamacpp/backends/<backend_name>

export async function listBackends(): Promise<string[]> {
    const sysInfo = await window.core.api.getSystemInfo()
    const os_type = sysInfo.os_type
    const arch = sysInfo.cpu.arch

    const key = `${os_type}-${arch}`
    let backends = []

    if (key == 'windows-x86_64') {
        backends.push('win-noavx-x64', 'win-avx-x64', 'win-avx2-x64', 'win-avx512-x64')
    }
    else if (key == 'linux-x86_64') {
        backends.push('linux-noavx-x64', 'linux-avx-x64', 'linux-avx2-x64', 'linux-avx512-x64')
    }
    else if (key === 'macos-x86_64') {
        backends.push('macos-x64')
    }
    else if (key === 'macos-aarch64') {
        backends.push('macos-arm64')
    }

    return backends
}
