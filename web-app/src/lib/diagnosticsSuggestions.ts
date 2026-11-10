import {
  deviceVerdict,
  groupForOp,
  isQuantizedCase,
  tallyOf,
  type DeviceVerdict,
  type DiagnosticsGroup,
} from '@/lib/diagnosticsGroups'
import {
  unsupportedOps,
  type DiagnosticsRun,
} from '@/hooks/useLlamacppDiagnostics'

/**
 * What to do about a check's result.
 *
 * A list of failing kernels is a finding, not an answer: the question the user
 * actually has is "so what do I change?". Each suggestion here is drawn from a
 * specific, named observation and carries it, so nothing has to be taken on
 * trust -- and nothing is offered that the run did not actually observe.
 *
 * The evidence is deliberately counts and plain-language groups rather than
 * ggml op names: the op names live in the technical details table, which is
 * where someone who wants them is already looking.
 */
export type SuggestionId =
  | 'tryAnotherDevice'
  | 'reduceGpuLayers'
  | 'disableFlashAttention'
  | 'useAnotherQuantization'
  | 'expectCpuFallback'
  | 'rerunWholeCheck'

export interface DiagnosticsSuggestion {
  id: SuggestionId
  /** The device the suggestion is about. */
  device: string
  /** Interpolation values for the localized sentence. */
  values: Record<string, string | number>
  /** Groups the evidence came from, worst first; may be empty. */
  groups: DiagnosticsGroup[]
}

/** Failing cases on one device, grouped, worst first. */
function failedGroups(run: DiagnosticsRun, device: string): DiagnosticsGroup[] {
  const counts = new Map<DiagnosticsGroup, number>()
  for (const c of run.cases) {
    if (c.device !== device || c.status !== 'fail') continue
    const group = groupForOp(c.op)
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([group]) => group)
}

function attentionFailures(run: DiagnosticsRun, device: string): number {
  return run.cases.filter(
    (c) =>
      c.device === device &&
      c.status === 'fail' &&
      c.op.toUpperCase().includes('FLASH_ATTN')
  ).length
}

function quantizedFailures(run: DiagnosticsRun, device: string): number {
  return run.cases.filter(
    (c) =>
      c.device === device && c.status === 'fail' && isQuantizedCase(c.params)
  ).length
}

/**
 * What the run suggests, worst first.
 *
 * Every rule is conditioned on a complete device: a suggestion drawn from a
 * run still in flight would change under the user as the remaining families
 * land.
 */
export function diagnosticsSuggestions(
  run: DiagnosticsRun
): DiagnosticsSuggestion[] {
  const complete = run.devices.filter((d) => d.complete)
  const verdicts = new Map<string, DeviceVerdict>(
    complete.map((d) => [d.device.name, deviceVerdict(tallyOf(d))])
  )
  const healthy = complete.filter((d) => {
    const verdict = verdicts.get(d.device.name)
    return verdict === 'passed' || verdict === 'fallback'
  })

  const out: DiagnosticsSuggestion[] = []
  for (const device of complete) {
    const name = device.device.name
    const verdict = verdicts.get(name)

    if (verdict === 'failed') {
      // Only when there is somewhere to go: "use another device" on a machine
      // with one device is advice the user cannot take.
      const alternative = healthy.find((d) => d.device.name !== name)
      if (alternative) {
        out.push({
          id: 'tryAnotherDevice',
          device: name,
          values: {
            device: name,
            alternative: alternative.device.name,
          },
          groups: failedGroups(run, name),
        })
      }

      // A family that killed its own process is what a GGML_ASSERT or a lost
      // device looks like, and that is a memory or driver problem rather than
      // a wrong answer, so it gets its own advice.
      const died = device.crashed + device.hung
      if (died > 0) {
        out.push({
          id: 'reduceGpuLayers',
          device: name,
          values: { device: name, count: died },
          groups: [],
        })
      }

      const attention = attentionFailures(run, name)
      if (attention > 0) {
        out.push({
          id: 'disableFlashAttention',
          device: name,
          values: { device: name, count: attention },
          groups: ['attention'],
        })
      }

      // Only when the plain kernels are fine: with everything failing, the
      // quantization is not what singles this machine out.
      const quantized = quantizedFailures(run, name)
      if (quantized > 0 && quantized < device.failed) {
        out.push({
          id: 'useAnotherQuantization',
          device: name,
          values: { device: name, count: quantized },
          groups: failedGroups(run, name),
        })
      }
    }

    if (verdict === 'fallback') {
      out.push({
        id: 'expectCpuFallback',
        device: name,
        values: { device: name, count: unsupportedOps(device).length },
        groups: [],
      })
    }

    // Last, because it is about the check rather than the machine -- but
    // never omitted: a narrowed run that covered none of what it named must
    // not be read as a clean bill of health.
    if (device.noCases > 0) {
      out.push({
        id: 'rerunWholeCheck',
        device: name,
        values: { device: name, count: device.noCases },
        groups: [],
      })
    }
  }
  return out
}
