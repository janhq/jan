import { describe, expect, it } from 'vitest'
import type { DiagnosticsEvent } from '@janhq/tauri-plugin-llamacpp-api'

import { formatDiagnosticsReport } from '@/lib/diagnosticsReport'
import {
  applyDiagnosticsEvent,
  unsupportedOps,
  EXAMPLES_PER_OP,
  type DiagnosticsRun,
} from '@/hooks/useLlamacppDiagnostics'

const JOB = 'test-job'

function build(events: Omit<DiagnosticsEvent, 'job'>[]): DiagnosticsRun {
  let run: DiagnosticsRun = {
    job: JOB,
    status: 'running',
    preset: 'quick',
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

const START = {
  event: 'start',
  schema: 1,
  preset: 'quick',
  engine: { version: '0.9.0', tag: 'b12110', commit: 'cd959bae99ff4bed' },
  families: ['ADD'],
  support_probe: true,
  backend_modules: ['CUDA (libggml-cuda.so)'],
  units: 2,
  family_timeout_secs: 600,
  deadline_secs: 5400,
} as const

const DEVICE = {
  event: 'device',
  name: 'CUDA0',
  description: 'NVIDIA RTX 3090',
  type: 'gpu',
  reg: 'CUDA',
  memory_total_mib: 24576,
  memory_free_mib: 20480,
} as const

const caseEvent = (over: Record<string, unknown> = {}) =>
  ({
    event: 'case',
    device: 'CUDA0',
    family: 'MUL_MAT',
    backend: 'CUDA0',
    op: 'MUL_MAT',
    params: 'type_a=q4_K,m=4096',
    mode: 'test',
    status: 'ok',
    ...over,
  }) as unknown as Omit<DiagnosticsEvent, 'job'>

/** A case as the support probe reports it; only these feed `opSupport`. */
const probeEvent = (over: Record<string, unknown> = {}) =>
  caseEvent({ mode: 'support', family: '*', ...over })

describe('applyDiagnosticsEvent', () => {
  it('builds a device summary from the stream', () => {
    const run = build([
      START,
      DEVICE,
      { event: 'family_start', device: 'CUDA0', family: 'MUL_MAT', mode: 'test' },
      caseEvent(),
      caseEvent({ status: 'fail', error: 'compare failed' }),
      probeEvent({ status: 'not_supported', op: 'SILU' }),
      {
        event: 'family_end',
        device: 'CUDA0',
        family: 'MUL_MAT',
        status: 'fail',
        ok: 1,
        failed: 1,
        not_supported: 1,
        millis: 1200,
      },
      {
        event: 'summary',
        device: 'CUDA0',
        ok: 1,
        failed: 1,
        not_supported: 1,
        families_crashed: 0,
        families_hung: 0,
      },
      { event: 'done', ok: false, cancelled: false },
    ] as Omit<DiagnosticsEvent, 'job'>[])

    expect(run.status).toBe('failed')
    expect(run.devices).toHaveLength(1)
    expect(run.devices[0].failed).toBe(1)
    expect(run.devices[0].complete).toBe(true)
    expect(run.finishedUnits).toBe(1)
    expect(run.current).toBeUndefined()
  })

  // The defect this replaced: an op was recorded as "not implemented" when a
  // single case of it was unsupported, so a device that ran 2630 of 3090
  // MUL_MAT cases was reported as having no matrix multiply at all.
  it('counts per-op support rather than flagging the whole op', () => {
    const events: Omit<DiagnosticsEvent, 'job'>[] = [START, DEVICE]
    for (let i = 0; i < 26; i++) events.push(probeEvent({ op: 'MUL_MAT', params: `ok${i}` }))
    for (let i = 0; i < 4; i++)
      events.push(
        probeEvent({ status: 'not_supported', op: 'MUL_MAT', params: `type_a=q4_0,n=${i}` })
      )
    events.push(probeEvent({ status: 'not_supported', op: 'SILU', params: 'type=f16' }))
    const run = build(events)

    const ops = unsupportedOps(run.devices[0])
    expect(ops.map((o) => [o.op, o.notSupported, o.ok])).toEqual([
      ['MUL_MAT', 4, 26],
      ['SILU', 1, 0],
    ])
  })

  it('keeps the parameters of unsupported cases, capped', () => {
    const events: Omit<DiagnosticsEvent, 'job'>[] = [START, DEVICE]
    for (let i = 0; i < EXAMPLES_PER_OP + 3; i++)
      events.push(probeEvent({ status: 'not_supported', op: 'MUL_MAT', params: `k=${i}` }))
    const run = build(events)

    const [mulmat] = unsupportedOps(run.devices[0])
    expect(mulmat.notSupported).toBe(EXAMPLES_PER_OP + 3)
    expect(mulmat.examples).toHaveLength(EXAMPLES_PER_OP)
    expect(mulmat.examples[0]).toBe('k=0')
  })

  it('counts support past the cap on passing cases', () => {
    const events: Omit<DiagnosticsEvent, 'job'>[] = [START, DEVICE]
    for (let i = 0; i < 5200; i++) events.push(probeEvent({ op: 'MUL_MAT', params: `n=${i}` }))
    events.push(probeEvent({ status: 'not_supported', op: 'MUL_MAT', params: 'odd' }))
    const run = build(events)

    // `cases` is capped at 5000; the ratio must not be.
    expect(run.casesTruncated).toBe(true)
    expect(unsupportedOps(run.devices[0])[0].ok).toBe(5200)
  })

  it('tells a cancelled run from a failed one', () => {
    const cancelled = build([
      START,
      { event: 'done', ok: false, cancelled: true },
    ] as Omit<DiagnosticsEvent, 'job'>[])
    expect(cancelled.status).toBe('cancelled')

    const errored = build([
      START,
      { event: 'done', ok: false, cancelled: false, error: 'deadline' },
    ] as Omit<DiagnosticsEvent, 'job'>[])
    expect(errored.status).toBe('error')
    expect(errored.error).toBe('deadline')
  })

  it('keeps every failure even once passing cases are capped', () => {
    const events: Omit<DiagnosticsEvent, 'job'>[] = [START, DEVICE]
    for (let i = 0; i < 5200; i++) events.push(caseEvent({ params: `n=${i}` }))
    events.push(caseEvent({ status: 'fail', error: 'late failure' }))
    const run = build(events)

    expect(run.casesTruncated).toBe(true)
    const failures = run.cases.filter((c) => c.status === 'fail')
    expect(failures).toHaveLength(1)
    expect(failures[0].error).toBe('late failure')
  })
})

describe('formatDiagnosticsReport', () => {
  const run = () =>
    build([
      START,
      DEVICE,
      caseEvent({ status: 'fail', error: 'NMSE 0.51 > 5e-4' }),
      probeEvent({ status: 'not_supported', op: 'SILU' }),
      {
        event: 'family_end',
        device: 'CUDA0',
        family: 'MUL_MAT',
        status: 'crashed',
        ok: 0,
        failed: 1,
        not_supported: 1,
        millis: 900,
        exit: 'exit code 0xC0000005',
        last_lines: ['ggml_cuda: device lost at /home/bob/jan/libggml-cuda.so'],
      },
      {
        event: 'summary',
        device: 'CUDA0',
        ok: 0,
        failed: 1,
        not_supported: 1,
        families_crashed: 1,
        families_hung: 0,
      },
      { event: 'done', ok: false, cancelled: false },
    ] as Omit<DiagnosticsEvent, 'job'>[])

  it('leads with what a maintainer needs to reproduce', () => {
    const md = formatDiagnosticsReport(run(), {
      appVersion: '0.7.1',
      os: 'Windows 11',
    })
    expect(md).toContain('## llama.cpp hardware check')
    expect(md).toContain('- Jan: 0.7.1')
    expect(md).toContain('- OS: Windows 11')
    expect(md).toContain('llama.cpp 0.9.0 (b12110, cd959bae)')
    expect(md).toContain('CUDA (libggml-cuda.so)')
  })

  it('names the failing device, its exit and the failing cases', () => {
    const md = formatDiagnosticsReport(run())
    expect(md).toContain('### CUDA0 - FAILED')
    expect(md).toContain('exit code 0xC0000005')
    expect(md).toContain('MUL_MAT: crashed')
    expect(md).toContain('NMSE 0.51 > 5e-4')
    expect(md).toContain('SILU: 1 of 1 cases, the whole op')
  })

  it('leaves no home directory or user name in the report', () => {
    const md = formatDiagnosticsReport(run())
    expect(md).not.toContain('/home/bob')
    expect(md).toContain('~/jan/libggml-cuda.so')
  })

  // The stop reason is engine-sourced like the rest: a spawn failure quotes
  // the worker's own path, which lives under the user's home.
  it('strips the home directory out of the stop reason too', () => {
    const md = formatDiagnosticsReport(
      build([
        START,
        DEVICE,
        {
          event: 'done',
          ok: false,
          cancelled: false,
          error:
            'could not start /home/bob/.local/share/jan/jan-llama-worker: No such file',
        },
      ] as Omit<DiagnosticsEvent, 'job'>[])
    )
    expect(md).not.toContain('/home/bob')
    expect(md).toContain('~/.local/share/jan/jan-llama-worker')
  })

  it('calls out quantized failures, which every local model hits', () => {
    expect(formatDiagnosticsReport(run())).toContain(
      '1 of the failures are quantized kernels'
    )
  })

  it('lists only failures until all cases are asked for', () => {
    const brief = formatDiagnosticsReport(run())
    expect(brief).toContain('### Failing cases (1)')
    expect(brief).not.toContain('### All cases')

    const full = formatDiagnosticsReport(run(), {}, { allCases: true })
    expect(full).toContain('### All cases')
    expect(full).toContain('not_supported')
  })

  it('escapes a pipe so one error cannot break the table', () => {
    const r = build([
      START,
      DEVICE,
      caseEvent({ status: 'fail', error: 'a | b' }),
    ] as Omit<DiagnosticsEvent, 'job'>[])
    expect(formatDiagnosticsReport(r)).toContain('a \\| b')
  })
  // The support probe asks the whole op list, then the test run re-reports the
  // same ops. Summing both counted every quick-preset family twice, which is
  // what made a partly-supported MUL_MAT read as thousands of missing cases.
  it('counts support from the probe alone, not the probe plus the test run', () => {
    const run = build([
      START,
      DEVICE,
      probeEvent({ op: 'MUL_MAT', params: 'a' }),
      probeEvent({ status: 'not_supported', op: 'MUL_MAT', params: 'b' }),
      // The same op, run again in test mode: must not be added on top.
      caseEvent({ op: 'MUL_MAT', params: 'a' }),
      caseEvent({ status: 'not_supported', op: 'MUL_MAT', params: 'b' }),
    ] as Omit<DiagnosticsEvent, 'job'>[])

    const [mulmat] = unsupportedOps(run.devices[0])
    expect([mulmat.ok, mulmat.notSupported]).toEqual([1, 1])
  })
})
