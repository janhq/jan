import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAssistant, defaultAssistant } from '../useAssistant'

const mockCreateAssistant = vi.fn().mockResolvedValue(undefined)
const mockDeleteAssistant = vi.fn().mockResolvedValue(undefined)
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ assistants: () => ({
    createAssistant: mockCreateAssistant,
    deleteAssistant: mockDeleteAssistant,
  }) }),
}))

describe('useAssistant', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    localStorage.clear()
    // Reset Zustand store to default state
    await act(async () => {
      useAssistant.setState({
        assistants: [defaultAssistant],
        currentAssistant: defaultAssistant,
        loading: true,
        defaultAssistantId: '',
      })
    })
  })

  it('should initialize with default state', async () => {
    const { result } = renderHook(() => useAssistant())

    expect(result.current.assistants).toEqual([defaultAssistant])
    expect(result.current.currentAssistant).toEqual(defaultAssistant)
  })

  it('should add assistant', async () => {
    const { result } = renderHook(() => useAssistant())

    const newAssistant = {
      id: 'assistant-2',
      name: 'New Assistant',
      avatar: '🤖',
      description: 'A new assistant',
      instructions: 'Help the user',
      created_at: Date.now(),
      parameters: {},
    }

    await act(async () => {
      await result.current.addAssistant(newAssistant)
    })

    expect(result.current.assistants).toHaveLength(2)
    expect(result.current.assistants).toContain(newAssistant)
  })

  it('should update assistant', async () => {
    const { result } = renderHook(() => useAssistant())

    const updatedAssistant = {
      ...defaultAssistant,
      name: 'Updated Jan',
      description: 'Updated description',
    }

    await act(async () => {
      await result.current.updateAssistant(updatedAssistant)
    })

    expect(result.current.assistants[0].name).toBe('Updated Jan')
    expect(result.current.assistants[0].description).toBe('Updated description')
  })

  it('should delete assistant', async () => {
    const { result } = renderHook(() => useAssistant())

    const assistant2 = {
      id: 'assistant-2',
      name: 'Assistant 2',
      avatar: '🤖',
      description: 'Second assistant',
      instructions: 'Help the user',
      created_at: Date.now(),
      parameters: {},
    }

    await act(async () => {
      await result.current.addAssistant(assistant2)
    })

    expect(result.current.assistants).toHaveLength(2)

    await act(async () => {
      await result.current.deleteAssistant('assistant-2')
    })

    expect(result.current.assistants).toHaveLength(1)
    expect(result.current.assistants[0].id).toBe('jan')
  })

  it('should set current assistant', async () => {
    const { result } = renderHook(() => useAssistant())

    const newAssistant = {
      id: 'assistant-2',
      name: 'New Current Assistant',
      avatar: '🤖',
      description: 'New current assistant',
      instructions: 'Help the user',
      created_at: Date.now(),
      parameters: {},
    }

    await act(async () => {
      result.current.setCurrentAssistant(newAssistant)
    })

    expect(result.current.currentAssistant).toEqual(newAssistant)
  })

  it('should set assistants', async () => {
    const { result } = renderHook(() => useAssistant())

    const assistants = [
      {
        id: 'assistant-1',
        name: 'Assistant 1',
        avatar: '🤖',
        description: 'First assistant',
        instructions: 'Help the user',
        created_at: Date.now(),
        parameters: {},
      },
      {
        id: 'assistant-2',
        name: 'Assistant 2',
        avatar: '🔧',
        description: 'Second assistant',
        instructions: 'Help with tasks',
        created_at: Date.now(),
        parameters: {},
      },
    ]

    expect(result.current.loading).toBe(true)

    await act(async () => {
      result.current.setAssistants(assistants)
    })

    expect(result.current.loading).toBe(false)

    expect(result.current.assistants).toEqual(assistants)
    expect(result.current.assistants).toHaveLength(2)
  })

  it('should maintain assistant structure', async () => {
    const { result } = renderHook(() => useAssistant())

    expect(result.current.currentAssistant.id).toBe('jan')
    expect(result.current.currentAssistant.name).toBe('Jan')
    expect(result.current.currentAssistant.avatar).toBe('👋')
    expect(result.current.currentAssistant.instructions).toContain(
      'Before engaging any tools, articulate your complete thought process in natural language'
    )
    expect(typeof result.current.currentAssistant.created_at).toBe('number')
    expect(typeof result.current.currentAssistant.parameters).toBe('object')
  })

  it('should handle empty assistants list', async () => {
    const { result } = renderHook(() => useAssistant())

    await act(async () => {
      result.current.setAssistants([])
    })

    expect(result.current.assistants).toEqual([])
  })

  it('should update assistant in current assistant if it matches', async () => {
    const { result } = renderHook(() => useAssistant())

    const updatedDefaultAssistant = {
      ...defaultAssistant,
      name: 'Updated Jan Name',
    }

    await act(async () => {
      await result.current.updateAssistant(updatedDefaultAssistant)
    })

    expect(result.current.currentAssistant.name).toBe('Updated Jan Name')
  })
  it.each(['addAssistant', 'updateAssistant', 'deleteAssistant'] as const)(
    '%s rejects without changing memory or defaults', async (operation) => {
      const state = useAssistant.getState()
      const error = new Error('Disk unavailable')
      const mock = operation === 'deleteAssistant' ? mockDeleteAssistant : mockCreateAssistant
      mock.mockRejectedValueOnce(error)
      await expect(operation === 'deleteAssistant'
        ? state.deleteAssistant(defaultAssistant.id)
        : state[operation]({ ...defaultAssistant, name: 'Draft' })).rejects.toThrow('Disk unavailable')
      expect(useAssistant.getState().assistants).toEqual([defaultAssistant])
      expect(useAssistant.getState().currentAssistant).toEqual(defaultAssistant)
      expect(useAssistant.getState().defaultAssistantId).toBe('')
    }
  )

  it('publishes only after persistence completes', async () => {
    let finish!: () => void
    mockCreateAssistant.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve }))
    const save = useAssistant.getState().updateAssistant({ ...defaultAssistant, name: 'Saved' })
    expect(useAssistant.getState().currentAssistant?.name).toBe('Jan')
    finish()
    await save
    expect(useAssistant.getState().currentAssistant?.name).toBe('Saved')
  })

  it('deleting a custom default resets both memory and persisted default', async () => {
    const custom = { ...defaultAssistant, id: 'custom' }
    useAssistant.setState({ assistants: [defaultAssistant, custom], currentAssistant: custom, defaultAssistantId: custom.id })
    await useAssistant.getState().deleteAssistant(custom.id)
    expect(useAssistant.getState().defaultAssistantId).toBe('jan')
    expect(localStorage.getItem('default-assistant-id')).toBe('jan')
    expect(localStorage.getItem('last-used-assistant')).toBe('jan')
    expect(useAssistant.getState().currentAssistant).toEqual(defaultAssistant)
  })

})
