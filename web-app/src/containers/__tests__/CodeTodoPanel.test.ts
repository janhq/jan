import { describe, it, expect } from 'vitest'
import { cleanTaskLabel } from '@/containers/CodeTodoPanel'

describe('cleanTaskLabel', () => {
  it('strips a model-written status marker so it does not double up with the row icon', () => {
    expect(cleanTaskLabel('✅ Launch 3 parallel subagents')).toBe(
      'Launch 3 parallel subagents'
    )
    expect(cleanTaskLabel('☐ Collect all 3 reports')).toBe('Collect all 3 reports')
    expect(cleanTaskLabel('[x] Run validation script')).toBe('Run validation script')
    expect(cleanTaskLabel('[ ] Run validation script')).toBe('Run validation script')
    expect(cleanTaskLabel('- Open the final file')).toBe('Open the final file')
    expect(cleanTaskLabel('• Open the final file')).toBe('Open the final file')
  })

  it('only strips one leading marker, never mid-label content', () => {
    expect(cleanTaskLabel('Visual QA via PDF→images')).toBe('Visual QA via PDF→images')
    // A marker that is part of the sentence stays put.
    expect(cleanTaskLabel('Check the ✅ column renders')).toBe('Check the ✅ column renders')
    // Nested markers: only the outermost one goes.
    expect(cleanTaskLabel('- [x] Ship it')).toBe('[x] Ship it')
  })

  it('never returns an empty label', () => {
    // A label that is nothing but a marker would otherwise render as a blank
    // row, which reads as a rendering bug rather than a bare task.
    expect(cleanTaskLabel('✅')).toBe('✅')
    expect(cleanTaskLabel('  ')).toBe('')
  })

  it('leaves an ordinary label untouched', () => {
    expect(cleanTaskLabel('Write pptxgenjs script for 5-slide deck')).toBe(
      'Write pptxgenjs script for 5-slide deck'
    )
  })
})
