import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
// Deliberately NOT mocking 'sonner': this file proves the real library's
// pre-mount semantics, which module mocks cannot catch.
import { Toaster, toast } from 'sonner'

const flushSpy = vi.hoisted(() => vi.fn())
vi.mock('@/lib/coworkSync', () => ({ flushCoworkStartupWarnings: flushSpy }))

import { ToasterProvider } from '../ToasterProvider'

describe('startup warnings against the real sonner', () => {
  beforeEach(() => {
    cleanup()
    flushSpy.mockClear()
  })

  it('drops a toast fired before the Toaster mounts; a same-id re-fire after mount displays it', async () => {
    // Fired before any <Toaster> exists — the startup-warning situation.
    toast.warning('Journal warning probe', {
      id: 'journal-probe',
      duration: Infinity,
    })
    render(<Toaster />)
    // Sonner delivers via setTimeout+flushSync; give it ample time.
    await new Promise((resolve) => setTimeout(resolve, 80))
    // Real behavior, which the pending-warning flush exists to compensate:
    // the pre-mount toast is never rendered.
    expect(screen.queryByText('Journal warning probe')).toBeNull()
    // Re-firing with the SAME stable id after mount is displayed (and would
    // merely update, not duplicate, had the first one been shown).
    toast.warning('Journal warning probe', {
      id: 'journal-probe',
      duration: Infinity,
    })
    await vi.waitFor(() =>
      expect(screen.getByText('Journal warning probe')).toBeTruthy()
    )
  })

  it('ToasterProvider re-raises pending startup warnings from its mount effect', () => {
    render(<ToasterProvider />)
    // The child <Toaster> subscription effect runs before this parent effect
    // (React commits child effects first), so the flush lands post-subscribe.
    expect(flushSpy).toHaveBeenCalledTimes(1)
  })
})
