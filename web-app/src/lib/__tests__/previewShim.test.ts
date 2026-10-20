import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { PREVIEW_SHIM_SCRIPT, previewShimError } from '../previewShim'

describe('PREVIEW_SHIM_SCRIPT', () => {
  const posted: unknown[] = []
  const sessionBefore = window.sessionStorage
  // What the wrapped history call reached the native method with.
  const historyCalls: Array<unknown[]> = []

  // One run for the file: the shim guards against a second install, and a
  // fresh install per test would stack listeners and double every report.
  beforeAll(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('sandboxed', 'SecurityError')
      },
    })
    // Stand in for the sandbox: any history call carrying a URL is rejected,
    // exactly as an opaque origin rejects it. Installed before the shim so the
    // shim wraps this throwing version.
    for (const name of ['pushState', 'replaceState'] as const) {
      Object.defineProperty(window.history, name, {
        configurable: true,
        writable: true,
        value(...args: unknown[]) {
          if (args[2] != null) {
            throw new DOMException('sandboxed', 'SecurityError')
          }
          historyCalls.push(args)
        },
      })
    }
    // jsdom's window.parent is the window itself.
    vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      posted.push(data)
    })
    new Function(PREVIEW_SHIM_SCRIPT)()
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    posted.length = 0
  })

  it('never contains a closing script tag', () => {
    expect(PREVIEW_SHIM_SCRIPT).not.toMatch(/<\/script/i)
  })

  // An opaque-origin frame throws on `localStorage` access; a game that saves a
  // high score at startup then never draws its first frame.
  it('replaces a throwing localStorage with an in-memory store', () => {
    window.localStorage.setItem('score', '42')
    expect(window.localStorage.getItem('score')).toBe('42')
    expect(window.localStorage.length).toBe(1)
    expect(window.localStorage.key(0)).toBe('score')
    window.localStorage.removeItem('score')
    expect(window.localStorage.getItem('score')).toBeNull()
  })

  it('leaves a working storage alone', () => {
    expect(window.sessionStorage).toBe(sessionBefore)
  })

  // A deep-linked slideshow calls pushState on every slide change; a thrown
  // SecurityError there aborts the click handler, so the button looks dead.
  it('keeps a URL-bearing history call from throwing', () => {
    historyCalls.length = 0
    expect(() =>
      window.history.pushState({ slide: 3 }, '', '#slide-3')
    ).not.toThrow()
    expect(() =>
      window.history.replaceState({ slide: 4 }, '', '?s=4')
    ).not.toThrow()
    // The state change survives; only the URL the sandbox forbids is dropped.
    expect(historyCalls).toEqual([
      [{ slide: 3 }, ''],
      [{ slide: 4 }, ''],
    ])
  })

  it('passes an already-safe history call straight through', () => {
    historyCalls.length = 0
    window.history.pushState({ ok: 1 }, '')
    // The wrapper forwards its three params; a URL-less call carries undefined,
    // which the native stand-in accepts without throwing.
    expect(historyCalls).toEqual([[{ ok: 1 }, '', undefined]])
  })

  it('reports uncaught errors and failed resources to the parent', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom' }))
    const script = document.createElement('script')
    script.src = 'https://cdn.example/lib.js'
    document.body.appendChild(script)
    script.dispatchEvent(new Event('error'))
    expect(posted).toEqual([
      { source: 'jan-preview-shim', type: 'error', message: 'boom' },
      {
        source: 'jan-preview-shim',
        type: 'error',
        message: 'Failed to load script https://cdn.example/lib.js',
      },
    ])
  })
})

describe('previewShimError', () => {
  it('extracts the message from a shim report only', () => {
    expect(
      previewShimError({ source: 'jan-preview-shim', type: 'error', message: 'x' })
    ).toBe('x')
    expect(previewShimError({ source: 'jan-preview-inspector', type: 'pin' })).toBeNull()
    expect(previewShimError({ source: 'jan-preview-shim', type: 'error' })).toBeNull()
    expect(previewShimError('nope')).toBeNull()
    expect(previewShimError(null)).toBeNull()
  })
})
