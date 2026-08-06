import { describe, it, expect } from 'vitest'
import {
  artifactFor,
  bashArtifactPaths,
  isArtifactPath,
  artifactsFromParts,
  artifactsFromTurns,
} from '@/lib/codeArtifacts'
import type { CodeTurn } from '@/hooks/useCodeSessions'

const write = (path: string, state = 'output-available', output = `Created ${path} (10 bytes)`) => ({
  type: 'tool-write',
  input: { path },
  state,
  output,
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
    expect(artifactFor('clip.mp4')?.group).toBe('Video')
    expect(artifactFor('track.mp3')?.group).toBe('Audio')
    expect(artifactFor('track.flac')?.label).toBe('FLAC')
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

  it('ignores edit entirely — it only ever touches an existing file', () => {
    const parts = [
      write('a.html'),
      { type: 'tool-edit', input: { path: 'b.html' }, state: 'output-available', output: 'ok' },
    ]
    expect(artifactsFromParts(parts).map((a) => a.path)).toEqual(['a.html'])
  })

  it('ignores a write that overwrote an existing file', () => {
    // The codebase case: rewriting README.md or an icon is not a deliverable.
    expect(
      artifactsFromParts([write('README.md', 'output-available', 'Overwrote README.md (20 bytes)')])
    ).toEqual([])
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

describe('artifactsFromTurns', () => {
  const toolTurn = (name: string, path: string, extra: Partial<CodeTurn> = {}) =>
    ({
      role: 'tool',
      content: '',
      name,
      args: { path },
      status: 'done',
      result: `Created ${path} (10 bytes)`,
      ...extra,
    }) as CodeTurn

  it('reads write/edit artifacts straight off session turns', () => {
    const turns = [
      { role: 'user', content: 'go' },
      toolTurn('write', 'index.html'),
      toolTurn('write', 'package.json'),
      toolTurn('read', 'index.html'),
    ] as CodeTurn[]
    expect(artifactsFromTurns(turns).map((a) => a.path)).toEqual(['index.html'])
  })

  it('counts a file created then rewritten once', () => {
    // Regression: the library showed one card per rewrite.
    const turns = [
      toolTurn('write', 'a.html'),
      toolTurn('edit', 'a.html'),
      toolTurn('write', 'a.html', { result: 'Overwrote a.html (12 bytes)' }),
    ]
    expect(artifactsFromTurns(turns)).toHaveLength(1)
  })

  it('excludes files it only modified — the real-codebase case', () => {
    // A repo of thousands of files: editing docs and assets must not flood
    // the library just because .md/.svg are on the allowlist.
    const turns = [
      toolTurn('write', 'README.md', { result: 'Overwrote README.md (99 bytes)' }),
      toolTurn('edit', 'docs/guide.md'),
      toolTurn('write', 'assets/icon.svg', { result: 'Overwrote assets/icon.svg (30 bytes)' }),
      toolTurn('write', 'report.html'), // genuinely new
    ]
    expect(artifactsFromTurns(turns).map((a) => a.path)).toEqual(['report.html'])
  })

  it('treats the legacy "Wrote N bytes" result as a creation', () => {
    // Pre-existing sessions have no create/modify distinction; dropping them
    // would silently empty an existing library.
    expect(
      artifactsFromTurns([
        toolTurn('write', 'a.html', { result: 'Wrote 8000 bytes to /p/a.html' }),
      ])
    ).toHaveLength(1)
  })

  it('ignores errored and still-running calls', () => {
    expect(artifactsFromTurns([toolTurn('write', 'a.html', { isError: true })])).toEqual([])
    expect(artifactsFromTurns([toolTurn('write', 'a.html', { status: 'running' })])).toEqual([])
  })

  it('is empty for no turns', () => {
    expect(artifactsFromTurns(undefined)).toEqual([])
    expect(artifactsFromTurns([])).toEqual([])
  })

  it('recovers an mp4 a bash download produced (quoted spaces in the name)', () => {
    const turns = [
      {
        role: 'tool',
        content: '',
        name: 'bash',
        args: {
          command:
            'cd /Users/thinhlpg/Desktop && yt-dlp -f "bv*+ba/b" -o "%(title)s.%(ext)s" "https://youtu.be/x" 2>&1 | tail -30',
        },
        status: 'done',
        isError: false,
        result:
          '[download] Destination: /Users/thinhlpg/Desktop/Rick Astley - Never Gonna Give You Up.mp4\n[download] 100% of 11MiB',
      } as CodeTurn,
    ]
    const artifacts = artifactsFromTurns(turns, '/Users/thinhlpg/Desktop')
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]!.group).toBe('Video')
    expect(artifacts[0]!.title).toContain('Rick Astley')
  })

  it('recovers a relative mp4 from ls -lh in the bash result', () => {
    const turns = [
      {
        role: 'tool',
        content: '',
        name: 'bash',
        args: { command: 'cd /p && python3 make.py && ls -lh cat_video.mp4' },
        status: 'done',
        isError: false,
        result: '-rw-r--r--@ 1 u staff 144K Aug 6 11:50 cat_video.mp4',
      } as CodeTurn,
    ]
    const artifacts = artifactsFromTurns(turns, '/p')
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]!.path).toBe('/p/cat_video.mp4')
  })

  it('tracks a file across an absolute mv target', () => {
    const turns = [
      {
        role: 'tool',
        content: '',
        name: 'bash',
        args: { command: 'cd /p/src && mv cat_video.mp4 /p/cat_video.mp4 && ls -lh /p/cat_video.mp4' },
        status: 'done',
        isError: false,
        result: '-rw-r--r--@ 1 u staff 144K Aug 6 11:50 /p/cat_video.mp4',
      } as CodeTurn,
    ]
    const artifacts = artifactsFromTurns(turns, '/p')
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]!.path).toBe('/p/cat_video.mp4')
  })

  it('ignores probes and globs that list no real file', () => {
    const turns = [
      {
        role: 'tool',
        content: '',
        name: 'bash',
        args: { command: 'which yt-dlp ffmpeg; ls *.mp4' },
        status: 'done',
        isError: false,
        result: '/opt/homebrew/bin/yt-dlp\n/opt/homebrew/bin/ffmpeg',
      } as CodeTurn,
    ]
    expect(artifactsFromTurns(turns, '/p')).toEqual([])
  })

  it('ignores errored bash calls', () => {
    const turns = [
      {
        role: 'tool',
        content: '',
        name: 'bash',
        args: { command: 'python3 make.py 2>&1 && ls -lh out.mp4' },
        status: 'done',
        isError: true,
        result: "can't open file 'make.py': No such file",
      } as CodeTurn,
    ]
    expect(artifactsFromTurns(turns, '/p')).toEqual([])
  })
})
