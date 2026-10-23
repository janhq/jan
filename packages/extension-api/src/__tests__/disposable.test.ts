import { describe, expect, it, vi } from 'vitest'
import { DisposableStore, Emitter, toDisposable } from '../index.js'

describe('DisposableStore', () => {
  it('disposes its members once, in reverse order', () => {
    const order: string[] = []
    const store = new DisposableStore()
    store.add(toDisposable(() => order.push('a')))
    store.add(toDisposable(() => order.push('b')))
    store.dispose()
    store.dispose()
    expect(order).toEqual(['b', 'a'])
  })

  it('disposes a member added after the store was disposed', () => {
    const store = new DisposableStore()
    store.dispose()
    const fn = vi.fn()
    store.add(toDisposable(fn))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('keeps disposing the rest when one member throws', () => {
    const store = new DisposableStore()
    const after = vi.fn()
    store.add(toDisposable(after))
    store.add(
      toDisposable(() => {
        throw new Error('boom')
      })
    )
    expect(() => store.dispose()).toThrow('boom')
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('runs a toDisposable callback only once', () => {
    const fn = vi.fn()
    const d = toDisposable(fn)
    d.dispose()
    d.dispose()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('Emitter', () => {
  it('delivers to listeners until they are disposed', () => {
    const emitter = new Emitter<number>()
    const seen: number[] = []
    const sub = emitter.event((n) => seen.push(n))
    emitter.fire(1)
    sub.dispose()
    emitter.fire(2)
    expect(seen).toEqual([1])
  })

  it('drops every listener on dispose', () => {
    const emitter = new Emitter<string>()
    const listener = vi.fn()
    emitter.event(listener)
    emitter.dispose()
    emitter.fire('x')
    expect(listener).not.toHaveBeenCalled()
  })
})
