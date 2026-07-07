import { describe, it, expect } from 'vitest'
import {
  sanitizeInvalidJsonEscapes,
  repairToolArgs,
} from '../toolCallRepair'

describe('sanitizeInvalidJsonEscapes', () => {
  it('re-escapes a Windows drive path with all-literal backslashes', () => {
    const raw = '{"path":"C:\\Users\\name\\file.txt"}'
    expect(JSON.parse(sanitizeInvalidJsonEscapes(raw))).toEqual({
      path: 'C:\\Users\\name\\file.txt',
    })
  })

  it('handles Program Files and Windows system folders', () => {
    const raw = '{"path":"C:\\Program Files\\Windows\\notepad.exe"}'
    expect(JSON.parse(sanitizeInvalidJsonEscapes(raw))).toEqual({
      path: 'C:\\Program Files\\Windows\\notepad.exe',
    })
  })

  it('re-escapes segments starting with JSON escape letters', () => {
    const raw = '{"path":"C:\\temp\\new\\report.txt"}'
    expect(JSON.parse(sanitizeInvalidJsonEscapes(raw))).toEqual({
      path: 'C:\\temp\\new\\report.txt',
    })
  })

  it('preserves genuine unicode escapes', () => {
    const raw = '{"path":"C:\\u0041\\dir"}'
    expect(JSON.parse(sanitizeInvalidJsonEscapes(raw))).toEqual({
      path: 'C:A\\dir',
    })
  })

  it('treats \\u not followed by hex as a literal backslash', () => {
    const raw = '{"path":"C:\\users\\bob"}'
    expect(JSON.parse(sanitizeInvalidJsonEscapes(raw))).toEqual({
      path: 'C:\\users\\bob',
    })
  })

  it('handles a trailing directory-separator backslash', () => {
    const raw = '{"path":"C:\\Users\\"}'
    expect(JSON.parse(sanitizeInvalidJsonEscapes(raw))).toEqual({
      path: 'C:\\Users\\',
    })
  })

  it('handles UNC paths (leading double backslash)', () => {
    const raw = '{"path":"\\\\server\\share\\file"}'
    expect(JSON.parse(sanitizeInvalidJsonEscapes(raw))).toEqual({
      path: '\\\\server\\share\\file',
    })
  })

  it('leaves content outside string literals untouched', () => {
    const raw = '{"n":42,"ok":true}'
    expect(sanitizeInvalidJsonEscapes(raw)).toBe(raw)
  })
})

describe('repairToolArgs', () => {
  it('parses a broken Windows path', () => {
    expect(repairToolArgs('{"path":"D:\\repos\\jan\\file"}')).toEqual({
      path: 'D:\\repos\\jan\\file',
    })
  })

  it('returns valid JSON untouched, preserving intended escapes', () => {
    const raw = '{"text":"line1\\nline2\\ttab","q":"say \\"hi\\""}'
    expect(repairToolArgs(raw)).toEqual({
      text: 'line1\nline2\ttab',
      q: 'say "hi"',
    })
  })

  it('parses plain valid JSON', () => {
    expect(repairToolArgs('{"n":42}')).toEqual({ n: 42 })
  })

  it('returns null when unrepairable', () => {
    expect(repairToolArgs('{not json at all')).toBeNull()
  })

  it('returns null for non-object JSON', () => {
    expect(repairToolArgs('"just a string"')).toBeNull()
  })

  it('returns null for array JSON', () => {
    expect(repairToolArgs('[1,2,3]')).toBeNull()
  })
})
