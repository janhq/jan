import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reconcileConstraintParams } from '../model-factory'

const TOOLS = [{ type: 'function', function: { name: 'search' } }]

describe('reconcileConstraintParams', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))
  afterEach(() => vi.restoreAllMocks())

  // The server throws on the *presence* of the key, so an untouched Grammar
  // row (default '') would 400 every request in a tool-enabled thread.
  it('drops an empty grammar', () => {
    const body: Record<string, unknown> = { grammar: '', messages: [] }
    reconcileConstraintParams(body)
    expect(body).not.toHaveProperty('grammar')
  })

  it('drops a whitespace-only grammar', () => {
    const body: Record<string, unknown> = { grammar: '  \n ' }
    reconcileConstraintParams(body)
    expect(body).not.toHaveProperty('grammar')
  })

  it('keeps a real grammar when the request carries no tools', () => {
    const body: Record<string, unknown> = { grammar: 'root ::= "a"' }
    reconcileConstraintParams(body)
    expect(body.grammar).toBe('root ::= "a"')
  })

  it('drops a grammar the server would reject alongside tools', () => {
    const body: Record<string, unknown> = {
      grammar: 'root ::= "a"',
      tools: TOOLS,
    }
    reconcileConstraintParams(body)
    expect(body).not.toHaveProperty('grammar')
    expect(body.tools).toBe(TOOLS)
  })

  // tool_choice 'none' means the tools are not offered, so the server's
  // grammar check does not fire.
  it('keeps a grammar when tools are present but disabled', () => {
    const body: Record<string, unknown> = {
      grammar: 'root ::= "a"',
      tools: TOOLS,
      tool_choice: 'none',
    }
    reconcileConstraintParams(body)
    expect(body.grammar).toBe('root ::= "a"')
  })

  it('keeps a grammar when tools is an empty array', () => {
    const body: Record<string, unknown> = { grammar: 'root ::= "a"', tools: [] }
    reconcileConstraintParams(body)
    expect(body.grammar).toBe('root ::= "a"')
  })

  // The textarea holds a string; the server parses it back to a JSON *string*
  // and every consumer requires an object, so it was silently ignored.
  it('parses a json_schema string into an object', () => {
    const body: Record<string, unknown> = {
      json_schema: '{"type":"object","properties":{}}',
    }
    reconcileConstraintParams(body)
    expect(body.json_schema).toEqual({ type: 'object', properties: {} })
  })

  it('passes an already-parsed json_schema through', () => {
    const schema = { type: 'object' }
    const body: Record<string, unknown> = { json_schema: schema }
    reconcileConstraintParams(body)
    expect(body.json_schema).toBe(schema)
  })

  it('drops an empty json_schema', () => {
    const body: Record<string, unknown> = { json_schema: '   ' }
    reconcileConstraintParams(body)
    expect(body).not.toHaveProperty('json_schema')
  })

  it('drops an unparseable json_schema rather than failing the request', () => {
    const body: Record<string, unknown> = { json_schema: '{not json' }
    reconcileConstraintParams(body)
    expect(body).not.toHaveProperty('json_schema')
    expect(console.warn).toHaveBeenCalled()
  })

  it('drops a json_schema that is not an object', () => {
    const body: Record<string, unknown> = { json_schema: '"a string"' }
    reconcileConstraintParams(body)
    expect(body).not.toHaveProperty('json_schema')
  })

  it('drops a json_schema array', () => {
    const body: Record<string, unknown> = { json_schema: '[1,2]' }
    reconcileConstraintParams(body)
    expect(body).not.toHaveProperty('json_schema')
  })

  // "Cannot use both json_schema and grammar" -- the explicit one wins.
  it('keeps grammar and drops json_schema when both are set', () => {
    const body: Record<string, unknown> = {
      grammar: 'root ::= "a"',
      json_schema: '{"type":"object"}',
    }
    reconcileConstraintParams(body)
    expect(body.grammar).toBe('root ::= "a"')
    expect(body).not.toHaveProperty('json_schema')
  })

  // Once the tools rule has removed the grammar there is no conflict left,
  // so the schema must survive.
  it('keeps json_schema when the grammar was dropped for tools', () => {
    const body: Record<string, unknown> = {
      grammar: 'root ::= "a"',
      json_schema: '{"type":"object"}',
      tools: TOOLS,
    }
    reconcileConstraintParams(body)
    expect(body).not.toHaveProperty('grammar')
    expect(body.json_schema).toEqual({ type: 'object' })
  })

  it('leaves a body with neither key untouched', () => {
    const body: Record<string, unknown> = { messages: [], stream: true }
    reconcileConstraintParams(body)
    expect(body).toEqual({ messages: [], stream: true })
  })
})
