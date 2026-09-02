import { describe, it, expect } from 'vitest'
import {
  partialJsonField,
  partialToolInput,
  unescapePartialJsonString,
} from '../partialJson'

/// Mirrors `partial_json_field_reads_a_truncated_value` in the TUI: the two
/// readers see the same fragments, so they are held to the same cases.
describe('partialJsonField', () => {
  it('reads a closed value', () => {
    const done = '{"path":"a.html","content":"<h1>hi</h1>"}'
    expect(partialJsonField(done, 'path')).toBe('a.html')
    expect(partialJsonField(done, 'content')).toBe('<h1>hi</h1>')
  })

  it('takes everything that arrived when the value is cut', () => {
    const cut = '{"path":"a.html","content":"<!doctype html>\\n<html'
    expect(partialJsonField(cut, 'content')).toBe('<!doctype html>\\n<html')
  })

  it('reports nothing before the field opens', () => {
    expect(partialJsonField('{"path":"a.htm', 'content')).toBeUndefined()
  })

  it('does not end the value on an escaped quote', () => {
    expect(partialJsonField('{"content":"say \\"hi\\" now', 'content')).toBe(
      'say \\"hi\\" now'
    )
  })

  /// The field name can occur inside an earlier value, which is why this scans
  /// for `"name":` and a quote rather than for the name alone.
  it('skips the name occurring inside an earlier value', () => {
    const decoy = '{"path":"my\\"content\\".txt","content":"real'
    expect(partialJsonField(decoy, 'content')).toBe('real')
  })
})

describe('unescapePartialJsonString', () => {
  it('survives a cut escape', () => {
    expect(unescapePartialJsonString('a\\nb')).toBe('a\nb')
    // Dangling backslash: the escape's payload has not arrived.
    expect(unescapePartialJsonString('a\\nb\\')).toBe('a\nb')
    // An even run is a real escaped backslash, so it stays.
    expect(unescapePartialJsonString('a\\\\')).toBe('a\\')
    // Partial \u escape.
    expect(unescapePartialJsonString('hi \\u26')).toBe('hi ')
    expect(unescapePartialJsonString('hi ☃')).toBe('hi ☃')
  })
})

describe('partialToolInput', () => {
  it('reads the arguments a card is built from, mid-stream', () => {
    const raw = '{"path":"game.html","content":"<!doctype html>\\n<htm'
    expect(partialToolInput(raw)).toEqual({
      path: 'game.html',
      content: '<!doctype html>\n<htm',
    })
  })

  /// A count or an id arrives whole or not at all, so half of one would be a
  /// lie rather than a preview.
  it('reads only string arguments', () => {
    expect(partialToolInput('{"query":"rust","count":1')).toEqual({
      query: 'rust',
    })
  })

  it('is empty before anything has arrived', () => {
    expect(partialToolInput('{"pa')).toEqual({})
  })
})
