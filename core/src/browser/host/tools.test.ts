import { describe, expect, it, vi } from 'vitest'
import { createInternalToolRegistry, type InternalTool } from './tools'

const tool = (name: string, text = name): InternalTool => ({
  name,
  definition: () => ({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    server: 'test-internal',
  }),
  call: vi.fn(async () => ({ error: '', content: [{ type: 'text', text }] })),
})

describe('InternalToolRegistry', () => {
  it('lists names and definitions in registration order', () => {
    const registry = createInternalToolRegistry()
    registry.register(tool('b'))
    registry.register(tool('a'))
    expect(registry.names()).toEqual(['b', 'a'])
    expect(registry.definitions().map((d) => d.name)).toEqual(['b', 'a'])
  })

  it('builds definitions on every read, so they follow current settings', () => {
    const registry = createInternalToolRegistry()
    let limit = 3
    registry.register({
      ...tool('t'),
      definition: () => ({
        name: 't',
        description: String(limit),
        inputSchema: {},
        server: 's',
      }),
    })
    expect(registry.definitions()[0].description).toBe('3')
    limit = 7
    expect(registry.definitions()[0].description).toBe('7')
  })

  it('calls the registered handler with the arguments', async () => {
    const registry = createInternalToolRegistry()
    const t = tool('echo', 'out')
    registry.register(t)
    expect(registry.has('echo')).toBe(true)
    await expect(registry.call('echo', { x: 1 })).resolves.toEqual({
      error: '',
      content: [{ type: 'text', text: 'out' }],
    })
    expect(t.call).toHaveBeenCalledWith({ x: 1 })
  })

  it('answers an unknown tool with an error result', async () => {
    const res = await createInternalToolRegistry().call('nope', {})
    expect(res.error).toBe('Unknown tool: nope')
  })

  it('refuses a second tool of the same name', () => {
    const registry = createInternalToolRegistry()
    registry.register(tool('dup'))
    expect(() => registry.register(tool('dup'))).toThrow(/dup/)
  })

  it('forgets a tool when its registration is disposed and reports changes', () => {
    const registry = createInternalToolRegistry()
    const changes = vi.fn()
    registry.onDidChange(changes)
    const registration = registry.register(tool('gone'))
    registration.dispose()
    registration.dispose()
    expect(registry.has('gone')).toBe(false)
    expect(registry.names()).toEqual([])
    expect(changes).toHaveBeenCalledTimes(2)
  })
})
