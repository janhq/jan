import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockT } = vi.hoisted(() => ({
  mockT: vi.fn((key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}|${JSON.stringify(opts)}` : key
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  i18n: { t: mockT },
}))

import {
  parseEngineError,
  describeEngineError,
  ENGINE_ERROR_CODES,
} from '../engineError'

describe('parseEngineError', () => {
  it('reads a Tauri-serialized engine error', () => {
    const parsed = parseEngineError({
      code: 'MISSING_SHARED_LIBRARY',
      message: 'A library this backend depends on is missing.',
      details: 'libnccl.so.2: cannot open shared object file',
      missing_libraries: ['libnccl.so.2'],
    })

    expect(parsed).toEqual({
      code: 'MISSING_SHARED_LIBRARY',
      message: 'A library this backend depends on is missing.',
      details: 'libnccl.so.2: cannot open shared object file',
      missingLibraries: ['libnccl.so.2'],
    })
  })

  it('returns undefined for things that are not engine errors', () => {
    expect(parseEngineError(new Error('plain'))).toBeUndefined()
    expect(parseEngineError('string')).toBeUndefined()
    expect(parseEngineError(null)).toBeUndefined()
    expect(parseEngineError(undefined)).toBeUndefined()
    expect(parseEngineError({ message: 'no code' })).toBeUndefined()
  })

  // An unrecognized code from a newer engine must not be treated as a known one.
  it('rejects an unknown code', () => {
    expect(parseEngineError({ code: 'SOMETHING_NEW' })).toBeUndefined()
  })

  it('unwraps an engine error nested behind a message string', () => {
    const inner = JSON.stringify({
      code: 'OUT_OF_MEMORY',
      message: 'Out of memory.',
    })
    const parsed = parseEngineError(new Error(`Failed to start model: ${inner}`))

    expect(parsed?.code).toBe('OUT_OF_MEMORY')
  })

  it('tolerates a non-array missing_libraries', () => {
    const parsed = parseEngineError({
      code: 'MISSING_SHARED_LIBRARY',
      missing_libraries: 'libnccl.so.2',
    })

    expect(parsed?.missingLibraries).toBeUndefined()
  })
})

describe('describeEngineError', () => {
  beforeEach(() => {
    mockT.mockClear()
  })

  it('translates a known code instead of showing the Rust message', () => {
    const text = describeEngineError({
      code: 'GPU_DRIVER_TOO_OLD',
      message: 'The installed GPU driver is too old for this backend.',
    })

    expect(mockT).toHaveBeenCalledWith('model-errors:engine.GPU_DRIVER_TOO_OLD')
    expect(text).toBe('model-errors:engine.GPU_DRIVER_TOO_OLD')
    expect(text).not.toContain('backend')
  })

  it('appends the missing library names, which are not translatable', () => {
    const text = describeEngineError({
      code: 'MISSING_SHARED_LIBRARY',
      missing_libraries: ['libnccl.so.2', 'libcublas.so.12'],
    })

    expect(mockT).toHaveBeenCalledWith('model-errors:engineMissingLibraries', {
      libraries: 'libnccl.so.2, libcublas.so.12',
    })
    expect(text).toContain('libnccl.so.2, libcublas.so.12')
  })

  it('has a key for every code the engine can emit', () => {
    for (const code of ENGINE_ERROR_CODES) {
      mockT.mockClear()
      describeEngineError({ code })
      expect(mockT).toHaveBeenCalledWith(`model-errors:engine.${code}`)
    }
  })

  // Never surface raw JSON, which is what the old path did for a plain object.
  it('falls back to a translated generic message for an unknown shape', () => {
    const text = describeEngineError({ weird: true })

    expect(text).toBe('model-errors:engine.unknown')
    expect(text).not.toContain('{')
  })

  it('keeps a plain Error message, which is already human-readable', () => {
    expect(describeEngineError(new Error('No running session found'))).toBe(
      'No running session found'
    )
  })

  it('keeps a plain string error', () => {
    expect(describeEngineError('something broke')).toBe('something broke')
  })

  it('never returns an empty string', () => {
    for (const input of [new Error(''), '', '   ', {}, null, undefined]) {
      expect(describeEngineError(input).trim().length).toBeGreaterThan(0)
    }
  })
})
