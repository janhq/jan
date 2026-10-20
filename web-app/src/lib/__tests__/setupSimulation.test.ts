import { describe, expect, it } from 'vitest'
import { SETUP_SCENARIOS } from '../setupSimulation'
import { backendGpuFamily } from '../gpuBackendMatch'

// These scenarios stand in for hardware the team does not have, so a drift
// between them and the report shapes would silently make them useless.
describe('SETUP_SCENARIOS', () => {
  const names = Object.keys(SETUP_SCENARIOS)

  it('covers the states that need special hardware to reach', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'provisioning',
        'missingLibrary',
        'gpuUnreachable',
        'gpuUnused',
        'metal',
        'cpuOnly',
        'brokenEmbedder',
      ])
    )
  })

  it.each(names)('%s reports a complete gpu offload shape', (name) => {
    const { gpu } = SETUP_SCENARIOS[name]
    expect(typeof gpu.backend).toBe('string')
    expect(typeof gpu.gpuExpected).toBe('boolean')
    expect(typeof gpu.engineDeviceCount).toBe('number')
    expect(['ok', 'warning']).toContain(gpu.status)
  })

  it.each(names)('%s reports a complete embedding shape', (name) => {
    expect(['ok', 'warning']).toContain(SETUP_SCENARIOS[name].embedding.status)
  })

  it('names a real backend wherever it claims one', () => {
    for (const name of names) {
      const { backend } = SETUP_SCENARIOS[name].gpu
      if (!backend) continue
      expect(backendGpuFamily(backend), name).not.toBe('unknown')
    }
  })

  it('pairs a missingLibrary reason with the library names', () => {
    for (const name of names) {
      const { gpu } = SETUP_SCENARIOS[name]
      if (gpu.reason !== 'missingLibrary') continue
      expect(gpu.missingLibraries?.length, name).toBeGreaterThan(0)
    }
  })

  it('models Apple Silicon as a macOS backend with no enumerated device', () => {
    const { gpu } = SETUP_SCENARIOS.metal
    expect(backendGpuFamily(gpu.backend)).toBe('metal')
    expect(gpu.engineDeviceCount).toBe(0)
    expect(gpu.gpuExpected).toBe(false)
  })
})
