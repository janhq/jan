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
  engineFailure,
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

  // The localized sentence is advice; the engine's own text is the evidence.
  // Dropping it left an OOM indistinguishable from any other load failure.
  it('appends the engine reason so the cause is visible, not just the advice', () => {
    const text = describeEngineError({
      code: 'OUT_OF_MEMORY',
      message: 'Out of memory.',
      details:
        'could not start the llama.cpp engine: failed to load model; cudaMalloc failed: out of memory',
    })

    expect(mockT).toHaveBeenCalledWith('model-errors:engineReportedDetail', {
      detail:
        'could not start the llama.cpp engine: failed to load model; cudaMalloc failed: out of memory',
    })
    expect(text).toContain('cudaMalloc failed: out of memory')
  })

  it('collapses whitespace and clips a log-sized detail', () => {
    const text = describeEngineError({
      code: 'MODEL_LOAD_FAILED',
      details: `line one\n   line two${' padding'.repeat(60)}`,
    })

    const detail = mockT.mock.calls.find(
      ([key]) => key === 'model-errors:engineReportedDetail'
    )?.[1]?.detail as string

    expect(detail).toContain('line one line two')
    expect(detail).not.toContain('\n')
    expect(detail.length).toBeLessThan(250)
    expect(detail.endsWith('...')).toBe(true)
  })

  // `find_session_by_model` and `get_loaded_models` return String errors, so
  // the plugin sends the structured error as JSON inside the string, and the
  // extension rethrows it as `new Error(String(e))`. It has to come out as the
  // localized sentence plus the evidence, not as the raw JSON.
  it('describes an engine-stopped error that arrived inside an Error message', () => {
    const fromRust = JSON.stringify({
      code: 'ENGINE_STOPPED',
      message: 'The llama.cpp engine stopped unexpectedly (exit code 0xC0000005).',
      details: 'exit code 0xC0000005. Last output: CUDA error: unspecified launch failure',
    })

    const text = describeEngineError(new Error(fromRust))

    expect(mockT).toHaveBeenCalledWith('model-errors:engine.ENGINE_STOPPED')
    expect(text).toContain('0xC0000005')
    expect(text).not.toContain('"code"')
  })

  it('describes a live but unreachable engine from its code', () => {
    const text = describeEngineError(
      JSON.stringify({
        code: 'ENGINE_UNREACHABLE',
        details: '127.0.0.1:51825: error sending request: connection refused',
      })
    )

    expect(mockT).toHaveBeenCalledWith('model-errors:engine.ENGINE_UNREACHABLE')
    expect(text).toContain('127.0.0.1:51825')
  })

  it('omits the detail wrapper when there is no detail', () => {
    describeEngineError({ code: 'IO_ERROR' })

    expect(mockT).not.toHaveBeenCalledWith(
      'model-errors:engineReportedDetail',
      expect.anything()
    )
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

describe('engineFailure', () => {
  beforeEach(() => {
    mockT.mockClear()
  })

  it('keeps the structured error reachable so an outer layer describes it once', () => {
    const engine = { code: 'OUT_OF_MEMORY', details: 'cudaMalloc failed' }
    const inner = engineFailure('model-errors:startModelFailed', engine)
    const outer = engineFailure('model-errors:createModelFailed', inner)

    expect(parseEngineError(outer)?.code).toBe('OUT_OF_MEMORY')
    expect(describeEngineError(outer)).toContain(
      'model-errors:engine.OUT_OF_MEMORY'
    )
    expect(describeEngineError(outer)).not.toContain(
      'model-errors:startModelFailed'
    )
  })

  it('describes a non-engine cause from its own message', () => {
    const wrapped = engineFailure(
      'model-errors:startModelFailed',
      new Error('GPU fail')
    )

    expect(wrapped.message).toContain('GPU fail')
  })
})
