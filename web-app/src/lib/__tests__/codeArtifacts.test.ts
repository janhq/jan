import { describe, it, expect } from 'vitest'
import { artifactFor, isArtifactPath, artifactsFromParts } from '@/lib/codeArtifacts'

const write = (path: string, state = 'output-available') => ({
  type: 'tool-write',
  input: { path },
  state,
})

describe('isArtifactPath', () => {
  it('accepts things a user would call a deliverable', () => {
    expect(isArtifactPath('index.html')).toBe(true)
    expect(isArtifactPath('a/logo.svg')).toBe(true)
    expect(isArtifactPath('shot.PNG')).toBe(true)
    expect(isArtifactPath('report.pdf')).toBe(true)
    expect(isArtifactPath('notes.md')).toBe(true)
  })

  it('rejects the project scaffolding a run also writes', () => {
    // These are the reason the list is an allowlist: otherwise every run
    // fills it with noise. They stay visible in the diff panel (#285).
    expect(isArtifactPath('package.json')).toBe(false)
    expect(isArtifactPath('yarn.lock')).toBe(false)
    expect(isArtifactPath('.gitignore')).toBe(false)
    expect(isArtifactPath('src/main.rs')).toBe(false)
    expect(isArtifactPath('tsconfig.json')).toBe(false)
  })
})

describe('artifactFor', () => {
  it('titles from the basename without the extension', () => {
    expect(artifactFor('games/flappy-bird.html')).toEqual({
      path: 'games/flappy-bird.html',
      title: 'flappy-bird',
      group: 'Code',
      label: 'HTML',
    })
  })

  it('groups by kind and upper-cases the label', () => {
    expect(artifactFor('a.png')?.group).toBe('Image')
    expect(artifactFor('a.docx')?.group).toBe('Document')
    expect(artifactFor('a.svg')?.label).toBe('SVG')
  })

  it('keeps dots inside a filename', () => {
    expect(artifactFor('report.v2.final.pdf')?.title).toBe('report.v2.final')
  })

  it('returns null for a non-artifact', () => {
    expect(artifactFor('package.json')).toBeNull()
  })
})

describe('artifactsFromParts', () => {
  it('reads artifacts off a message own write/edit parts', () => {
    const parts = [
      { type: 'text', text: 'done' },
      write('index.html'),
      write('package.json'), // not an artifact
    ]
    expect(artifactsFromParts(parts)).toEqual([
      { path: 'index.html', title: 'index', group: 'Code', label: 'HTML' },
    ])
  })

  it('counts write-then-edit of one file as one artifact', () => {
    const parts = [write('a.html'), { type: 'tool-edit', input: { path: 'a.html' }, state: 'output-available' }]
    expect(artifactsFromParts(parts)).toHaveLength(1)
  })

  it('ignores a call that failed or never completed', () => {
    expect(artifactsFromParts([write('a.html', 'output-error')])).toEqual([])
    expect(artifactsFromParts([write('a.html', 'input-streaming')])).toEqual([])
  })

  it('ignores non-write tools and malformed input', () => {
    expect(
      artifactsFromParts([
        { type: 'tool-read', input: { path: 'a.html' }, state: 'output-available' },
        { type: 'tool-write', input: {}, state: 'output-available' },
        { type: 'tool-write', input: { path: 42 }, state: 'output-available' },
      ])
    ).toEqual([])
  })

  it('is empty for no parts', () => {
    expect(artifactsFromParts(undefined)).toEqual([])
    expect(artifactsFromParts([])).toEqual([])
  })

  it('preserves first-seen order', () => {
    const got = artifactsFromParts([write('b.md'), write('a.html')])
    expect(got.map((a) => a.path)).toEqual(['b.md', 'a.html'])
  })
})
