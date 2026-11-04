import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { MEMORY_SAVE_TOAST_ID, notifyMemoryMutation } from '../memorySaveFeedback'

vi.mock('sonner', () => ({ toast: vi.fn() }))
vi.mock('@/components/MemorySavedToast', () => ({ MemorySavedToast: () => null }))

describe('durable memory feedback', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['write', 'Wrote 12 bytes to memory/prefs.md'],
    ['edit', 'Edited memory/prefs (archived: status: done)'],
    ['delete', 'Deleted memory/prefs'],
    ['move', 'Moved memory/old to memory/new'],
  ])('announces native %s acknowledgements without exposing output', (op, output) => {
    notifyMemoryMutation({ op }, output)
    expect(toast).toHaveBeenCalledTimes(1)
    const [message, options] = vi.mocked(toast).mock.calls[0]
    expect(JSON.stringify(message)).not.toContain('memory/')
    expect(options).toMatchObject({ id: MEMORY_SAVE_TOAST_ID, duration: 6000, closeButton: true })
  })

  it.each([
    ['view', 'Wrote 12 bytes to memory/prefs.md'],
    ['search', 'Edited memory/prefs'],
    ['delete', "No note 'prefs' to delete"],
    ['write', 'ERROR: permission denied'],
    ['write', 'Stopped before the tool finished.'],
    ['write', 'ok'],
    ['write', undefined],
    ['unknown', 'Deleted memory/prefs'],
  ])('ignores non-mutation, failed and unverified results (%s / %s)', (op, output) => {
    notifyMemoryMutation({ op }, output)
    expect(toast).not.toHaveBeenCalled()
  })

  it('suppresses late native success after Stop', () => {
    const controller = new AbortController()
    controller.abort()
    notifyMemoryMutation({ op: 'write' }, 'Wrote 12 bytes to memory/prefs.md', controller.signal)
    expect(toast).not.toHaveBeenCalled()
  })

  it('bounds repeated writes to a single toast slot', () => {
    for (let i = 0; i < 50; i++) {
      notifyMemoryMutation({ op: 'write' }, `Wrote ${i} bytes to memory/prefs.md`)
    }
    expect(toast).toHaveBeenCalledTimes(50)
    expect(new Set(vi.mocked(toast).mock.calls.map(([, options]) => options?.id)))
      .toEqual(new Set([MEMORY_SAVE_TOAST_ID]))
  })
})
