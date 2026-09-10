import { describe, expect, it } from 'vitest'
import { sessionAttachments } from '@/lib/coworkFiles'
import type { CoworkTurn } from '@/types/coworkSession'

describe('sessionAttachments', () => {
  it('collects documents off user turns, skipping everything else', () => {
    const turns: CoworkTurn[] = [
      { role: 'user', content: 'a', files: [{ name: 'a.pdf', path: '/a.pdf' }] },
      { role: 'assistant', content: 'ok' },
      { role: 'tool', content: '', name: 'write', args: { path: 'x.md' } },
      { role: 'user', content: 'b', files: [{ name: 'b.csv', path: '/b.csv' }] },
      { role: 'user', content: 'c' },
    ]
    expect(sessionAttachments(turns).map((f) => f.name)).toEqual(['a.pdf', 'b.csv'])
  })

  it('keeps one entry per source path, preferring the later record', () => {
    const turns: CoworkTurn[] = [
      { role: 'user', content: 'a', files: [{ name: 'a.pdf', path: '/a.pdf' }] },
      {
        role: 'user',
        content: 'again',
        files: [{ name: 'a.pdf', path: '/a.pdf', workspacePath: '/ws/attachments/a.pdf' }],
      },
    ]
    expect(sessionAttachments(turns)).toEqual([
      { name: 'a.pdf', path: '/a.pdf', workspacePath: '/ws/attachments/a.pdf' },
    ])
  })

  it('is empty with no turns', () => {
    expect(sessionAttachments(undefined)).toEqual([])
    expect(sessionAttachments([])).toEqual([])
  })
})
