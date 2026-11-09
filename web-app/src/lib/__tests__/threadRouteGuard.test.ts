import { describe, it, expect } from 'vitest'
import { shouldRedirectThreadToCowork } from '../threadRouteGuard'

type SessionArg = Parameters<typeof shouldRedirectThreadToCowork>[1][number]

const session = (
  id: string,
  unavailable?: SessionArg['unavailable']
): SessionArg => (unavailable ? { id, unavailable } : { id })

const chatThread = { metadata: {} }
const coworkThread = { metadata: { mode: 'cowork' } }

describe('shouldRedirectThreadToCowork', () => {
  // Baseline: the pre-existing redirect behavior is preserved.
  it('redirects a normal cowork session id to the Cowork view', () => {
    expect(
      shouldRedirectThreadToCowork('a', [session('a')], coworkThread)
    ).toBe(true)
  })

  it('keeps an ordinary chat thread on the chat route', () => {
    expect(
      shouldRedirectThreadToCowork('a', [session('b')], chatThread)
    ).toBe(false)
    expect(shouldRedirectThreadToCowork('a', [], chatThread)).toBe(false)
    expect(shouldRedirectThreadToCowork('a', [], undefined)).toBe(false)
  })

  // R2: an id-collision placeholder marks a legacy session whose id is owned
  // by a real chat thread. The chat keeps its route.
  it('does not let an id-collision placeholder hijack the real chat route', () => {
    expect(
      shouldRedirectThreadToCowork(
        'a',
        [session('a', 'id-collision')],
        chatThread
      )
    ).toBe(false)
  })

  it('still redirects when the thread record itself is cowork-mode even if a collision placeholder exists', () => {
    // Defensive: loadCoworkSessions only mints id-collision against chat ids,
    // but if the record says cowork the chat view must never mount.
    expect(
      shouldRedirectThreadToCowork(
        'a',
        [session('a', 'id-collision')],
        coworkThread
      )
    ).toBe(true)
  })

  // Preserved: the other unavailable placeholders render (read-only) in the
  // Cowork view, so they keep claiming the route.
  it.each(['missing-sidecar', 'unreadable-sidecar'] as const)(
    'redirects a %s placeholder to the Cowork view',
    (reason) => {
      expect(
        shouldRedirectThreadToCowork('a', [session('a', reason)], coworkThread)
      ).toBe(true)
    }
  )

  // R3: failed hydration leaves the session store empty while the thread list
  // still carries the committed cowork record. The chat view must not mount.
  it('redirects a cowork-mode thread even when the session store is empty (failed hydration)', () => {
    expect(shouldRedirectThreadToCowork('a', [], coworkThread)).toBe(true)
  })

  it('redirects a cowork-mode thread missing from a non-empty session store', () => {
    expect(
      shouldRedirectThreadToCowork('a', [session('b')], coworkThread)
    ).toBe(true)
  })

  // Absent metadata.mode means chat (threadMode contract): an unhydrated id
  // with no cowork marker anywhere stays on the chat route.
  it('does not redirect when neither store knows the id', () => {
    expect(shouldRedirectThreadToCowork('a', [], null)).toBe(false)
    expect(
      shouldRedirectThreadToCowork('a', [], { metadata: { mode: 'chat' } })
    ).toBe(false)
    expect(shouldRedirectThreadToCowork('a', [], { metadata: null })).toBe(
      false
    )
  })

  it('matches only the exact thread id', () => {
    expect(
      shouldRedirectThreadToCowork(
        'a',
        [session('a-2'), session('b', 'id-collision')],
        chatThread
      )
    ).toBe(false)
  })
})
