import { beforeEach, describe, expect, it, vi } from 'vitest'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastError } }))
vi.mock('@/i18n/react-i18next-compat', () => ({
  i18n: { t: (key: string) => key },
}))

import { startCoworkFromDraft } from '../startCoworkFromDraft'
import { peekCoworkHandoff, clearCoworkHandoff } from '../coworkHandoff'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useModelProvider } from '@/hooks/useModelProvider'

const tools = { id: 'm', capabilities: ['tools'] }
const noTools = { id: 'plain', capabilities: [] }

const setModel = (
  model: { id: string; capabilities: string[] },
  source?: string
) =>
  useModelProvider.setState({
    providers: [
      { provider: 'p', active: true, models: [model], settings: [], source },
    ] as never,
    selectedProvider: 'p',
    selectedModel: model as never,
  })

const submission = { text: 'hello', draft: 'hello' }

describe('startCoworkFromDraft', () => {
  const navigate = vi.fn()
  beforeEach(() => {
    navigate.mockReset()
    toastError.mockReset()
    sessionStorage.clear()
    useCoworkSessions.setState({ sessions: [], currentId: null })
    setModel(tools)
  })

  it('creates exactly one cowork session with the folder and one handoff', () => {
    const outcome = startCoworkFromDraft({
      folder: '/home/u/app',
      submission,
      navigate,
    })
    const { sessions } = useCoworkSessions.getState()
    expect(outcome).toBe('started')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].folder).toBe('/home/u/app')
    expect(sessions[0].model).toEqual({ provider: 'p', id: 'm' })
    expect(peekCoworkHandoff(sessions[0].id)?.text).toBe('hello')
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith({
      to: '/cowork/$sessionId',
      params: { sessionId: sessions[0].id },
    })
    clearCoworkHandoff(sessions[0].id)
  })

  it('files the conversation under the draft project', () => {
    const project = { id: 'pr', name: 'Proj', updated_at: 1 }
    startCoworkFromDraft({ folder: '/home/u/app', project, submission, navigate })
    expect(useCoworkSessions.getState().sessions[0].project).toMatchObject({
      id: 'pr',
      name: 'Proj',
    })
  })

  it('does not inherit a plan mode left on an untouched current session', () => {
    const id = useCoworkSessions.getState().createSession()
    useCoworkSessions.getState().setPlanMode(id, true)
    startCoworkFromDraft({ folder: '/home/u/app', submission, navigate })
    expect(useCoworkSessions.getState().sessions).toHaveLength(1)
    expect(useCoworkSessions.getState().sessions[0].planMode).toBe(false)
  })

  it('refuses before creating anything when the model cannot use tools', () => {
    setModel(noTools)
    const outcome = startCoworkFromDraft({
      folder: '/home/u/app',
      submission,
      navigate,
    })
    expect(outcome).toBe('refused')
    expect(useCoworkSessions.getState().sessions).toHaveLength(0)
    expect(navigate).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('common:modelNoTools')
  })

  it('refuses a provider added by an extension', () => {
    setModel(tools, 'some-extension')
    expect(
      startCoworkFromDraft({ folder: '/home/u/app', submission, navigate })
    ).toBe('refused')
    expect(useCoworkSessions.getState().sessions).toHaveLength(0)
  })

  it('refuses when no model is selected', () => {
    useModelProvider.setState({ selectedModel: undefined } as never)
    expect(
      startCoworkFromDraft({ folder: '/home/u/app', submission, navigate })
    ).toBe('refused')
    expect(navigate).not.toHaveBeenCalled()
  })
})
