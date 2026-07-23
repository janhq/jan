import { describe, expect, it } from 'vitest'
import { collectCodeFileDiffs } from '@/lib/codeDiffs'
import type { CodeTurn, SubagentRun } from '@/hooks/useCodeSessions'

const edit = (
  path: unknown,
  diff: string,
  extra: Partial<CodeTurn> = {}
): CodeTurn => ({
  role: 'tool',
  content: '',
  name: 'edit',
  args: { path },
  diff,
  status: 'done',
  ...extra,
})

describe('collectCodeFileDiffs', () => {
  it('groups repeated main-agent operations by path and preserves first-seen file order', () => {
    const files = collectCodeFileDiffs(
      [
        edit('src/a.ts', '-    1 | old\n+    1 | new'),
        edit('src/b.ts', '+    1 | b'),
        edit('src/a.ts', '@@ edit 1/1 @@\n+    2 | next'),
      ],
      []
    )

    expect(files.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(files[0]).toMatchObject({
      path: 'src/a.ts',
      additions: 2,
      deletions: 1,
    })
    expect(files[0].operations).toEqual([
      { diff: '-    1 | old\n+    1 | new', source: 'main' },
      { diff: '@@ edit 1/1 @@\n+    2 | next', source: 'main' },
    ])
  })

  it('keeps main trace first, then subagents in current run order', () => {
    const subagents = [
      {
        runId: 'r1',
        name: 'TestsScout',
        status: 'done',
        startedAt: 1,
        endedAt: 2,
        turns: [edit('src/a.ts', '+    3 | scout')],
      },
      {
        runId: 'r2',
        name: 'DocsScout',
        status: 'done',
        startedAt: 3,
        endedAt: 4,
        turns: [edit('src/a.ts', '-    4 | docs')],
      },
    ] satisfies SubagentRun[]

    expect(
      collectCodeFileDiffs(
        [edit('src/a.ts', '+    1 | main')],
        subagents
      )[0].operations
    ).toEqual([
      { diff: '+    1 | main', source: 'main' },
      { diff: '+    3 | scout', source: 'subagent', sourceName: 'TestsScout' },
      { diff: '-    4 | docs', source: 'subagent', sourceName: 'DocsScout' },
    ])
  })

  it('ignores failed, running, malformed, pathless, and empty-diff turns', () => {
    expect(
      collectCodeFileDiffs(
        [
          edit('src/a.ts', '+    1 | ignored', { isError: true }),
          edit('src/a.ts', '+    1 | ignored', { status: 'running' }),
          edit('src/a.ts', ''),
          edit(42, '+    1 | ignored'),
          edit('', '+    1 | ignored'),
          {
            role: 'tool',
            content: '',
            name: 'edit',
            args: 'bad',
            diff: '+    1 | ignored',
            status: 'done',
          },
        ],
        []
      )
    ).toEqual([])
  })

  it('counts only focused diff lines that start with plus-space or minus-space', () => {
    expect(
      collectCodeFileDiffs(
        [
          edit(
            'src/a.ts',
            '+++ b/src/a.ts\n+    1 | focused\n+not focused\n-    2 | removed\n--- a/src/a.ts\n-not focused'
          ),
        ],
        []
      )[0]
    ).toMatchObject({ additions: 1, deletions: 1 })
  })
})
