import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
  }),
}))

const { startDiagnostics, cancelDiagnostics, onDiagnosticsEvent, emit } =
  vi.hoisted(() => {
    const handlers: ((e: unknown) => void)[] = []
    return {
      startDiagnostics: vi.fn(),
      cancelDiagnostics: vi.fn(),
      getLoadedModels: vi.fn(),
      onDiagnosticsEvent: vi.fn(async (h: (e: unknown) => void) => {
        handlers.push(h)
        return () => {}
      }),
      emit: (event: unknown) => handlers.forEach((h) => h(event)),
    }
  })

vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  startDiagnostics,
  cancelDiagnostics,
  onDiagnosticsEvent,
  getLoadedModels: vi.fn().mockResolvedValue([]),
  unloadLlamaModel: vi.fn(),
}))

import { LlamacppDiagnostics } from '../LlamacppDiagnostics'

/**
 * Pushes events and lets the hook's batching interval land inside `act`. The
 * hook deliberately flushes on a timer rather than per event, so a test that
 * asserts straight after emitting would race it.
 */
async function push(...events: unknown[]) {
  await act(async () => {
    events.forEach(emit)
    await new Promise((r) => setTimeout(r, 250))
  })
}

const JOB = 'job-1'

const START = {
  job: JOB,
  event: 'start',
  schema: 1,
  preset: 'quick',
  engine: { version: '0.9.0', tag: 'b12110', commit: 'cd959bae99ff' },
  families: ['MUL_MAT'],
  support_probe: true,
  backend_modules: ['CUDA (libggml-cuda.so)'],
  units: 2,
  family_timeout_secs: 600,
  deadline_secs: 5400,
}

const DEVICE = {
  job: JOB,
  event: 'device',
  name: 'CUDA0',
  description: 'NVIDIA RTX 3090',
  type: 'gpu',
  reg: 'CUDA',
  memory_total_mib: 24576,
  memory_free_mib: 20480,
}

