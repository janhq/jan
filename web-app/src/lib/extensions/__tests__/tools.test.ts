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
  it('is x_<hash of id and name>__<name>, within 64 provider-safe characters', () => {
    const name = toolWireName('jan-samples.hello-provider', 'echo_upper')
    expect(name).toMatch(/^x_[0-9a-f]{16}__echo_upper$/)
    expect(toolWireName('acme.one', 'say hi!')).toMatch(/^x_[0-9a-f]{16}__say_hi_$/)
    const long = toolWireName('acme.' + 'a'.repeat(38), 'b'.repeat(64))
    expect(long).toHaveLength(64)
    expect(long).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('keeps ids and names apart that sanitize or truncate to the same text', () => {
    // Both used to be x_acme_x_foo__t.
    expect(toolWireName('acme-x.foo', 't')).not.toBe(toolWireName('acme.x-foo', 't'))
    expect(toolWireName('acme.one', 'a.b')).not.toBe(toolWireName('acme.one', 'a_b'))
    const long = 'n'.repeat(60)
    expect(toolWireName('acme.one', `${long}1`)).not.toBe(
      toolWireName('acme.one', `${long}2`)
    )
  })
})

describe('listExtensionTools', () => {
  it('lists bound tools only, sorted, under their own wire names', () => {
    const tools = listExtensionTools(
      state({
        'acme.two': { b: tool('b'), a: tool('a') },
        'acme.one': { echo: tool('echo'), idle: tool('idle', false) },
      })
    )
    expect(tools.map((t) => [t.extensionId, t.name])).toEqual([
      ['acme.one', 'echo'],
      ['acme.two', 'a'],
      ['acme.two', 'b'],
    ])
    for (const t of tools)
      expect(t.wireName).toBe(toolWireName(t.extensionId, t.name))
    expect(tools[0].server).toBe('ext:acme.one')
  })

  it('never moves a wire name to another extension when one loads', () => {
    const before = listExtensionTools(state({ 'acme.x-foo': { t: tool('t') } }))
    const after = listExtensionTools(
      state({ 'acme-x.foo': { t: tool('t') }, 'acme.x-foo': { t: tool('t') } })
    )
    const owner = (list: typeof after, wireName: string) =>
      list.find((t) => t.wireName === wireName)?.extensionId
    expect(owner(after, before[0].wireName)).toBe('acme.x-foo')
    expect(new Set(after.map((t) => t.wireName)).size).toBe(2)
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
