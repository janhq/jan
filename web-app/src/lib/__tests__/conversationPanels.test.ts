import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  availableConversationPanels,
  conversationDiffs,
  conversationTasks,
  isPermittedPath,
  projectConversationPanels,
  threadRuntimeDiffs,
} from '../conversationPanels'

const msg = (parts: unknown[]): UIMessage =>
  ({ id: 'a', role: 'assistant', parts }) as UIMessage
const tool = (name: string, output: unknown, input: unknown = {}, state = 'output-available') => ({
  type: `tool-${name}`, toolCallId: `${name}-1`, state, input, output,
})
const todo = { phases: [{ name: 'P', tasks: [{ content: 'a', status: 'pending' }] }] }
const write = (path: string) =>
  tool('write', `@@ created file @@\n+    1 | hi\nCreated ${path} (2 bytes)`, { path })

describe('conversation panel projection', () => {
  it('has no controls for plain chat', () => {
    const c = projectConversationPanels([msg([{ type: 'text', text: 'hi' }])], { scratch: '/r', folder: null })
    expect(Object.values(availableConversationPanels(c))).toEqual([false, false, false, false])
  })
  it('reloaded canonical todo result (string or object) yields todos', () => {
    for (const output of [JSON.stringify(todo), todo]) {
      const c = projectConversationPanels([msg([tool('todo', output)])], { scratch: null, folder: null })
      expect(availableConversationPanels(c).todos).toBe(true)
    }
    const pending = projectConversationPanels([msg([tool('todo', todo, {}, 'input-available')])], { scratch: null, folder: null })
    expect(availableConversationPanels(pending).todos).toBe(false)
  })
  it('tasks require a parsable canonical result', () => {
    expect(conversationTasks([msg([tool('task', 'Dispatched 2 subagents')])])).toEqual([])
    expect(conversationTasks([msg([tool('task', '{"subagents":[{"runId":"r"}]}')])])).toEqual([])
    const ok = { subagents: [{ runId: 'r', name: 'n', status: 'done', startedAt: 1, endedAt: 2, finalOutput: 'x' }] }
    expect(conversationTasks([msg([tool('task', JSON.stringify(ok))])])).toHaveLength(1)
  })
  describe('data-task-status carrier', () => {
    const status = (rows: unknown[], id = 'task-status:r') => ({ type: 'data-task-status', id, data: { subagents: rows } })
    const row = (o: Record<string, unknown> = {}) => ({ runId: 'r', name: 'n', status: 'done', startedAt: 1, endedAt: 2, ...o })
    it('reads done rows (with and without output) from persisted parts', () => {
      expect(conversationTasks([msg([status([row({ finalOutput: 'x' })])])])).toEqual([
        { runId: 'r', name: 'n', status: 'done', startedAt: 1, endedAt: 2, turns: [], finalOutput: 'x' },
      ])
      expect(conversationTasks([msg([status([row()])])])[0]).not.toHaveProperty('finalOutput')
    })
    it('reads running rows without endedAt and makes the panel available', () => {
      const tasks = conversationTasks([msg([status([row({ status: 'running', endedAt: undefined })])])])
      expect(tasks).toEqual([{ runId: 'r', name: 'n', status: 'running', startedAt: 1, turns: [] }])
      expect(availableConversationPanels(projectConversationPanels([msg([status([row({ status: 'running', endedAt: undefined })])])], { scratch: null, folder: null })).tasks).toBe(true)
    })
    it('error rows settle as finished runs that state the failure', () => {
      const [run] = conversationTasks([msg([status([row({ status: 'error', error: 'boom' })])])])
      expect(run).toMatchObject({ status: 'done', finalOutput: 'Error: boom' })
      const [bare] = conversationTasks([msg([status([row({ status: 'error' })])])])
      expect(bare.finalOutput).toBe('Error: task failed')
    })
    it('a later row replaces an earlier one; a stale running row never reopens a done run', () => {
      const running = row({ status: 'running', endedAt: undefined })
      expect(conversationTasks([msg([status([running])]), msg([status([row()])])])[0].status).toBe('done')
      expect(conversationTasks([msg([status([row()])]), msg([status([running])])])[0].status).toBe('done')
    })
    it('rejects malformed rows and unknown statuses without dropping valid siblings', () => {
      const bad = [
        null, 'x', {}, row({ runId: '' }), row({ name: 5 }), row({ status: 'queued' }),
        row({ startedAt: 'a' }), row({ startedAt: NaN }), row({ endedAt: undefined }),
        row({ status: 'error', endedAt: undefined }), row({ finalOutput: 3 }), row({ error: 3, status: 'error' }),
      ]
      expect(conversationTasks([msg([status(bad)])])).toEqual([])
      expect(conversationTasks([msg([status([...bad, row({ runId: 'ok' })])])]).map((t) => t.runId)).toEqual(['ok'])
      expect(conversationTasks([msg([{ type: 'data-task-status', id: 'x', data: {} }, { type: 'data-task-status', id: 'y' }, status('nope' as never)])])).toEqual([])
    })
    it('ignores user-role messages, and tool results still accept only done rows', () => {
      expect(conversationTasks([{ id: 'u', role: 'user', parts: [status([row()])] } as UIMessage])).toEqual([])
      const running = { subagents: [row({ status: 'running' })] }
      expect(conversationTasks([msg([tool('task', JSON.stringify(running))])])).toEqual([])
    })
    it('mixes a status part and a tool result for different runs in message order', () => {
      const t = { subagents: [row({ runId: 'a' })] }
      const ids = conversationTasks([msg([tool('task', JSON.stringify(t)), status([row({ runId: 'b' })])])]).map((x) => x.runId)
      expect(ids).toEqual(['a', 'b'])
    })
  })
  it('diffs are read-only projections and respect permitted roots', () => {
    const m = [msg([write('/r/a.html'), write('/elsewhere/b.html'), tool('edit', 'no diff', { path: 'c.txt' })])]
    expect(conversationDiffs(m).map((f) => f.path)).toEqual(['/r/a.html', '/elsewhere/b.html'])
    const c = projectConversationPanels(m, { scratch: '/r', folder: null })
    expect(c.diffs.map((f) => f.path)).toEqual(['/r/a.html'])
    expect(c.artifacts.map((a) => a.path)).toEqual(['/r/a.html'])
    expect(projectConversationPanels(m, { scratch: null, folder: null }).diffs).toEqual([])
  })
  it('threadRuntimeDiffs keeps only calls owned by the thread, even for a repeated call ID', () => {
    const diffs = { dup: 'other-diff', mine: 'my-diff', orphan: 'no-timing', gone: 'no-owner' }
    const timings = { dup: { owner: 'other' }, mine: { owner: 't1' }, gone: {} }
    expect(threadRuntimeDiffs(diffs, timings, 't1')).toEqual({ mine: 'my-diff' })
    // The same ID owned by t2 is invisible to t1 and visible to t2.
    expect(threadRuntimeDiffs({ dup: 'd' }, { dup: { owner: 't2' } }, 't1')).toEqual({})
    expect(threadRuntimeDiffs({ dup: 'd' }, { dup: { owner: 't2' } }, 't2')).toEqual({ dup: 'd' })
  })
  it('a runtime diff of another owner never reaches the projection', () => {
    const m = [msg([tool('write', 'Created /r/a.html (2 bytes)', { path: '/r/a.html' })])]
    const roots = { scratch: '/r', folder: null }
    const foreign = threadRuntimeDiffs({ 'write-1': '@@\n+ x' }, { 'write-1': { owner: 'other' } }, 't1')
    expect(projectConversationPanels(m, roots, foreign).diffs).toEqual([])
    const own = threadRuntimeDiffs({ 'write-1': '@@\n+ x' }, { 'write-1': { owner: 't1' } }, 't1')
    expect(projectConversationPanels(m, roots, own).diffs.map((f) => f.path)).toEqual(['/r/a.html'])
  })
  it('rejects traversal out of roots', () => {
    expect(isPermittedPath({ scratch: '/r', folder: null }, '/r/../x/a.html')).toBe(false)
    expect(isPermittedPath({ scratch: '/r', folder: null }, 'sub/a.html')).toBe(true)
  })
})