describe('LlamacppDiagnostics', () => {
  beforeEach(() => {
    startDiagnostics.mockReset()
    cancelDiagnostics.mockReset()
    startDiagnostics.mockResolvedValue({ id: JOB })
    vi.useRealTimers()
  })

  it('offers the check before anything has run, and nothing else', () => {
    render(<LlamacppDiagnostics />)

    expect(screen.getByText('providers:diagnostics.title')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /diagnostics\.run$/ })
    ).toBeInTheDocument()
    // No results surface until there are results.
    expect(
      screen.queryByText('providers:diagnostics.technicalDetails')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('providers:diagnostics.copyResults')
    ).not.toBeInTheDocument()
  })

  it('reports a clean device in plain words, with no ggml op name in sight', async () => {
    const user = userEvent.setup()
    render(<LlamacppDiagnostics />)
    await user.click(screen.getByRole('button', { name: /diagnostics\.run$/ }))

    await waitFor(() =>
      expect(startDiagnostics).toHaveBeenCalledWith('quick', [], {}, undefined)
    )

    await push(START)
    await push(DEVICE)
    await push({
      job: JOB,
      event: 'summary',
      device: 'CUDA0',
      ok: 3000,
      failed: 0,
      not_supported: 0,
      families_crashed: 0,
      families_hung: 0,
    })
    await push({ job: JOB, event: 'done', ok: true, cancelled: false })

    expect(await screen.findByText('NVIDIA RTX 3090')).toBeInTheDocument()
    expect(
      screen.getByText('providers:diagnostics.verdictPassed')
    ).toBeInTheDocument()
    expect(screen.queryByText(/MUL_MAT/)).not.toBeInTheDocument()
  })

  it('names the broken part in plain words when a kernel is wrong', async () => {
    const user = userEvent.setup()
    render(<LlamacppDiagnostics />)
    await user.click(screen.getByRole('button', { name: /diagnostics\.run$/ }))
    await waitFor(() => expect(startDiagnostics).toHaveBeenCalled())

    await push(START)
    await push(DEVICE)
    await push({
      job: JOB,
      event: 'case',
      device: 'CUDA0',
      family: 'MUL_MAT',
      backend: 'CUDA0',
      op: 'MUL_MAT',
      params: 'type_a=q4_K,m=4096',
      mode: 'test',
      status: 'fail',
      error: 'NMSE 0.51 > 5e-4',
    })
    await push({
      job: JOB,
      event: 'summary',
      device: 'CUDA0',
      ok: 10,
      failed: 1,
      not_supported: 0,
      families_crashed: 0,
      families_hung: 0,
    })
    await push({ job: JOB, event: 'done', ok: false, cancelled: false })

    // The group name, not the op: "Matrix multiplication", never MUL_MAT.
    expect(
      await screen.findByText('providers:diagnostics.groupMatrixMath')
    ).toBeInTheDocument()
    expect(
      screen.getByText('providers:diagnostics.verdictFailed')
    ).toBeInTheDocument()
    expect(screen.queryByText(/MUL_MAT/)).not.toBeInTheDocument()
    // A quantized failure is called out: every downloaded model is quantized.
    expect(
      screen.getByText('providers:diagnostics.quantizedDetail')
    ).toBeInTheDocument()
  })

  it('treats an op that falls back to the CPU as working, not broken', async () => {
    const user = userEvent.setup()
    render(<LlamacppDiagnostics />)
    await user.click(screen.getByRole('button', { name: /diagnostics\.run$/ }))
    await waitFor(() => expect(startDiagnostics).toHaveBeenCalled())

    await push(START)
    await push(DEVICE)
    await push({
      job: JOB,
      event: 'case',
      device: 'CUDA0',
      family: 'SILU',
      backend: 'CUDA0',
      op: 'SILU',
      params: 'type=f16',
      mode: 'test',
      status: 'not_supported',
    })
    await push({
      job: JOB,
      event: 'summary',
      device: 'CUDA0',
      ok: 100,
      failed: 0,
      not_supported: 1,
      families_crashed: 0,
      families_hung: 0,
    })
    await push({ job: JOB, event: 'done', ok: true, cancelled: false })

    expect(
      await screen.findByText('providers:diagnostics.verdictFallback')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('providers:diagnostics.verdictFailed')
    ).not.toBeInTheDocument()
  })

  it('says a device crashed rather than blaming a kernel', async () => {
    const user = userEvent.setup()
    render(<LlamacppDiagnostics />)
    await user.click(screen.getByRole('button', { name: /diagnostics\.run$/ }))
    await waitFor(() => expect(startDiagnostics).toHaveBeenCalled())

    await push(START)
    await push(DEVICE)
    await push({
      job: JOB,
      event: 'summary',
      device: 'CUDA0',
      ok: 0,
      failed: 0,
      not_supported: 0,
      families_crashed: 1,
      families_hung: 0,
    })
    await push({ job: JOB, event: 'done', ok: false, cancelled: false })

    expect(
      await screen.findByText('providers:diagnostics.verdictCrashed')
    ).toBeInTheDocument()
  })

  it('swaps Run for Stop while a check is in flight', async () => {
    const user = userEvent.setup()
    render(<LlamacppDiagnostics />)
    await user.click(screen.getByRole('button', { name: /diagnostics\.run$/ }))
    await waitFor(() => expect(startDiagnostics).toHaveBeenCalled())
    await push(START)

    const stop = await screen.findByRole('button', {
      name: 'providers:diagnostics.cancel',
    })
    await user.click(stop)
    expect(cancelDiagnostics).toHaveBeenCalledWith(JOB)
  })

  it('ignores events from a run that has been superseded', async () => {
    const user = userEvent.setup()
    render(<LlamacppDiagnostics />)
    await user.click(screen.getByRole('button', { name: /diagnostics\.run$/ }))
    await waitFor(() => expect(startDiagnostics).toHaveBeenCalled())

    await push(START)
    await push({ ...DEVICE, job: 'an-older-job', name: 'STALE' })
    await push({ job: JOB, event: 'done', ok: true, cancelled: false })

    await waitFor(() =>
      expect(
        screen.queryByText('providers:diagnostics.preparing')
      ).not.toBeInTheDocument()
    )
    expect(screen.queryByText('STALE')).not.toBeInTheDocument()
  })

  it('refuses to start while the engine is loading or replying', async () => {
    render(<LlamacppDiagnostics busy />)

    // Both halves of the split button, or the caret is a way around the gate.
    expect(screen.getByRole('button', { name: /diagnostics\.run$/ })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'providers:diagnostics.runOptions' })
    ).toBeDisabled()
    expect(
      screen.getByText('providers:diagnostics.busyBlocked')
    ).toBeInTheDocument()
    expect(startDiagnostics).not.toHaveBeenCalled()
  })

  it('flags a generation that begins mid-run without throwing the results away', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<LlamacppDiagnostics />)
    await user.click(screen.getByRole('button', { name: /diagnostics\.run$/ }))
    await waitFor(() => expect(startDiagnostics).toHaveBeenCalled())
    await push(START)

    rerender(<LlamacppDiagnostics busy />)

    expect(
      await screen.findByText('providers:diagnostics.busyDuringRun')
    ).toBeInTheDocument()
    // Busy mid-run is a warning, not a cancel.
    expect(
      screen.getByRole('button', { name: 'providers:diagnostics.cancel' })
    ).toBeInTheDocument()
  })

  it('preselects the device the hardware page sent it', async () => {
    const user = userEvent.setup()
    render(<LlamacppDiagnostics deviceHint="Vulkan0" />)
    await user.click(screen.getByRole('button', { name: /diagnostics\.run$/ }))

    await waitFor(() =>
      expect(startDiagnostics).toHaveBeenCalledWith(
        'quick',
        ['Vulkan0'],
        {},
        undefined
      )
    )
  })

  it('runs the model check, not the quick one, when a model was named', async () => {
    const user = userEvent.setup()
    render(<LlamacppDiagnostics modelHint="qwen3:8b" />)
    await user.click(
      screen.getByRole('button', { name: /diagnostics\.model$/ })
    )

    await waitFor(() =>
      expect(startDiagnostics).toHaveBeenCalledWith(
        'model',
        [],
        {},
        'qwen3:8b'
      )
    )
  })

  // The failure this phase has to avoid: a shape filter that matched nothing
  // leaves every other family passing, and a user told "working correctly"
  // acts on a result that was never measured.
  it('never calls a narrowed run that tested nothing a pass', async () => {
    const user = userEvent.setup()
    render(<LlamacppDiagnostics modelHint="qwen3:8b" />)
    await user.click(
      screen.getByRole('button', { name: /diagnostics\.model$/ })
    )

    await push(START)
    await push(DEVICE)
    await push({
      job: JOB,
      event: 'summary',
      device: 'CUDA0',
      ok: 500,
      failed: 0,
      not_supported: 0,
      families_crashed: 0,
      families_hung: 0,
      families_no_cases: 2,
    })
    // The wire shape the root actually emits: ok is false precisely so a
    // reader of that field alone cannot mistake this for a pass.
    await push({
      job: JOB,
      event: 'done',
      ok: false,
      cancelled: false,
      inconclusive: true,
    })

    expect(
      screen.queryByText('providers:diagnostics.verdictPassed')
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('providers:diagnostics.verdictInconclusive')
    ).toBeInTheDocument()
    expect(
      screen.getByText('providers:diagnostics.inconclusiveNotice')
    ).toBeInTheDocument()
    // And it says what to do about it, with the count it was drawn from.
    expect(
      screen.getByText(
        'providers:diagnostics.suggestionRerunWholeCheck:{"device":"CUDA0","count":2}'
      )
    ).toBeInTheDocument()
  })

  it('surfaces a check that could not start at all', async () => {
    const user = userEvent.setup()
    startDiagnostics.mockRejectedValue(
      new Error('a hardware check is already running')
    )
    render(<LlamacppDiagnostics />)
    await user.click(screen.getByRole('button', { name: /diagnostics\.run$/ }))

    expect(
      await screen.findByText(/already running/)
    ).toBeInTheDocument()
  })

  // The screenshot bug: a device with no summary yet showed "Not checked"
  // above a full group breakdown with four-figure counts.
  it('shows no group breakdown until the device has a verdict', async () => {
    const user = userEvent.setup()
    render(<LlamacppDiagnostics />)
    await user.click(screen.getByRole('button', { name: /diagnostics\.run$/ }))
    await waitFor(() => expect(startDiagnostics).toHaveBeenCalled())

    await push(START, DEVICE, {
      job: JOB,
      event: 'case',
      device: 'CUDA0',
      family: '*',
      backend: 'CUDA0',
      op: 'MUL_MAT',
      params: 'type_a=q4_0',
      mode: 'support',
      status: 'not_supported',
    })

    // Mid-run: the verdict is "not checked", so nothing may contradict it.
    expect(
      screen.getByText('providers:diagnostics.verdictUnknown')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('providers:diagnostics.groupMatrixMath')
    ).not.toBeInTheDocument()

    await push({
      job: JOB,
      event: 'summary',
      device: 'CUDA0',
      ok: 10,
      failed: 0,
      not_supported: 1,
      families_crashed: 0,
      families_hung: 0,
      families_no_cases: 0,
    })

    // Once the summary lands the breakdown appears, with a denominator.
    expect(
      await screen.findByText('providers:diagnostics.groupMatrixMath')
    ).toBeInTheDocument()
    expect(
      screen.getByText('providers:diagnostics.casesFallback:{"count":1,"total":1}')
    ).toBeInTheDocument()
  })
})
