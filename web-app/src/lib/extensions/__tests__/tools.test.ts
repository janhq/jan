import { describe, expect, it } from 'vitest'
import type { ContributionState } from '../contributions'
import { listExtensionTools, toToolOutcome, toolWireName } from '../tools'

const tool = (name: string, bound = true) => ({
  name,
  description: name,
  inputSchema: { type: 'object' as const },
  handler: bound
    ? async () => ({ content: [] })
    : undefined,
})

const state = (
  tools: ContributionState['tools']
): ContributionState => ({
  extensions: {},
  commands: {},
  menus: {},
  statusItems: {},
  settings: {},
  tools,
  providers: {},
})

describe('toolWireName', () => {
  it('prefixes the extension id with . and - replaced', () => {
    expect(toolWireName('jan-samples.hello-provider', 'echo_upper')).toBe(
      'x_jan_samples_hello_provider__echo_upper'
    )
  })

  it('cuts to 64 characters and replaces what providers reject', () => {
    const name = toolWireName('acme.' + 'a'.repeat(38), 'b'.repeat(40))
    expect(name).toHaveLength(64)
    expect(toolWireName('acme.one', 'say hi!')).toBe('x_acme_one__say_hi_')
  })
})

describe('listExtensionTools', () => {
  it('lists bound tools only, sorted, with unique names', () => {
    const long = 'n'.repeat(60)
    const tools = listExtensionTools(
      state({
        'acme.two': { b: tool('b'), a: tool('a') },
        'acme.one': {
          [`${long}1`]: tool(`${long}1`),
          [`${long}2`]: tool(`${long}2`),
          idle: tool('idle', false),
        },
      })
    )
    expect(tools.map((t) => [t.extensionId, t.name])).toEqual([
      ['acme.one', `${long}1`],
      ['acme.one', `${long}2`],
      ['acme.two', 'a'],
      ['acme.two', 'b'],
    ])
    const names = tools.map((t) => t.wireName)
    expect(new Set(names).size).toBe(names.length)
    expect(names.every((n) => n.length <= 64)).toBe(true)
    expect(names[1].endsWith('_2')).toBe(true)
    expect(tools[0].server).toBe('ext:acme.one')
  })
})

describe('toToolOutcome', () => {
  it('serializes json parts and caps the total length', () => {
    expect(
      toToolOutcome(
        {
          content: [
            { type: 'text', text: 'abc' },
            { type: 'json', value: { a: 1 } },
          ],
        },
        6
      )
    ).toEqual({
      content: [
        { type: 'text', text: 'abc' },
        { type: 'text', text: '{"a' },
      ],
    })
  })

  it('reports isError and malformed results as errors', () => {
    expect(
      toToolOutcome({ content: [{ type: 'text', text: 'bad input' }], isError: true })
    ).toEqual({ error: 'bad input' })
    expect(toToolOutcome({ content: 'nope' })).toMatchObject({
      error: expect.any(String),
    })
    expect(toToolOutcome(undefined)).toMatchObject({ error: expect.any(String) })
  })
})
