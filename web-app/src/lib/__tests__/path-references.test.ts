import { describe, expect, it, vi } from 'vitest'
import {
  parsePromptForReferences,
  stripPromptReferences,
} from '../path-references'

vi.mock('@janhq/core', () => ({
  fs: {},
}))

describe('parsePromptForReferences', () => {
  it('does not treat ssh/email addresses as references', () => {
    expect(
      parsePromptForReferences('please use bash to ssh username@44.50.0.89')
    ).toEqual([])
    expect(
      parsePromptForReferences('please use bash to ssh alandao@44.50.0.89')
    ).toEqual([])
    expect(parsePromptForReferences('mail me at foo@bar.com please')).toEqual(
      []
    )
  })

  it('does not treat bare IPv4 as a reference, even with a trailing period', () => {
    expect(parsePromptForReferences('use bash to ssh @44.50.0.89 now')).toEqual(
      []
    )
    expect(parsePromptForReferences('please ping @44.50.0.89.')).toEqual([])
  })

  it('parses references and keeps the rest of the query', () => {
    expect(
      parsePromptForReferences('use @README.md to check the build steps')
    ).toEqual(['README.md'])
    expect(parsePromptForReferences('diff @my-file.txt against main')).toEqual(
      ['my-file.txt']
    )
    expect(
      parsePromptForReferences('open @src/main.ts and (@README.md)')
    ).toEqual(['src/main.ts', 'README.md'])
  })
})

describe('stripPromptReferences', () => {
  it('strips references but keeps ssh/email addresses', () => {
    expect(
      stripPromptReferences('see @src/main.ts and ssh user@44.50.0.89')
    ).toBe('see and ssh user@44.50.0.89')
  })

  it('keeps non-reference text intact', () => {
    expect(stripPromptReferences('no refs here')).toBe('no refs here')
    expect(stripPromptReferences('ssh username@44.50.0.89')).toBe(
      'ssh username@44.50.0.89'
    )
  })
})
