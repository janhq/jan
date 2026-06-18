import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AssistantSwitcher } from '../AssistantSwitcher'
import { useAssistantSwitcher } from '@/hooks/useAssistantSwitcher'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const assistant = (id: string, name: string): Assistant =>
  ({ id, name, avatar: '😀' }) as unknown as Assistant

const thread = (assistantId?: string): Thread =>
  ({
    id: 't1',
    assistants: assistantId ? [{ id: assistantId } as Assistant] : [],
  }) as unknown as Thread

const cycle = () => useAssistantSwitcher.getState().cycleHandler?.()

describe('AssistantSwitcher cycle logic', () => {
  let setSelectedAssistantId: ReturnType<typeof vi.fn>
  let updateCurrentThreadAssistant: ReturnType<typeof vi.fn>

  beforeEach(() => {
    cleanup()
    setSelectedAssistantId = vi.fn()
    updateCurrentThreadAssistant = vi.fn()
    useAssistantSwitcher.setState({ open: false, cycleHandler: null })
  })

  const renderSwitcher = (overrides: Partial<{
    assistants: Assistant[]
    currentThread: Thread | undefined
    selectedAssistantId: string | undefined
  }> = {}) =>
    render(
      <AssistantSwitcher
        assistants={overrides.assistants ?? [assistant('a1', 'Alice'), assistant('a2', 'Bob')]}
        currentThread={'currentThread' in overrides ? overrides.currentThread : undefined}
        selectedAssistantId={overrides.selectedAssistantId}
        setSelectedAssistantId={setSelectedAssistantId}
        updateCurrentThreadAssistant={updateCurrentThreadAssistant}
      />
    )

  it('renders nothing with a single assistant and never registers a usable cycle', () => {
    const { container } = renderSwitcher({ assistants: [assistant('a1', 'Alice')] })
    expect(container.firstChild).toBeNull()
    cycle()
    expect(setSelectedAssistantId).not.toHaveBeenCalled()
    expect(updateCurrentThreadAssistant).not.toHaveBeenCalled()
  })

  it('advances to the next assistant off-thread', () => {
    renderSwitcher({ selectedAssistantId: 'a1' })
    cycle()
    expect(setSelectedAssistantId).toHaveBeenCalledWith('a2')
  })

  it('wraps around from the last assistant to the first off-thread', () => {
    renderSwitcher({ selectedAssistantId: 'a2' })
    cycle()
    expect(setSelectedAssistantId).toHaveBeenCalledWith('a1')
  })

  it('treats an unknown selected id as index -1 and selects the first', () => {
    renderSwitcher({ selectedAssistantId: 'missing' })
    cycle()
    // findIndex => -1, (-1 + 1) % len === 0
    expect(setSelectedAssistantId).toHaveBeenCalledWith('a1')
  })

  it('cycles the thread assistant via updateCurrentThreadAssistant inside a thread', () => {
    renderSwitcher({ currentThread: thread('a1') })
    cycle()
    expect(updateCurrentThreadAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a2' })
    )
    expect(setSelectedAssistantId).not.toHaveBeenCalled()
  })

  it('wraps around the thread assistant', () => {
    renderSwitcher({ currentThread: thread('a2') })
    cycle()
    expect(updateCurrentThreadAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1' })
    )
  })

  it('starts from the first assistant when the thread has only a model-only assistant', () => {
    renderSwitcher({ currentThread: thread('model-only') })
    cycle()
    expect(updateCurrentThreadAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1' })
    )
  })

  it('starts from the first assistant when the thread has no assistant', () => {
    renderSwitcher({ currentThread: thread(undefined) })
    cycle()
    expect(updateCurrentThreadAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1' })
    )
  })

  it('unregisters the cycle handler on unmount', () => {
    const { unmount } = renderSwitcher({ selectedAssistantId: 'a1' })
    expect(useAssistantSwitcher.getState().cycleHandler).not.toBeNull()
    unmount()
    expect(useAssistantSwitcher.getState().cycleHandler).toBeNull()
  })

  it('falls back to the i18n key when no assistant is active off-thread', () => {
    renderSwitcher({ selectedAssistantId: undefined })
    expect(screen.getByText('common:noAssistant')).toBeInTheDocument()
  })
})
