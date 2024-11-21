import { cpuInfo } from 'cpu-instructions'

// Check the CPU info and determine the supported instruction set
const info = cpuInfo.cpuInfo().some((e) => e.toUpperCase() === 'AVX512')
  ? 'avx512'
  : cpuInfo.cpuInfo().some((e) => e.toUpperCase() === 'AVX2')
    ? 'avx2'
    : cpuInfo.cpuInfo().some((e) => e.toUpperCase() === 'AVX')
      ? 'avx'
      : 'noavx'

// Send the result and wait for confirmation before exiting
new Promise<void>((resolve, reject) => {
  // @ts-ignore
  process.send(info, (error: Error | null) => {
    if (error) {
      reject(error)
    } else {
      resolve()
    }
  })
})
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed to send info:', error)
    process.exit(1)
  })
