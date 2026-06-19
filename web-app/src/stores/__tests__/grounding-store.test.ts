import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GroundingResult } from '@/lib/grounding'

// Controllable computeGrounding so we can resolve runs out of order.
const deferreds: Array<{
  resolve: (r: GroundingResult) => void
  reject: (e: unknown) => void
}> = []
vi.mock('@/lib/grounding', () => ({
  computeGrounding: vi.fn(
    () =>
      new Promise<GroundingResult>((resolve, reject) => {
        deferreds.push({ resolve, reject })
      })
  ),
}))

import { useGroundingStore } from '../grounding-store'

const citation = (id: string) => ({
  id,
  text: `text-${id}`,
  score: 1,
  file_id: 'f1',
})

const result = (tag: string): GroundingResult => ({
  sentenceCitations: { [tag]: [0] },
  citations: [citation('a')],
})

describe('grounding-store ensure', () => {
  beforeEach(() => {
    deferreds.length = 0
    useGroundingStore.setState({ byMessageId: {}, computing: {} })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('ignores a stale run that resolves after a newer run started', async () => {
    const embed = vi.fn(async () => [[1]])
    const { ensure } = useGroundingStore.getState()

    // Partial input (mid tool-sequence flicker).
    ensure('m1', 'partial', [citation('a')], embed)
    // Final input (full answer) — must supersede the partial run.
    ensure('m1', 'the full final answer text', [citation('a')], embed)

    expect(deferreds).toHaveLength(2)

    // Resolve the newer (final) run first, then the stale partial run.
    deferreds[1].resolve(result('final'))
    deferreds[0].resolve(result('partial'))
    await Promise.resolve()
    await Promise.resolve()

    expect(useGroundingStore.getState().byMessageId.m1).toEqual(result('final'))
    expect(useGroundingStore.getState().computing.m1).toBe(false)
  })

  it('does not restart for an identical fingerprint', () => {
    const embed = vi.fn(async () => [[1]])
    const { ensure } = useGroundingStore.getState()

    ensure('m2', 'same text', [citation('a')], embed)
    ensure('m2', 'same text', [citation('a')], embed)

    expect(deferreds).toHaveLength(1)
  })

  it('skips empty inputs', () => {
    const embed = vi.fn(async () => [[1]])
    const { ensure } = useGroundingStore.getState()

    ensure('', 'text', [citation('a')], embed)
    ensure('m3', '', [citation('a')], embed)
    ensure('m3', 'text', [], embed)

    expect(deferreds).toHaveLength(0)
  })
})
