import { renderHook, act } from '@testing-library/react'
import { useSetAtom } from 'jotai'
import { events, AssistantEvent, ExtensionTypeEnum } from '@janhq/core'

// Mock dependencies
jest.mock('jotai', () => ({
  useAtomValue: jest.fn(),
  useSetAtom: jest.fn(),
  useAtom: jest.fn(),
  atom: jest.fn(),
}))
jest.mock('@janhq/core')
jest.mock('@/extension')

import useAssistants from './useAssistants'
import { extensionManager } from '@/extension'

// Mock data
const mockAssistants = [
  { id: 'assistant-1', name: 'Assistant 1' },
  { id: 'assistant-2', name: 'Assistant 2' },
]

const mockAssistantExtension = {
  getAssistants: jest.fn().mockResolvedValue(mockAssistants),
} as any

describe('useAssistants', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(extensionManager, 'get').mockReturnValue(mockAssistantExtension)
  })

  it('should fetch and set assistants on mount', async () => {
    const mockSetAssistants = jest.fn()
    ;(useSetAtom as jest.Mock).mockReturnValue(mockSetAssistants)

    renderHook(() => useAssistants())

    // Wait for useEffect to complete
    await act(async () => {})

    expect(mockAssistantExtension.getAssistants).toHaveBeenCalled()
    expect(mockSetAssistants).toHaveBeenCalledWith(mockAssistants)
  })

  it('should update assistants when AssistantEvent.OnAssistantsUpdate is emitted', async () => {
    const mockSetAssistants = jest.fn()
    ;(useSetAtom as jest.Mock).mockReturnValue(mockSetAssistants)

    renderHook(() => useAssistants())

    // Wait for initial useEffect to complete
    await act(async () => {})

    // Clear previous calls
    mockSetAssistants.mockClear()

    // Simulate AssistantEvent.OnAssistantsUpdate event
    await act(async () => {
      events.emit(AssistantEvent.OnAssistantsUpdate, '')
    })

    expect(mockAssistantExtension.getAssistants).toHaveBeenCalledTimes(1)
  })

  it('should unsubscribe from events on unmount', async () => {
    const { unmount } = renderHook(() => useAssistants())

    // Wait for useEffect to complete
    await act(async () => {})

    const offSpy = jest.spyOn(events, 'off')

    unmount()

    expect(offSpy).toHaveBeenCalledWith(
      AssistantEvent.OnAssistantsUpdate,
      expect.any(Function)
    )
  })

  it('should handle case when AssistantExtension is not available', async () => {
    const mockSetAssistants = jest.fn()
    ;(useSetAtom as jest.Mock).mockReturnValue(mockSetAssistants)
    ;(extensionManager.get as jest.Mock).mockReturnValue(undefined)

    renderHook(() => useAssistants())

    // Wait for useEffect to complete
    await act(async () => {})

    expect(mockSetAssistants).toHaveBeenCalledWith([])
  })
})
