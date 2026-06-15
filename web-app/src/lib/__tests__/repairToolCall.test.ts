import { describe, it, expect } from 'vitest'
import { repairToolCallArguments } from '../repairToolCall'

describe('repairToolCallArguments', () => {
  it('returns null for already-valid JSON (nothing to repair)', () => {
    expect(
      repairToolCallArguments('{"path":"a.py","content":"print(1)"}')
    ).toBeNull()
  })

  it('returns null for empty / blank input', () => {
    expect(repairToolCallArguments('')).toBeNull()
    expect(repairToolCallArguments('   ')).toBeNull()
  })

  it('repairs a truncated write_file payload (unterminated string)', () => {
    // Reproduces the reported Qwen3-Coder bug: properly-escaped interior quotes
    // but the generation was cut off mid-string with no closing quote/brace.
    const broken = String.raw`{"content":"bl_info = {\n \"name\": \"Plane Builder\",\n}\n\nimport bpy\n\nclass X:\n def execute(self, context):\n scene = context.scene\n unit_settings = scene.unit_settings\n .`

    const repaired = repairToolCallArguments(broken)
    expect(repaired).not.toBeNull()

    const parsed = JSON.parse(repaired as string)
    expect(typeof parsed.content).toBe('string')
    // Content is preserved up to the truncation point.
    expect(parsed.content).toContain('bl_info')
    expect(parsed.content).toContain('scene.unit_settings')
  })

  it('repairs unescaped literal newlines inside a string value', () => {
    const broken = '{"content":"line1\nline2\ndef execute(self):\n    pass'

    const repaired = repairToolCallArguments(broken)
    expect(repaired).not.toBeNull()

    const parsed = JSON.parse(repaired as string)
    expect(parsed.content).toContain('line1')
    expect(parsed.content).toContain('def execute')
  })

  it('repairs trailing commas and missing closing brace', () => {
    const broken = '{"path":"a.py","content":"x = 1",'

    const repaired = repairToolCallArguments(broken)
    expect(repaired).not.toBeNull()

    const parsed = JSON.parse(repaired as string)
    expect(parsed.path).toBe('a.py')
    expect(parsed.content).toBe('x = 1')
  })

  it('returns null when input is not recoverable JSON at all', () => {
    expect(repairToolCallArguments('this is not json and cannot be fixed')).toBeNull()
  })
})
