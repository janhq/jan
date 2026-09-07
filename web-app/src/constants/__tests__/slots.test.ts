import { describe, it, expect } from 'vitest'
import {
  CHAT_SLOT_ID,
  BACKGROUND_SLOT_ID,
  COWORK_SLOT_ID,
} from '@/constants/models'
import { RESERVED_BACKGROUND_SLOTS } from '../../../../extensions/llamacpp-extension/src/preset'

// llama.cpp wraps an out-of-range id_slot modulo the slot count instead of
// rejecting it, so a pin naming a slot that does not exist silently lands back
// on slot 0 and overwrites the chat cache it was meant to avoid. These two
// files are the only things keeping that from happening, and they live in
// separate packages — so the invariant is asserted rather than commented.
describe('llama.cpp slot allocation', () => {
  it('gives every pinned surface a distinct slot', () => {
    const pins = [CHAT_SLOT_ID, BACKGROUND_SLOT_ID, COWORK_SLOT_ID]
    expect(new Set(pins).size).toBe(pins.length)
  })

  it('reserves enough slots for every non-chat pin to exist', () => {
    const nonChatPins = [BACKGROUND_SLOT_ID, COWORK_SLOT_ID]
    expect(RESERVED_BACKGROUND_SLOTS).toBeGreaterThanOrEqual(
      nonChatPins.length
    )
    // Contiguous from 1: the reservation adds N slots above the user's
    // configured parallel value, so pin ids must fill 1..N with no gap.
    expect([...nonChatPins].sort()).toEqual([1, 2])
  })

  it('keeps chat on slot 0', () => {
    expect(CHAT_SLOT_ID).toBe(0)
  })
})
