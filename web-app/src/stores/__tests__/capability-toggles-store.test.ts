import { describe, it, expect, beforeEach } from 'vitest'
import { useCapabilityToggles, DEFAULT_CAPABILITY_TOGGLES } from '../capability-toggles-store'

describe('useCapabilityToggles', () => {
  beforeEach(() => {
    useCapabilityToggles.setState({ threads: {} })
  })

  it('returns default toggles for an unknown thread', () => {
    const toggles = useCapabilityToggles.getState().getToggles('unknown-thread')
    expect(toggles).toEqual(DEFAULT_CAPABILITY_TOGGLES)
    expect(toggles.webSearch).toBe(false)
    expect(toggles.reasoning).toBe(false)
    expect(toggles.embeddings).toBe(false)
  })

  it('toggle flips the targeted capability', () => {
    const { toggle, getToggles } = useCapabilityToggles.getState()
    toggle('thread-1', 'webSearch')
    expect(getToggles('thread-1').webSearch).toBe(true)
    toggle('thread-1', 'webSearch')
    expect(getToggles('thread-1').webSearch).toBe(false)
  })

  it('toggling one capability does not affect the others', () => {
    const { toggle, getToggles } = useCapabilityToggles.getState()
    toggle('thread-1', 'reasoning')
    const toggles = getToggles('thread-1')
    expect(toggles.reasoning).toBe(true)
    expect(toggles.webSearch).toBe(false)
    expect(toggles.embeddings).toBe(false)
  })

  it('setToggle sets a capability to an explicit value', () => {
    const { setToggle, getToggles } = useCapabilityToggles.getState()
    setToggle('thread-2', 'embeddings', true)
    expect(getToggles('thread-2').embeddings).toBe(true)
    setToggle('thread-2', 'embeddings', false)
    expect(getToggles('thread-2').embeddings).toBe(false)
  })

  it('threads are stored independently', () => {
    const { toggle, getToggles } = useCapabilityToggles.getState()
    toggle('thread-A', 'webSearch')
    toggle('thread-B', 'reasoning')
    expect(getToggles('thread-A').webSearch).toBe(true)
    expect(getToggles('thread-A').reasoning).toBe(false)
    expect(getToggles('thread-B').webSearch).toBe(false)
    expect(getToggles('thread-B').reasoning).toBe(true)
  })

  it('removeThread removes the thread state', () => {
    const { toggle, removeThread, getToggles } = useCapabilityToggles.getState()
    toggle('thread-X', 'webSearch')
    expect(getToggles('thread-X').webSearch).toBe(true)
    removeThread('thread-X')
    expect(getToggles('thread-X').webSearch).toBe(false)
  })
})
