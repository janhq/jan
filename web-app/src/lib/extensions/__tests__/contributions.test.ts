import { describe, expect, it, vi } from 'vitest'
import { ContributionStore } from '../contributions'
import { manifest } from './fixtures'

const helloManifest = (id: string) =>
  manifest(id, {
    permissions: ['tools'],
    contributes: {
      commands: [{ id: 'hello', title: `Hello from ${id}` }],
      menus: { commandPalette: [{ command: 'hello' }] },
      statusItems: [{ id: 'status', text: 'idle' }],
      settings: [
        {
          key: 'name',
          title: 'Name',
          control: { type: 'input', default: 'x' },
        },
      ],
      tools: [
        { name: 'echo', description: 'Echo', inputSchema: { type: 'object' } },
      ],
      providers: [{ id: 'p', displayName: 'P', baseUrl: 'https://p.dev/v1' }],
    },
  })

describe('ContributionStore', () => {
  it('lists declared contributions per extension and removes them on dispose', () => {
    const store = new ContributionStore()
    const registration = store.registerExtension(helloManifest('acme.one'))
    const s = store.getState()
    expect(s.extensions['acme.one']).toEqual({ displayName: 'acme.one' })
    expect(s.commands['acme.one'].hello.title).toBe('Hello from acme.one')
    expect(s.menus['acme.one'].commandPalette).toEqual([{ command: 'hello' }])
    expect(s.statusItems['acme.one'].status.text).toBe('idle')
    expect(s.settings['acme.one'].map((x) => x.key)).toEqual(['name'])
    expect(Object.keys(s.tools['acme.one'])).toEqual(['echo'])
    expect(Object.keys(s.providers['acme.one'])).toEqual(['p'])

    registration.dispose()
    const after = store.getState()
    for (const slice of [
      after.extensions,
      after.commands,
      after.menus,
      after.statusItems,
      after.settings,
      after.tools,
      after.providers,
    ]) {
      expect(slice).not.toHaveProperty('acme.one')
    }
  })

  it('keeps same-named commands of two extensions apart', async () => {
    const store = new ContributionStore()
    store.registerExtension(helloManifest('acme.one'))
    store.registerExtension(helloManifest('acme.two'))
    const one = vi.fn().mockReturnValue(1)
    const two = vi.fn().mockReturnValue(2)
    store.registerCommand('acme.one', 'hello', one)
    store.registerCommand('acme.two', 'hello', two)

    await expect(
      store.executeCommand('acme.two', 'hello', { location: 'commandPalette' })
    ).resolves.toBe(2)
    expect(one).not.toHaveBeenCalled()
    expect(two).toHaveBeenCalledWith({ location: 'commandPalette' })
  })

  it('refuses a second registration of the same extension id', () => {
    const store = new ContributionStore()
    store.registerExtension(helloManifest('acme.one'))
    expect(() => store.registerExtension(helloManifest('acme.one'))).toThrow(
      /acme.one/
    )
  })

  it('binds a command handler until disposed', async () => {
    const store = new ContributionStore()
    store.registerExtension(helloManifest('acme.one'))
    const handler = vi.fn()
    const binding = store.registerCommand('acme.one', 'hello', handler)
    expect(store.getState().commands['acme.one'].hello.handler).toBe(handler)
    binding.dispose()
    expect(store.getState().commands['acme.one'].hello.handler).toBeUndefined()
    await expect(
      store.executeCommand('acme.one', 'hello', { location: 'commandPalette' })
    ).rejects.toMatchObject({
      code: 'E_NOT_FOUND',
    })
  })

  it('rejects handlers for undeclared or already bound commands', () => {
    const store = new ContributionStore()
    store.registerExtension(helloManifest('acme.one'))
    expect(() =>
      store.registerCommand('acme.one', 'nope', vi.fn())
    ).toThrowError(expect.objectContaining({ code: 'E_NOT_FOUND' }))
    store.registerCommand('acme.one', 'hello', vi.fn())
    expect(() =>
      store.registerCommand('acme.one', 'hello', vi.fn())
    ).toThrowError(expect.objectContaining({ code: 'E_INVALID_ARGS' }))
  })

  it('binds tool and provider handlers to declared entries only', () => {
    const store = new ContributionStore()
    store.registerExtension(helloManifest('acme.one'))
    const tool = vi.fn()
    const toolBinding = store.registerTool('acme.one', 'echo', tool)
    const providerBinding = store.registerProvider('acme.one', 'p', {})
    expect(store.getState().tools['acme.one'].echo.handler).toBe(tool)
    expect(store.getState().providers['acme.one'].p.handler).toEqual({})
    expect(() => store.registerTool('acme.one', 'other', tool)).toThrowError(
      expect.objectContaining({ code: 'E_NOT_FOUND' })
    )
    toolBinding.dispose()
    providerBinding.dispose()
    expect(store.getState().tools['acme.one'].echo.handler).toBeUndefined()
    expect(store.getState().providers['acme.one'].p.handler).toBeUndefined()
  })

  it('updates a declared status item and ignores a stale binding after re-registration', () => {
    const store = new ContributionStore()
    const first = store.registerExtension(helloManifest('acme.one'))
    store.setStatusItem('acme.one', 'status', { text: 'busy' })
    expect(store.getState().statusItems['acme.one'].status).toMatchObject({
      text: 'busy',
    })
    expect(() =>
      store.setStatusItem('acme.one', 'nope', { text: 'x' })
    ).toThrowError(expect.objectContaining({ code: 'E_NOT_FOUND' }))
    const binding = store.registerCommand('acme.one', 'hello', vi.fn())
    first.dispose()
    store.registerExtension(helloManifest('acme.one'))
    const handler = vi.fn()
    store.registerCommand('acme.one', 'hello', handler)
    binding.dispose()
    expect(store.getState().commands['acme.one'].hello.handler).toBe(handler)
  })
})
