import { beforeEach, describe, expect, it } from 'vitest'
import { useCoworkSessions } from '../useCoworkSessions'

const seed = (title: string) =>
  useCoworkSessions.setState({
    sessions: [{ id: 's', title, folder: null, turns: [], messages: [], updated: 0 }],
    currentId: 's',
  })
const title = () => useCoworkSessions.getState().sessions[0].title

beforeEach(() => seed('New session'))

describe('setTitleIfDefault', () => {
  it('titles a session that still has the default title', () => {
    useCoworkSessions.getState().setTitleIfDefault('s', 'First prompt')
    expect(title()).toBe('First prompt')
  })

  // The first-run path captures the session, awaits skill expansion, then
  // titles it: a rename made during that await must survive.
  it('keeps a title the user set while preparation was pending', async () => {
    const pending = new Promise<void>((r) => setTimeout(r, 0))
    useCoworkSessions.getState().setTitle('s', 'My name')
    await pending
    useCoworkSessions.getState().setTitleIfDefault('s', 'First prompt')
    expect(title()).toBe('My name')
  })
})
