import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { startCoworkConversation } from '../startCoworkConversation'
import { peekCoworkHandoff } from '../coworkHandoff'

beforeEach(() => { useCoworkSessions.setState({ sessions: [], currentId: null }); sessionStorage.clear() })

describe('submitted Cowork conversation', () => {
  it('does not reuse a refused first session or leak its folder/project/model', () => {
    const store = useCoworkSessions.getState()
    const refused = store.createSession()
    store.setFolder(refused, '/old/private')
    store.setModel(refused, { id: 'no-tools', provider: 'old' })
    useCoworkSessions.setState((s) => ({ sessions: s.sessions.map((x) => ({ ...x, project: { id: 'old', name: 'Old', updated_at: 1 } })) }))
    const id = startCoworkConversation({ model: { id: 'new-model', provider: 'new' }, folder: null, project: undefined, handoff: { text: 'new task' } })
    expect(id).not.toBe(refused)
    const session = useCoworkSessions.getState().sessions.find((x) => x.id === id)!
    expect(session.folder).toBeNull()
    expect(session.project).toBeUndefined()
    expect(session.model).toEqual({ id: 'new-model', provider: 'new' })
    expect(peekCoworkHandoff(id)?.text).toBe('new task')
  })
  it('rolls back a failed handoff and lets the composer preserve its input', () => {
    const previous = useCoworkSessions.getState().createSession()
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => startCoworkConversation({ model: undefined, folder: null, project: undefined, handoff: { text: 'keep me' } })).toThrow('quota')
    spy.mockRestore()
    expect(useCoworkSessions.getState().currentId).toBe(previous)
    expect(useCoworkSessions.getState().sessions).toHaveLength(1)
  })
})
