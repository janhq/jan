import { describe, expect, it } from 'vitest'

import {
  deviceVerdict,
  groupForOp,
  isQuantizedCase,
  type DeviceTally,
  hasCpuFallback,
} from '@/lib/diagnosticsGroups'

const tally = (over: Partial<DeviceTally> = {}): DeviceTally => ({
  ok: 100,
  failed: 0,
  notSupported: 0,
  crashed: 0,
  hung: 0,
  noCases: 0,
  complete: true,
  canOffload: true,
  ...over,
})

describe('hasCpuFallback', () => {
  it('is false only for the CPU itself', () => {
    expect(hasCpuFallback('cpu')).toBe(false)
    for (const kind of ['gpu', 'igpu', 'accel', 'meta', 'unknown'] as const) {
      expect(hasCpuFallback(kind)).toBe(true)
    }
  })
})

describe('groupForOp', () => {
  it('puts the matmul family together, including its fusions', () => {
    for (const op of [
      'MUL_MAT',
      'MUL_MAT_ID',
      'MUL_MAT_VEC_FUSION',
      'MUL_MAT_ID_W4A8',
      'OUT_PROD',
    ]) {
      expect(groupForOp(op)).toBe('matrixMath')
    }
  })

  it('does not let MUL_MAT fall into basic arithmetic', () => {
    // The rule order is what prevents this: `MUL` is in the basic-math set.
    expect(groupForOp('MUL')).toBe('basicMath')
    expect(groupForOp('MUL_MAT')).toBe('matrixMath')
  })

  it('groups the token-mixing ops as attention, including the replacements', () => {
    for (const op of [
      'FLASH_ATTN_EXT',
      'SOFT_MAX',
      'DIAG_MASK_INF',
      'TOPK_MOE',
      'TOP_K',
      'SSM_SCAN',
      'RWKV_WKV6',
      'GATED_LINEAR_ATTN',
      'GATED_DELTA_NET_CACHE_FUSION',
    ]) {
      expect(groupForOp(op)).toBe('attention')
    }
  })

  it('reads a fused op by what it is for, not by every name in it', () => {
    // Contains NORM, MUL and ROPE; it is a normalization kernel.
    expect(groupForOp('RMS_NORM_MUL_ROPE')).toBe('normalization')
    expect(groupForOp('GROUP_NORM_MUL_ADD')).toBe('normalization')
  })

  it('covers the remaining groups', () => {
    expect(groupForOp('ROPE_BACK')).toBe('positional')
    expect(groupForOp('CONV_2D')).toBe('convolution')
    expect(groupForOp('IM2COL_3D')).toBe('convolution')
    expect(groupForOp('SILU')).toBe('activation')
    expect(groupForOp('SWIGLU')).toBe('activation')
    expect(groupForOp('GET_ROWS')).toBe('memory')
    expect(groupForOp('CPY')).toBe('memory')
    expect(groupForOp('ADD')).toBe('basicMath')
  })

  it('is case insensitive and never throws on an op it does not know', () => {
    expect(groupForOp('mul_mat')).toBe('matrixMath')
    expect(groupForOp('SOMETHING_UPSTREAM_ADDED')).toBe('other')
    expect(groupForOp('')).toBe('other')
  })
})

describe('isQuantizedCase', () => {
  it('reads quantization off the parameters, not the op name', () => {
    expect(isQuantizedCase('type_a=q4_K,type_b=f32,m=4096')).toBe(true)
    expect(isQuantizedCase('type=iq4_nl,ne=[128,2,2,2]')).toBe(true)
    expect(isQuantizedCase('type=mxfp4,ne=[32]')).toBe(true)
    expect(isQuantizedCase('type=f16,ne_a=[128,2,2,2],v=0')).toBe(false)
    expect(isQuantizedCase('')).toBe(false)
  })
})

describe('deviceVerdict', () => {
  it('passes a device that ran cases and broke none', () => {
    expect(deviceVerdict(tally())).toBe('passed')
  })

  it('treats a not-supported op as a fallback, never a failure', () => {
    expect(deviceVerdict(tally({ notSupported: 300 }))).toBe('fallback')
  })

  // The CPU is ggml's fallback of last resort, so an op it lacks is not
  // deferred anywhere. Reporting "runs on the processor" on the processor's
  // own row is circular, and there is no slower path to warn about.
  it('does not call the CPU a fallback, because it has nowhere to fall back to', () => {
    expect(deviceVerdict(tally({ notSupported: 3239, canOffload: false }))).toBe(
      'passed'
    )
  })

  it('still fails the CPU on a wrong answer', () => {
    expect(
      deviceVerdict(tally({ notSupported: 3239, failed: 1, canOffload: false }))
    ).toBe('failed')
  })

  it('fails on a wrong answer, a crash or a hang alike', () => {
    expect(deviceVerdict(tally({ failed: 1 }))).toBe('failed')
    expect(deviceVerdict(tally({ crashed: 1 }))).toBe('failed')
    expect(deviceVerdict(tally({ hung: 1 }))).toBe('failed')
  })

  it('a failure outranks a fallback', () => {
    expect(deviceVerdict(tally({ failed: 1, notSupported: 300 }))).toBe('failed')
  })

  it('reports nothing rather than a pass when no case ran', () => {
    expect(deviceVerdict(tally({ ok: 0 }))).toBe('unknown')
  })

  // The failure this phase exists to avoid: a shape filter that matched no
  // case leaves the other families passing, and the device would otherwise
  // read as a clean bill of health for parts that were never checked.
  it('never calls a device passed while part of the check tested nothing', () => {
    expect(deviceVerdict(tally({ noCases: 1 }))).toBe('inconclusive')
    expect(deviceVerdict(tally({ noCases: 1, notSupported: 300 }))).toBe(
      'inconclusive'
    )
  })

  it('a real failure still outranks an untested family', () => {
    expect(deviceVerdict(tally({ noCases: 1, failed: 2 }))).toBe('failed')
  })
})
