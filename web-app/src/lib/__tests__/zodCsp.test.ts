import { describe, it, expect } from 'vitest'
import { config } from 'zod'
import '@/lib/zodCsp'

describe('zodCsp', () => {
  // Without jitless, the first object schema probes `new Function`, which the
  // window CSP (no 'unsafe-eval') refuses and reports as a violation.
  it('turns off the eval-based fast path', () => {
    expect(config().jitless).toBe(true)
  })
})
