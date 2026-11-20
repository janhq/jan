import { describe, expect, it } from 'vitest'
import type { DiagnosticsEvent } from '@janhq/tauri-plugin-llamacpp-api'

import { diagnosticsSuggestions } from '@/lib/diagnosticsSuggestions'
import {
  applyDiagnosticsEvent,
  type DiagnosticsRun,
} from '@/hooks/useLlamacppDiagnostics'

const JOB = 'suggest-job'

function build(events: Omit<DiagnosticsEvent, 'job'>[]): DiagnosticsRun {
  let run: DiagnosticsRun = {
    job: JOB,
    status: 'running',
    preset: 'model',
    backendModules: [],
    devices: [],
    cases: [],
    casesTruncated: false,
    totalUnits: 0,
    finishedUnits: 0,
    startedAt: 0,
  }
  for (const event of events) {
    run = applyDiagnosticsEvent(run, { ...event, job: JOB } as DiagnosticsEvent)
  }
  return run
}

const device = (name: string) =>
  ({
    event: 'device',
    name,
    description: `${name} device`,
    type: name === 'CPU' ? 'cpu' : 'gpu',
    reg: name.replace(/\d+$/, ''),
  }) as const

const summary = (
  name: string,
  over: Partial<{
    ok: number
    failed: number
    not_supported: number
    families_crashed: number
    families_hung: number
    families_no_cases: number
  }> = {}
) =>
  ({
    event: 'summary',
    device: name,
    ok: 1000,
    failed: 0,
    not_supported: 0,
    families_crashed: 0,
    families_hung: 0,
    families_no_cases: 0,
    ...over,
  }) as const

const failingCase = (name: string, op: string, params: string) =>
  ({
    event: 'case',
    device: name,
    family: op,
    backend: name,
    op,
    params,
    mode: 'test',
    status: 'fail',
  }) as const

/**
 * An unsupported case as the *support probe* reports it. Only probe cases
 * feed `opSupport`; the test run re-reports the same ops, and counting both
 * would double every quick-preset family.
 */
const fallbackCase = (name: string, op: string) =>
  ({
    event: 'case',
    device: name,
    family: '*',
    backend: name,
    op,
    params: 'type=f32',
    mode: 'support',
    status: 'not_supported',
  }) as const

const ids = (run: DiagnosticsRun) => diagnosticsSuggestions(run).map((s) => s.id)

describe('diagnosticsSuggestions', () => {
  it('says nothing about a machine where everything worked', () => {
    const run = build([device('CUDA0'), summary('CUDA0')])
    expect(diagnosticsSuggestions(run)).toEqual([])
  })

  it('offers the healthy device only when there is one to offer', () => {
    const alone = build([
      device('CUDA0'),
      failingCase('CUDA0', 'MUL_MAT', 'type_a=q4_K,m=4096'),
      summary('CUDA0', { failed: 1 }),
    ])
    expect(ids(alone)).not.toContain('tryAnotherDevice')

    const paired = build([
      device('CUDA0'),
      device('CPU'),
      failingCase('CUDA0', 'MUL_MAT', 'type_a=q4_K,m=4096'),
      summary('CUDA0', { failed: 1 }),
      summary('CPU'),
    ])
    const swap = diagnosticsSuggestions(paired).find(
      (s) => s.id === 'tryAnotherDevice'
    )
    expect(swap?.values).toEqual({ device: 'CUDA0', alternative: 'CPU' })
    // The evidence is a plain-language group, never a ggml op name.
    expect(swap?.groups).toEqual(['matrixMath'])
  })

  it('reads a dead test process as a memory or driver problem', () => {
    const run = build([
      device('Vulkan0'),
      summary('Vulkan0', { families_crashed: 1, families_hung: 1 }),
    ])
    const advice = diagnosticsSuggestions(run).find(
      (s) => s.id === 'reduceGpuLayers'
    )
    expect(advice?.values).toEqual({ device: 'Vulkan0', count: 2 })
  })

  it('offers turning flash attention off when the attention kernels are wrong', () => {
    const run = build([
      device('CUDA0'),
      failingCase('CUDA0', 'FLASH_ATTN_EXT', 'hsk=128,hsv=128,type_K=f16'),
      summary('CUDA0', { failed: 1 }),
    ])
    const advice = diagnosticsSuggestions(run).find(
      (s) => s.id === 'disableFlashAttention'
    )
    expect(advice?.values).toEqual({ device: 'CUDA0', count: 1 })
  })

  // The advice reads "while the uncompressed ones passed", so it belongs to
  // the run where *every* failure is a compressed one. When plain kernels
  // fail too the quantization is not what singles this machine out, and a
  // differently compressed download will not help.
  it('blames the compression only when the uncompressed kernels passed', () => {
    const onlyQuantized = build([
      device('CUDA0'),
      failingCase('CUDA0', 'MUL_MAT', 'type_a=q4_K,m=4096'),
      summary('CUDA0', { failed: 1, ok: 100 }),
    ])
    expect(ids(onlyQuantized)).toContain('useAnotherQuantization')

    const mixed = build([
      device('CUDA0'),
      failingCase('CUDA0', 'MUL_MAT', 'type_a=q4_K,m=4096'),
      failingCase('CUDA0', 'MUL_MAT', 'type_a=f16,m=4096'),
      summary('CUDA0', { failed: 2, ok: 100 }),
    ])
    expect(ids(mixed)).not.toContain('useAnotherQuantization')

    // Nothing passed, so nothing supports "the uncompressed ones passed".
    const nothingPassed = build([
      device('CUDA0'),
      failingCase('CUDA0', 'MUL_MAT', 'type_a=q4_K,m=4096'),
      summary('CUDA0', { failed: 1, ok: 0 }),
    ])
    expect(ids(nothingPassed)).not.toContain('useAnotherQuantization')
  })

  it('offers the offload note for an accelerator, as advice not a fault', () => {
    const run = build([
      device('Vulkan0'),
      fallbackCase('Vulkan0', 'SILU'),
      fallbackCase('Vulkan0', 'GELU'),
      summary('Vulkan0', { not_supported: 2 }),
    ])
    const advice = diagnosticsSuggestions(run)
    expect(advice.map((s) => s.id)).toEqual(['expectCpuFallback'])
    expect(advice[0].values).toEqual({ device: 'Vulkan0', count: 2 })
  })

  // The whole point of the phase: a narrowed run that covered nothing has to
  // say so, or the user acts on a result that was never measured.
  it('always asks for a full run when a family matched no test case', () => {
    const run = build([
      device('CUDA0'),
      summary('CUDA0', { families_no_cases: 3 }),
    ])
    const advice = diagnosticsSuggestions(run).find(
      (s) => s.id === 'rerunWholeCheck'
    )
    expect(advice?.values).toEqual({ device: 'CUDA0', count: 3 })
  })

  it('says nothing from a device still running', () => {
    const run = build([
      device('CUDA0'),
      failingCase('CUDA0', 'MUL_MAT', 'type_a=q4_K,m=4096'),
    ])
    expect(diagnosticsSuggestions(run)).toEqual([])
  })
})
