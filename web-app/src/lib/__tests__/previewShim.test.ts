import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { PREVIEW_SHIM_SCRIPT, previewShimError } from '../previewShim'

describe('PREVIEW_SHIM_SCRIPT', () => {
  const posted: unknown[] = []
  const sessionBefore = window.sessionStorage

  // One run for the file: the shim guards against a second install, and a
  // fresh install per test would stack listeners and double every report.
  beforeAll(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('sandboxed', 'SecurityError')
      },
    })
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
