import { stripLocalPaths } from '@/lib/engineError'
import {
  deviceVerdict,
  isQuantizedCase,
  tallyOf,
} from '@/lib/diagnosticsGroups'

import {
  unsupportedOps,
  type DiagnosticsDeviceRun,
  type DiagnosticsRun,
} from '@/hooks/useLlamacppDiagnostics'

/** Ops whose example parameters are quoted; enough to diagnose, not a dump. */
const REPORTED_OPS = 3

const VERDICT_TEXT: Record<string, string> = {
  passed: 'all checks passed',
  fallback: 'all checks passed, some ops run on the CPU',
  inconclusive: 'INCOMPLETE - some families were not checked',
  failed: 'FAILED',
  unknown: 'did not finish',
}

function memory(device: DiagnosticsDeviceRun): string {
  const { memory_free_mib: free, memory_total_mib: total } = device.device
  if (total === undefined) return ''
  const gib = (mib: number) => `${(mib / 1024).toFixed(1)} GB`
  return free === undefined
    ? `, ${gib(total)}`
    : `, ${gib(free)} free of ${gib(total)}`
}

function deviceSection(
  device: DiagnosticsDeviceRun,
  home?: string | null
): string[] {
  const verdict = deviceVerdict(tallyOf(device))
  const lines = [
    `### ${device.device.name} - ${VERDICT_TEXT[verdict]}`,
    '',
    `- Device: ${device.device.description} (${device.device.reg}${memory(device)})`,
    `- Cases: ${device.ok} passed, ${device.failed} failed, ${device.notSupported} not supported`,
  ]
  if (device.crashed > 0 || device.hung > 0) {
    lines.push(
      `- Families that did not complete: ${device.crashed} crashed, ${device.hung} hung`
    )
  }
  // Named explicitly in the report, not just implied by a low case count: a
  // reader comparing two pastes has no other way to tell a narrowed run that
  // covered nothing from one that covered everything.
  if (device.noCases > 0) {
    lines.push(`- Families that matched no test case: ${device.noCases}`)
  }
  // Ratios, not bare op names. An op is usually only partly unsupported, and
  // "Falls back to CPU: MUL_MAT" reads as "this device cannot multiply
  // matrices" when 2630 of its 3090 cases ran fine.
  const unsupported = unsupportedOps(device)
  if (unsupported.length > 0) {
    const offloads = tallyOf(device).canOffload
    const n = `${unsupported.length} op${unsupported.length === 1 ? '' : 's'}`
    lines.push(
      '',
      offloads
        ? `**Runs on the CPU instead** (${n})`
        : `**No kernel on this device** (${n})`,
      ''
    )
    for (const op of unsupported) {
      const total = op.ok + op.notSupported
      const whole = op.ok === 0 ? ', the whole op' : ''
      lines.push(`- ${op.op}: ${op.notSupported} of ${total} cases${whole}`)
    }
    // The parameters are the answer to "which MUL_MAT?"; a bare op name is
    // not actionable. Only for partial ops -- for a whole missing op the name
    // already says it.
    const partial = unsupported.filter((o) => o.ok > 0).slice(0, REPORTED_OPS)
    if (partial.length > 0) {
      lines.push('', 'Examples of the cases with no kernel:', '')
      for (const op of partial) {
        for (const params of op.examples) {
          lines.push(`- \`${op.op}  ${params}\``)
        }
      }
    }
  }

  const broken = device.families.filter((f) => f.status !== 'ok')
  for (const family of broken) {
    lines.push('', `**${family.family}: ${family.status}**`)
    if (family.exit) lines.push(`- Exit: ${family.exit}`)
    for (const line of family.lastLines) {
      lines.push(`- \`${stripLocalPaths(line, home)}\``)
    }
  }
  return lines
}

export interface DiagnosticsReportContext {
  appVersion?: string
  os?: string
  /** The real home directory, so paths are stripped by knowing, not guessing. */
  home?: string | null
}

/**
 * A markdown report of a hardware check, for pasting into an issue.
 *
 * Built from the run already in memory and handed to the caller to put on the
 * clipboard. Nothing is sent anywhere, and `stripLocalPaths` -- the same one
 * the load-failure report uses -- takes the user's home directory out of
 * anything llama.cpp printed.
 */
export function formatDiagnosticsReport(
  run: DiagnosticsRun,
  context: DiagnosticsReportContext = {},
  options: { allCases?: boolean } = {}
): string {
  const lines: string[] = ['## llama.cpp hardware check', '']

  if (context.appVersion) lines.push(`- Jan: ${context.appVersion}`)
  if (context.os) lines.push(`- OS: ${context.os}`)
  if (run.engine) {
    lines.push(
      `- Engine: llama.cpp ${run.engine.version} (${run.engine.tag}, ${run.engine.commit.slice(0, 8)})`
    )
  }
  lines.push(`- Preset: ${run.preset}`)
  if (run.model) lines.push(`- Model: ${run.model}`)
  lines.push(`- Result: ${run.status}`)
  // Stripped like every other engine-sourced string here: a spawn or exit
  // failure quotes the worker's path, which is under the user's home.
  if (run.error) lines.push(`- Stopped: ${stripLocalPaths(run.error, context.home)}`)
  if (run.backendModules.length > 0) {
    lines.push(`- Backend modules: ${run.backendModules.join(', ')}`)
  }

  for (const device of run.devices) {
    lines.push('', ...deviceSection(device, context.home))
  }

  const failures = run.cases.filter((c) => c.status === 'fail')
  const shown = options.allCases ? run.cases : failures
  if (shown.length > 0) {
    lines.push(
      '',
      options.allCases ? '### All cases' : `### Failing cases (${failures.length})`,
      '',
      '| Device | Op | Parameters | Status | Error |',
      '| --- | --- | --- | --- | --- |'
    )
    for (const c of shown) {
      const error = c.error ?? c.detail ?? ''
      lines.push(
        `| ${c.device} | ${c.op} | \`${c.params}\` | ${c.status} | ${stripLocalPaths(error, context.home).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`
      )
    }
    if (options.allCases && run.casesTruncated) {
      lines.push(
        '',
        `_Passing cases beyond the first ${run.cases.length} were not kept; every failure is listed._`
      )
    }
  }

  const quantized = failures.filter((c) => isQuantizedCase(c.params))
  if (quantized.length > 0) {
    lines.push(
      '',
      `${quantized.length} of the failures are quantized kernels, which every local model uses.`
    )
  }

  return lines.join('\n')
}
