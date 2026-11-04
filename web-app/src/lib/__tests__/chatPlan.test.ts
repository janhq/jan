import { describe, expect, it } from 'vitest'
import { chatPlanToolRefusal } from '../chatPlan'

describe('unified Plan capability boundary', () => {
  it.each(['write', 'edit', 'shell', 'skill_write', 'task', 'monitor', 'unknown'])('refuses %s even when hallucinated', (name) => {
    expect(chatPlanToolRefusal(true, name)).toContain('read-only')
  })
  it.each(['read', 'ls', 'find', 'grep', 'skill_list', 'skill_read', 'web_search', 'web_fetch', 'todo', 'ask'])('permits read/planning tool %s', (name) => {
    expect(chatPlanToolRefusal(true, name)).toBeUndefined()
  })
  it.each(['retrieve', 'list_attachments', 'get_chunks'])('permits only trusted native RAG %s', (name) => {
    expect(chatPlanToolRefusal(true, name, {}, false, true)).toBeUndefined()
    expect(chatPlanToolRefusal(true, name)).toContain('read-only')
    expect(chatPlanToolRefusal(true, name, {}, true, true)).toContain('read-only')
  })
  it('never trusts an MCP tool merely because its name sounds read-only', () => {
    expect(chatPlanToolRefusal(true, 'read', {}, true)).toContain('read-only')
  })
  it.each(['write', 'append', 'delete', 'clear', undefined])('rejects memory mutation/malformed op %s', (op) => {
    expect(chatPlanToolRefusal(true, 'memory', { op })).toBeTruthy()
  })
  it.each(['view', 'search'])('permits memory %s', (op) => {
    expect(chatPlanToolRefusal(true, 'memory', { op })).toBeUndefined()
  })
  it('does not change normal-mode permissions', () => {
    expect(chatPlanToolRefusal(false, 'shell')).toBeUndefined()
    expect(chatPlanToolRefusal(false, 'read', {}, true)).toBeUndefined()
  })
})
