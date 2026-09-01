import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sandboxEnforces, buildCoworkTools, getMemoryCatalog } = vi.hoisted(
  () => ({
    sandboxEnforces: vi.fn(() => true),
    buildCoworkTools: vi.fn(),
    getMemoryCatalog: vi.fn(async () => [] as unknown[]),
  })
)
vi.mock('@/lib/agentTools', () => ({ sandboxEnforces, getMemoryCatalog }))
vi.mock('@/lib/coworkTools', async (orig) => ({
  ...(await orig<typeof import('../coworkTools')>()),
  buildCoworkTools,
}))

import { CoworkChatTransport } from '../coworkTransport'
import { CHAT_SLOT_ID, COWORK_SLOT_ID } from '@/constants/models'

const config = (over = {}) => ({
  planMode: false,
  webSearch: false,
  subagentNames: ['researcher'],
  allowSubagents: true,
  workspacePath: '/ws/s1',
  readOnlyFolder: null,
  ...over,
})

// Reaching in on purpose: these are protected seams whose whole job is to be
// different from the parent's, and both fail silently in production.
const slotParamsOf = (t: CoworkChatTransport, id: string) =>
  (t as unknown as {
    slotParams: (s?: string) => Record<string, unknown>
  }).slotParams(id)

describe('CoworkChatTransport', () => {
  beforeEach(() => {
    buildCoworkTools.mockReset()
    buildCoworkTools.mockResolvedValue({ read: {} })
    sandboxEnforces.mockReturnValue(true)
  })

  // Sharing slot 0 would have each of an agent turn's many prefills evict the
  // viewed chat thread's KV cache, and vice versa. Nothing surfaces that but a
  // slowdown, so it is asserted.
  it('pins to the Cowork slot, not the chat slot', () => {
    const t = new CoworkChatTransport('s1', config())
    const params = slotParamsOf(t, 's1')
    expect(params.id_slot).toBe(COWORK_SLOT_ID)
    expect(params.id_slot).not.toBe(CHAT_SLOT_ID)
    expect(params.thread_id).toBe('cowork:s1')
  })

  it('namespaces thread_id so a session cannot collide with a chat thread', () => {
    const t = new CoworkChatTransport('abc', config())
    expect(slotParamsOf(t, 'abc').thread_id).toBe('cowork:abc')
  })

  it('builds the tool set once and reuses it for the rest of the run', async () => {
    const t = new CoworkChatTransport('s1', config())
    await t.refreshTools()
    await t.refreshTools()
    await t.refreshTools()
    expect(buildCoworkTools).toHaveBeenCalledTimes(1)
  })

  // A config change must not take effect mid-run: it would change the tool JSON
  // and throw away the prompt prefix on the very next step.
  it('ignores a config change until the freeze is lifted', async () => {
    const t = new CoworkChatTransport('s1', config())
    await t.refreshTools()
    t.setConfig(config({ planMode: true }))
    await t.refreshTools()
    expect(buildCoworkTools).toHaveBeenCalledTimes(1)

    t.unfreezeTools()
    await t.refreshTools()
    expect(buildCoworkTools).toHaveBeenCalledTimes(2)
    expect(buildCoworkTools).toHaveBeenLastCalledWith(
      expect.objectContaining({ planMode: true })
    )
  })

  // Memory moves independently of the tool config: a note written during one
  // run must reach the next run's prompt even when the tool set is reused, and
  // must not move mid-run, which would discard the prompt prefix.
  it('re-snapshots the memory catalog at run boundaries, not mid-run', async () => {
    getMemoryCatalog.mockReset()
    getMemoryCatalog.mockResolvedValue([])
    const t = new CoworkChatTransport('s1', config())
    await t.refreshTools()
    await t.refreshTools()
    expect(getMemoryCatalog).toHaveBeenCalledTimes(1)

    t.unfreezeTools()
    await t.refreshTools()
    expect(getMemoryCatalog).toHaveBeenCalledTimes(2)
    // Same config, so the tool set was reused -- the catalog still refreshed.
    expect(buildCoworkTools).toHaveBeenCalledTimes(1)
  })

  it('rebuilds when the sandbox appears, since bash joins the set', async () => {
    sandboxEnforces.mockReturnValue(false)
    const t = new CoworkChatTransport('s1', config())
    await t.refreshTools()
    sandboxEnforces.mockReturnValue(true)
    t.unfreezeTools()
    await t.refreshTools()
    expect(buildCoworkTools).toHaveBeenCalledTimes(2)
  })

  // The parent throws when a window has no user turn. That is right for chat,
  // where it means eviction ate the question, and wrong for a long agent run
  // whose recent traffic is all tool results.
  it('does not abort a window whose recent traffic is all tool results', () => {
    const t = new CoworkChatTransport('s1', config())
    expect(() =>
      (t as unknown as { assertSendable: (m: unknown[]) => void }).assertSendable(
        []
      )
    ).not.toThrow()
  })
})

describe('CoworkChatTransport.advertisedTools', () => {
  beforeEach(() => {
    buildCoworkTools.mockReset()
    buildCoworkTools.mockResolvedValue({ read: {}, task: {} })
    sandboxEnforces.mockReturnValue(true)
  })

  // A subagent's allowlist intersects with this, so plan mode and a withheld
  // `bash` reach children without a second policy check.
  it('reports the set frozen for the run', async () => {
    const t = new CoworkChatTransport('s1', config())
    await t.refreshTools()
    expect(Object.keys(t.advertisedTools)).toEqual(['read', 'task'])
  })

  it('is empty before a run advertises anything', () => {
    const t = new CoworkChatTransport('s1', config())
    expect(t.advertisedTools).toEqual({})
  })
})
