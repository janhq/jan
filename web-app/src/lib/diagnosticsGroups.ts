import type {
  DiagnosticsCaseStatus,
  DiagnosticsDeviceKind,
  DiagnosticsFamilyStatus,
} from '@janhq/tauri-plugin-llamacpp-api'

import type { DiagnosticsDeviceRun } from '@/hooks/useLlamacppDiagnostics'

/**
 * Turning ggml op names into something a person can act on.
 *
 * Upstream has 150+ op families keyed on `op_desc`, which is the right unit for
 * running the test and the wrong one for reading the result: nobody knows what
 * `MUL_MAT_ID_FUSION` is, and a list of 150 rows answers no question. These
 * groups are the question a user actually has -- "is the part my model leans on
 * broken?" -- and the detail table behind them keeps every original name.
 */

/** Ordered: the first rule that matches an op wins, so specific rules lead. */
export const DIAGNOSTICS_GROUPS = [
  'matrixMath',
  'attention',
  'normalization',
  'positional',
  'convolution',
  'activation',
  'memory',
  'basicMath',
  'other',
] as const

export type DiagnosticsGroup = (typeof DIAGNOSTICS_GROUPS)[number]

const ACTIVATIONS = new Set([
  'ABS',
  'CLAMP',
  'COS',
  'ELU',
  'EXP',
  'FLOOR',
  'GELU',
  'GELU_ERF',
  'GELU_QUICK',
  'HARDSIGMOID',
  'HARDSWISH',
  'LEAKY_RELU',
  'LOG',
  'NEG',
  'RELU',
  'RELU_SQR',
  'ROUND',
  'SGN',
  'SIGMOID',
  'SILU',
  'SILU_BACK',
  'SIN',
  'SOFTCAP',
  'SOFT_PLUS',
  'SQR',
  'SQRT',
  'STEP',
  'TANH',
  'TRUNC',
  'XIELU',
])

const MEMORY_OPS = new Set([
  'ACC',
  'ARANGE',
  'CONCAT',
  'CONT',
  'CPY',
  'DIAG',
  'DUP',
  'GET_ROWS',
  'GET_ROWS_BACK',
  'PAD',
  'PAD_REFLECT_1D',
  'PERMUTE',
  'REPEAT',
  'REPEAT_BACK',
  'RESHAPE',
  'ROLL',
  'SET',
  'SET_ROWS',
  'TRANSPOSE',
  'TRI',
  'VIEW',
])

const BASIC_MATH = new Set([
  'ADD',
  'ADD1',
  'ADD_ID',
  'ARGMAX',
  'ARGSORT',
  'COUNT_EQUAL',
  'CUMSUM',
  'DIV',
  'MEAN',
  'MUL',
  'SCALE',
  'SUB',
  'SUM',
  'SUM_ROWS',
])

/**
 * Which group an op belongs to. Order matters: a fused op carries several
 * names (`RMS_NORM_MUL_ROPE`), and the leading rule is the one that describes
 * what it is for -- it is a normalization kernel, not a rope one.
 */
export function groupForOp(op: string): DiagnosticsGroup {
  const name = op.toUpperCase()
  if (name.startsWith('MUL_MAT') || name === 'OUT_PROD') return 'matrixMath'
  if (
    name.includes('FLASH_ATTN') ||
    name.includes('SOFT_MAX') ||
    name.startsWith('DIAG_MASK') ||
    name.includes('TOP_K') ||
    name.includes('TOPK') ||
    name.startsWith('SSM_') ||
    name.startsWith('RWKV') ||
    name.includes('DELTA_NET') ||
    name.includes('LINEAR_ATTN')
  ) {
    return 'attention'
  }
  if (name.includes('NORM')) return 'normalization'
  if (name.includes('ROPE')) return 'positional'
  if (
    name.startsWith('CONV') ||
    name.startsWith('IM2COL') ||
    name.startsWith('POOL')
  ) {
    return 'convolution'
  }
  if (ACTIVATIONS.has(name) || name.includes('GLU')) return 'activation'
  if (MEMORY_OPS.has(name)) return 'memory'
  if (BASIC_MATH.has(name)) return 'basicMath'
  return 'other'
}

/**
 * Whether a case exercises a quantized kernel, which is read off the
 * parameters rather than the op: quantization is a property of the tensor
 * types a case runs with, and the same `MUL_MAT` covers both. Worth singling
 * out because every local model is quantized, so a failure here is one a user
 * will actually hit.
 */
export function isQuantizedCase(params: string): boolean {
  return /\b(?:type|type_a|type_b)=(?:q\d|iq\d|mxfp|tq\d)/i.test(params)
}

