import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAssistant, defaultAssistant } from '../useAssistant'

const mocks = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockCreateAssistant: vi.fn().mockResolvedValue(undefined),
  mockDeleteAssistant: vi.fn().mockResolvedValue(undefined),
  mockGetAssistants: vi.fn().mockResolvedValue([]),
}))
vi.mock('sonner', () => ({
  toast: {
    error: mocks.mockToast,
  },
}))

const mockCreateAssistant = mocks.mockCreateAssistant
const mockDeleteAssistant = mocks.mockDeleteAssistant
const mockGetAssistants = mocks.mockGetAssistants
const mockToast = mocks.mockToast

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    assistants: () => ({
      createAssistant: mockCreateAssistant,
      deleteAssistant: mockDeleteAssistant,
      getAssistants: mockGetAssistants,
    }),
  }),
}))

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    lastUsedAssistant: 'last-used-assistant',
    defaultAssistantId: 'default-assistant-id',
  },
}))

describe('useAssistant - coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockGetAssistants.mockResolvedValue([defaultAssistant])
    localStorage.clear()
    act(() => {
      useAssistant.setState({
        assistants: [defaultAssistant],
        currentAssistant: defaultAssistant,
        defaultAssistantId: '',
        loading: true,
      })
    })
  })

  it('should set null assistants and just set loading false', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants(null)
    })

    expect(result.current.loading).toBe(false)
  })

  it('setAssistants should use last used assistant from localStorage', () => {
    localStorage.setItem('last-used-assistant', 'a2')
    const { result } = renderHook(() => useAssistant())

    const assistants = [
      { ...defaultAssistant },
      { id: 'a2', name: 'A2', avatar: '', description: '', instructions: '', created_at: 1, parameters: {} },
    ]

    act(() => {
      result.current.setAssistants(assistants as any)
    })

    expect(result.current.currentAssistant?.id).toBe('a2')
  })

  it('setAssistants should use default assistant ID from localStorage', () => {
    localStorage.setItem('default-assistant-id', 'a2')
    const { result } = renderHook(() => useAssistant())

    const assistants = [
      { ...defaultAssistant },
      { id: 'a2', name: 'A2', avatar: '', description: '', instructions: '', created_at: 1, parameters: {} },
    ]

    act(() => {
      result.current.setAssistants(assistants as any)
    })

    expect(result.current.currentAssistant?.id).toBe('a2')
    expect(result.current.defaultAssistantId).toBe('a2')
  })

  it('setAssistants should fallback to default when last used ID not found', () => {
    localStorage.setItem('last-used-assistant', 'nonexistent')
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants([defaultAssistant] as any)
    })

    expect(result.current.currentAssistant?.id).toBe('jan')
  })

  it('setAssistants handles empty string last used ID', () => {
    localStorage.setItem('last-used-assistant', '')
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants([defaultAssistant] as any)
    })

    // When lastUsedId is '', it returns '' which means no assistant selected
    expect(result.current.currentAssistant).toBeUndefined()
  })

  it('should delete current assistant and fallback to default', () => {
    const { result } = renderHook(() => useAssistant())

    const a2 = { id: 'a2', name: 'A2', avatar: '', description: '', instructions: '', created_at: 1, parameters: {} }
    act(() => {
      result.current.addAssistant(a2 as any)
      result.current.setCurrentAssistant(a2 as any)
    })

    act(() => {
      result.current.deleteAssistant('a2')
    })

    expect(result.current.currentAssistant?.id).toBe('jan')
  })

  it('should delete the default assistant and reset', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setDefaultAssistant('jan')
    })

    act(() => {
      result.current.deleteAssistant('jan')
    })

    // defaultAssistantId should reset
    expect(result.current.assistants.find(a => a.id === 'jan')).toBeUndefined()
  })

  it('setCurrentAssistant should not change if defaultAssistantId matches', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      useAssistant.setState({ defaultAssistantId: 'jan' })
    })

    const a2 = { id: 'a2', name: 'A2' } as any
    act(() => {
      result.current.setCurrentAssistant(a2)
    })

    // Should not change because current is the default
    expect(result.current.currentAssistant?.id).toBe('jan')
  })

  it('setCurrentAssistant with saveToStorage false', () => {
    const { result } = renderHook(() => useAssistant())
    const setItemSpy = vi.spyOn(localStorage, 'setItem')

    const a2 = { id: 'a2', name: 'A2' } as any
    act(() => {
      result.current.setCurrentAssistant(a2, false)
    })

    expect(result.current.currentAssistant).toEqual(a2)
    // Should NOT save to localStorage
    expect(setItemSpy).not.toHaveBeenCalledWith('last-used-assistant', 'a2')
  })

  it('setCurrentAssistant does nothing if same assistant', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setCurrentAssistant(defaultAssistant as any)
    })

    // Should be the same - no change
    expect(result.current.currentAssistant?.id).toBe('jan')
  })

  it('setDefaultAssistant should set and persist', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setDefaultAssistant('jan')
    })

    expect(result.current.defaultAssistantId).toBe('jan')
    expect(result.current.currentAssistant?.id).toBe('jan')
  })

  it('setDefaultAssistant with non-existent ID', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setDefaultAssistant('nonexistent')
    })

    expect(result.current.defaultAssistantId).toBe('nonexistent')
  })

  it('setDefaultAssistant with empty string removes default', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setDefaultAssistant('')
    })

    expect(result.current.defaultAssistantId).toBe('')
  })

  it('updateAssistant should not change currentAssistant when different assistant updated', () => {
    const { result } = renderHook(() => useAssistant())

    const a2 = { id: 'a2', name: 'A2', avatar: '', description: '', instructions: '', created_at: 1, parameters: {} }
    act(() => {
      result.current.addAssistant(a2 as any)
    })

    act(() => {
      result.current.updateAssistant({ ...a2, name: 'Updated A2' } as any)
    })

    // currentAssistant should still be jan
    expect(result.current.currentAssistant?.id).toBe('jan')
  })

  it('refreshAssistants should fetch fresh data and update state', async () => {
    const freshAssistants = [
      { ...defaultAssistant, name: 'Fresh Jan' },
      { id: 'a2', name: 'A2', avatar: '', description: '', instructions: '', created_at: 2, parameters: {} },
    ]
    mockGetAssistants.mockResolvedValue(freshAssistants as any)

    const { result } = renderHook(() => useAssistant())

    expect(result.current.loading).toBe(true)

    await act(async () => {
      await result.current.refreshAssistants()
    })

    expect(result.current.assistants).toEqual(freshAssistants)
    expect(result.current.loading).toBe(false)
  })

  it('refreshAssistants should set loading:true before fetch starts', async () => {
    const deferred = vi.fn().mockReturnValue(new Promise((resolve) => setTimeout(resolve, 100)))
    mockGetAssistants.mockReturnValue(deferred())

    const { result } = renderHook(() => useAssistant())

    expect(result.current.loading).toBe(true)
  })

  it('refreshAssistants should show toast error on failure', async () => {
    mockGetAssistants.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useAssistant())

    await act(async () => {
      await result.current.refreshAssistants()
    })

    expect(mockToast).toHaveBeenCalledWith('Failed to refresh assistants', {
      description: 'Network error',
    })
    expect(result.current.loading).toBe(false)
  })

  afterEach(() => {
    mockToast.mockClear()
  })
})
