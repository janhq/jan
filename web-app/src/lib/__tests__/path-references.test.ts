import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fs } from '@janhq/core'
import {
  expandPromptReferences,
  parsePromptForReferences,
  stripPromptReferences,
} from '../path-references'

vi.mock('@janhq/core', () => ({
  fs: {
    fileStat: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  },
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
  it('strips resolved references but keeps ssh/email addresses', () => {
    expect(
      stripPromptReferences(
        'see @src/main.ts and ssh user@44.50.0.89',
        new Set(['src/main.ts'])
      )
    ).toBe('see and ssh user@44.50.0.89')
  })

  it('leaves the text untouched when nothing resolved', () => {
    const text = 'line one\n\n  indented   @property\nline  two'
    expect(stripPromptReferences(text, new Set())).toBe(text)
  })

  it('keeps unresolved tokens and the whitespace around them', () => {
    expect(
      stripPromptReferences(
        'read @a.ts\n\n@dataclass\nclass A:\n    x: int',
        new Set(['a.ts'])
      )
    ).toBe('read\n\n@dataclass\nclass A:\n    x: int')
  })

  it('keeps leading indentation and trailing blank lines of the prompt', () => {
    expect(
      stripPromptReferences(
        '    def f(): ...\n\nlook at @a.ts\n\n',
        new Set(['a.ts'])
      )
    ).toBe('    def f(): ...\n\nlook at\n\n')
  })
})

// A pasted snippet whose decorators look like `@path` references.
const PYTHON = [
  'Why does this fail?',
  '',
  '@dataclass',
  'class A:',
  '    x: int',
  '',
  '@app.route("/x")',
  'def f(): ...',
  '',
  '@property',
  'def p(self): ...',
].join('\n')

describe('expandPromptReferences', () => {
  const stat = vi.mocked(fs.fileStat)
  const read = vi.mocked(fs.readFileSync)

  beforeEach(() => {
    vi.resetAllMocks()
    // Only these paths exist in the working directory.
    const files: Record<string, { size: number; body: string }> = {
      '/work/notes.md': { size: 5, body: 'hello' },
      '/work/huge.log': { size: 5 * 1024 * 1024, body: '' },
    }
    stat.mockImplementation(async (p: string) => {
      const f = files[p]
      if (!f) throw new Error('ENOENT')
      return { isDirectory: false, size: f.size } as never
    })
    read.mockImplementation(async (p: string) => files[p]?.body as never)
  })

  it('sends pasted code with decorators exactly as typed', async () => {
    const out = await expandPromptReferences(PYTHON, '/work')
    expect(out).toEqual({ text: PYTHON, resolvedContents: '' })
  })

  it('expands a real file and leaves decorators in the same prompt alone', async () => {
    const out = await expandPromptReferences(
      `summarise @notes.md\n\n${PYTHON}`,
      '/work'
    )
    expect(out.text).toBe(`summarise\n\n${PYTHON}`)
    expect(out.resolvedContents).toContain('hello')
    expect(out.resolvedContents).not.toContain('not found')
  })

  it('still tells the user when a referenced file is too large', async () => {
    const out = await expandPromptReferences('check @huge.log please', '/work')
    expect(out.text).toBe('check please')
    expect(out.resolvedContents).toBe('[File too large to include: huge.log]')
  })
})