/** A device's overall verdict. Ordered worst to best; see `deviceVerdict`. */
export type DeviceVerdict =
  | 'failed'
  | 'inconclusive'
  | 'fallback'
  | 'passed'
  | 'unknown'

export interface DeviceTally {
  ok: number
  failed: number
  notSupported: number
  crashed: number
  hung: number
  /**
   * Families whose shape filter matched no case, so they tested nothing. A
   * narrowed run that silently covered none of what it named is the one wrong
   * answer a diagnostic must not give, so it outranks a pass.
   */
  noCases: number
  /**
   * Families the run never reached, because it was cancelled or passed its
   * deadline. Like [`noCases`] it outranks a pass: the families that did run
   * say nothing about the ones that did not.
   */
  cancelled: number
  /** False while families are still running, which makes the verdict partial. */
  complete: boolean
  /**
   * Whether an op this device lacks would be run somewhere else. True for a
   * GPU or accelerator; false for the CPU, which *is* ggml's fallback. See
   * [`hasCpuFallback`].
   */
  canOffload: boolean
}

/**
 * Whether ggml has anywhere to send an op this device does not implement.
 *
 * The CPU is the fallback of last resort, so a case it has no kernel for is
 * not deferred anywhere -- it is simply absent. Calling that "runs on the
 * processor" on the CPU's own row is circular, and calling it "slower" names
 * no faster path that exists.
 */
export function hasCpuFallback(kind: DiagnosticsDeviceKind): boolean {
  return kind !== 'cpu'
}

/**
 * The one-line answer for a device.
 *
 * A crashed or hung family counts as failed: the user's model would have died
 * the same way. `fallback` is deliberately not a failure -- an accelerator
 * that lacks an op has it run on the CPU instead, which costs speed and
 * nothing else, and saying otherwise would send people chasing a non-problem.
 *
 * On the CPU itself an unsupported case is not a fallback and not a fault. The
 * check enumerates type combinations exhaustively, including backward/training
 * ops (`GET_ROWS_BACK`, `SOFT_MAX_BACK`, most of `OUT_PROD`) that inference
 * never builds, so every machine reports some. Those ops are also only
 * *partially* unsupported -- the CPU has a `MUL_MAT` kernel for 2630 of its
 * 3090 cases -- so naming the op would overstate it too.
 */
export function deviceVerdict(tally: DeviceTally): DeviceVerdict {
  if (tally.failed > 0 || tally.crashed > 0 || tally.hung > 0) return 'failed'
  // Before the `ok === 0` check below: a narrowed run whose filter matched no
  // case has no passes behind it either, and "Not checked" would say the run
  // never happened when in fact it finished and covered nothing it named.
  if (tally.noCases > 0) return 'inconclusive'
  // Nothing ran at all -- still going, or stopped before the first case. That
  // really is "not checked", which is why this sits above the partial test.
  if (tally.ok === 0) return 'unknown'
  // A partial device is inconclusive for the same reason: a run cut short by
  // the user or by its deadline has no evidence about the families it never
  // reached, and reporting the ones it did reach as a clean bill of health is
  // the wrong answer this verdict exists to prevent.
  if (tally.cancelled > 0 || !tally.complete) {
    return 'inconclusive'
  }
  if (tally.notSupported > 0 && tally.canOffload) return 'fallback'
  return 'passed'
}

/**
 * The tally for one device of a run. The single place the verdict inputs are
 * assembled, so the panel, the report and the suggestions cannot disagree
 * about what a device's result was.
 */
export function tallyOf(device: DiagnosticsDeviceRun): DeviceTally {
  return {
    ok: device.ok,
    failed: device.failed,
    notSupported: device.notSupported,
    crashed: device.crashed,
    hung: device.hung,
    noCases: device.noCases,
    cancelled: device.cancelled,
    complete: device.complete,
    canOffload: hasCpuFallback(device.device.type),
  }
}

/** A family status that means the leaf itself went wrong, not a kernel. */
export function isProcessFailure(status: DiagnosticsFamilyStatus): boolean {
  return status === 'crashed' || status === 'hung'
}

/**
 * A family that completed having tested nothing. Not a failure and not a
 * pass: the shapes it was narrowed to do not exist in this llama.cpp, so the
 * run has no evidence either way.
 */
export function isInconclusive(status: DiagnosticsFamilyStatus): boolean {
  return status === 'no_cases'
}

/** Whether a case outcome should draw the eye. */
export function isCaseFailure(status: DiagnosticsCaseStatus): boolean {
  return status === 'fail'
}
