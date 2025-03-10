import { describe, it, expect, vi } from 'vitest'
// Mocks

const CORTEX_API_URL = 'http://localhost:3000'
vi.stubGlobal('CORTEX_API_URL', CORTEX_API_URL)

vi.mock('@janhq/core/node', (actual) => ({
  ...actual(),
  getJanDataFolderPath: () => '',
  appResourcePath: () => '/mock/path',
  log: vi.fn(),
  getSystemResourceInfo: () => {
    return {
      cpu: {
        cores: 1,
        logicalCores: 1,
        threads: 1,
        model: 'model',
        speed: 1,
      },
      memory: {
        total: 1,
        free: 1,
      },
      gpu: {
        model: 'model',
        memory: 1,
        cuda: {
          version: 'version',
          devices: 'devices',
        },
        vulkan: {
          version: 'version',
          devices: 'devices',
        },
      },
    }
  },
}))

vi.mock('fs', () => ({
  default: {
    readdirSync: () => [],
  },
}))

vi.mock('./watchdog', () => {
  return {
    ProcessWatchdog: vi.fn().mockImplementation(() => {
      return {
        start: vi.fn(),
        terminate: vi.fn(),
      }
    }),
  }
})

vi.mock('child_process', () => ({
  exec: () => {
    return {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    }
  },
  spawn: () => {
    return {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      pid: '111',
    }
  },
}))

import index from './index'

describe('Cortex extension node interface', () => {
  describe('run', () => {
    it('should start the cortex subprocess on macOS', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
      })

      const result = await index.run()
      expect(result).toBeUndefined()
    })

    it('should start the cortex subprocess on Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
      })

      const result = await index.run()
      expect(result).toBeUndefined()
    })

    it('should set the proper environment variables based on platform', async () => {
      // Test for Windows
      Object.defineProperty(process, 'platform', {
        value: 'win32',
      })
      process.env.PATH = '/original/path'

      await index.run()
      expect(process.env.PATH).toContain('/original/path')

      // Test for non-Windows (macOS/Linux)
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
      })
      process.env.LD_LIBRARY_PATH = '/original/ld/path'

      await index.run()
      expect(process.env.LD_LIBRARY_PATH).toContain('/original/ld/path')
    })
  })

  describe('dispose', () => {
    it('should dispose a model successfully on Mac', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
      })

      // Call the dispose function
      const result = index.dispose()

      // Assert that the result is as expected
      expect(result).toBeUndefined()
    })

    it('should kill the subprocess successfully on Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
      })

      // Call the dispose function
      const result = index.dispose()

      // Assert that the result is as expected
      expect(result).toBeUndefined()
    })
  })
})
