import { describe, it, expect } from 'vitest'
import {
  partialJsonField,
  partialJsonStrings,
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

/// `edit` carries an array of `{old_string, new_string}`, so its arguments are
/// only readable as repeated fields.
describe('partialJsonStrings', () => {
  it('reads every occurrence in order', () => {
    const raw = '{"edits":[{"old_string":"a","new_string":"b"},{"old_string":"c"'
    expect(partialJsonStrings(raw, 'old_string')).toEqual(['a', 'c'])
    expect(partialJsonStrings(raw, 'new_string')).toEqual(['b'])
  })

  it('takes the still-open last value, and stops there', () => {
    const raw = '{"edits":[{"old_string":"a","new_string":"partial'
    expect(partialJsonStrings(raw, 'new_string')).toEqual(['partial'])
  })

  it('is empty when the field never appears', () => {
    expect(partialJsonStrings('{"path":"a"}', 'old_string')).toEqual([])
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

  /// The result is shaped like the real arguments, so a streaming call and a
  /// settled one read the same downstream.
  it('rebuilds the edit pairs, keeping the one still streaming', () => {
    const raw =
      '{"path":"a.ts","edits":[{"old_string":"one","new_string":"1"},{"old_string":"two"'
    expect(partialToolInput(raw)).toEqual({
      path: 'a.ts',
      edits: [
        { old_string: 'one', new_string: '1' },
        { old_string: 'two' },
      ],
    })
  })

  it('has no edits before the first pair opens', () => {
    expect(partialToolInput('{"path":"a.ts","edi')).toEqual({ path: 'a.ts' })
  })
})
