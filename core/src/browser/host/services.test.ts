import { describe, expect, it } from 'vitest'
import { ServiceKey, createServiceRegistry } from './services'

const Greeter = new ServiceKey<{ greet(): string }>('greeter')

describe('ServiceRegistry', () => {
  it('returns undefined for a key nobody provides', () => {
    expect(createServiceRegistry().get(Greeter)).toBeUndefined()
  })

  it('returns the provided implementation until it is disposed', () => {
    const registry = createServiceRegistry()
    const impl = { greet: () => 'hi' }
    const registration = registry.provide(Greeter, impl)
    expect(registry.get(Greeter)).toBe(impl)
    registration.dispose()
    expect(registry.get(Greeter)).toBeUndefined()
  })

  it('refuses a second provider while the first is registered', () => {
    const registry = createServiceRegistry()
    registry.provide(Greeter, { greet: () => 'a' })
    expect(() => registry.provide(Greeter, { greet: () => 'b' })).toThrow(/greeter/)
  })

  it('lets a new provider take over after the old one is disposed', () => {
    const registry = createServiceRegistry()
    const first = registry.provide(Greeter, { greet: () => 'a' })
    first.dispose()
    const second = { greet: () => 'b' }
    registry.provide(Greeter, second)
    // A stale dispose must not remove the newer provider.
    first.dispose()
    expect(registry.get(Greeter)).toBe(second)
  })

  it('fires onDidChange with the key id on provide and on dispose', () => {
    const registry = createServiceRegistry()
    const seen: string[] = []
    registry.onDidChange((id) => seen.push(id))
    const registration = registry.provide(Greeter, { greet: () => 'a' })
    registration.dispose()
    registration.dispose()
    expect(seen).toEqual(['greeter', 'greeter'])
  })
})
