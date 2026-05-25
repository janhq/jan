/**
 * Regression coverage for the Windows-only provider-routing bug fixed
 * alongside this file. See bug-report-roberto-1.1.79-ru and ADR
 * 2026-05-22 (*Windows ships only `llamacpp-upstream`*).
 *
 * Background: on Windows the build excludes `@janhq/llamacpp-extension`,
 * so the only local llama.cpp engine the EngineManager knows about is
 * registered under provider id `'llamacpp-upstream'`. Prior to the fix
 * `DefaultModelsService` hard-coded the lookup to `'llamacpp'`, which
 * resolved to `undefined` and made `pullModel` / `validateGgufFile` /
 * `isModelSupported` silently no-op — visible to users as "Download
 * stuck at 0%", a misleading "Model imported successfully" toast on
 * an empty list, and the `method not available in llamacpp engine`
 * console spam.
 *
 * `IS_WINDOWS` is a Vite global define that vitest pins to `false`
 * (web-app/vitest.config.ts), so we cannot flip the platform from
 * inside the test. Instead we override `LOCAL_LLAMACPP_PROVIDER`
 * (the centralized id from `@/lib/utils`) before importing the
 * service under test, which is exactly what would happen at build
 * time on a Windows host.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return {
    ...actual,
    LOCAL_LLAMACPP_PROVIDER: 'llamacpp-upstream',
  }
})

const WINDOWS_LLAMACPP_PROVIDER = 'llamacpp-upstream'

const { mockEvents, mockDownloadEvent } = vi.hoisted(() => ({
  mockEvents: {
    emit: vi.fn(),
  },
  mockDownloadEvent: {
    onFileDownloadStopped: 'onFileDownloadStopped',
  } as Record<string, string>,
}))

vi.mock('@janhq/core', () => ({
  EngineManager: {
    instance: vi.fn(),
  },
  events: mockEvents,
  DownloadEvent: mockDownloadEvent,
}))

import { DefaultModelsService } from '../models/default'
import { EngineManager } from '@janhq/core'

describe('DefaultModelsService — Windows provider routing', () => {
  let modelsService: DefaultModelsService

  const upstreamEngine = {
    import: vi.fn().mockResolvedValue(undefined),
    abortImport: vi.fn().mockResolvedValue(undefined),
    isModelSupported: vi
      .fn<
        (path: string, ctxSize?: number) => Promise<'RED' | 'YELLOW' | 'GREEN'>
      >()
      .mockResolvedValue('GREEN'),
    validateGgufFile: vi.fn().mockResolvedValue({ isValid: true }),
    checkMmprojExists: vi.fn().mockResolvedValue(true),
  }

  const engineManagerGet = vi.fn((provider: string) =>
    provider === WINDOWS_LLAMACPP_PROVIDER ? upstreamEngine : undefined
  )

  beforeEach(() => {
    vi.clearAllMocks()
    ;(EngineManager.instance as ReturnType<typeof vi.fn>).mockReturnValue({
      get: engineManagerGet,
    })
    modelsService = new DefaultModelsService()
  })

  it('pullModel resolves the llamacpp-upstream engine when running on Windows', async () => {
    await modelsService.pullModel('m1', '/abs/m1.gguf')

    expect(engineManagerGet).toHaveBeenCalledWith(WINDOWS_LLAMACPP_PROVIDER)
    expect(engineManagerGet).not.toHaveBeenCalledWith('llamacpp')
    expect(upstreamEngine.import).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ modelPath: '/abs/m1.gguf' })
    )
  })

  it('validateGgufFile delegates to the upstream engine, not a missing `llamacpp` one', async () => {
    const result = await modelsService.validateGgufFile('/abs/m1.gguf')

    expect(upstreamEngine.validateGgufFile).toHaveBeenCalledWith(
      '/abs/m1.gguf'
    )
    expect(result).toEqual({ isValid: true })
  })

  it('isModelSupported delegates to the upstream engine, not a missing `llamacpp` one', async () => {
    const status = await modelsService.isModelSupported('/abs/m1.gguf', 4096)

    expect(upstreamEngine.isModelSupported).toHaveBeenCalledWith(
      '/abs/m1.gguf',
      4096
    )
    expect(status).toBe('GREEN')
  })

  it('abortDownload tries the upstream llama.cpp engine first', async () => {
    await modelsService.abortDownload('m1')

    expect(engineManagerGet).toHaveBeenCalledWith(WINDOWS_LLAMACPP_PROVIDER)
    expect(upstreamEngine.abortImport).toHaveBeenCalledWith('m1')
  })
})
