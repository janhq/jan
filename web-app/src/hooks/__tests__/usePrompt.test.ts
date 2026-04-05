import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePrompt } from '../usePrompt'

describe('usePrompt', () => {
  beforeEach(() => {
    act(() => {
      usePrompt.setState({ prompt: '', promptHistory: [], historyIndex: -1, draftPrompt: '' })
    })
  })

  it('should set and clear prompt', () => {
    const { result } = renderHook(() => usePrompt())

    act(() => result.current.setPrompt('Hello'))
    expect(result.current.prompt).toBe('Hello')

    act(() => result.current.resetPrompt())
    expect(result.current.prompt).toBe('')
  })

  describe('prompt history', () => {
    it('should add entries, skip empty/duplicates, and cap at 100', () => {
      const { result } = renderHook(() => usePrompt())

      act(() => {
        result.current.addToHistory('')
        result.current.addToHistory('   ')
        result.current.addToHistory('first')
        result.current.addToHistory('first') // duplicate
        result.current.addToHistory('second')
      })

      expect(result.current.promptHistory).toEqual(['second', 'first'])

      act(() => {
        for (let i = 0; i < 110; i++) result.current.addToHistory(`msg ${i}`)
      })
      expect(result.current.promptHistory.length).toBe(100)
    })

    it('should navigate up/down and restore draft', () => {
      const { result } = renderHook(() => usePrompt())

      act(() => {
        result.current.addToHistory('first')
        result.current.addToHistory('second')
        result.current.setPrompt('my draft')
      })

      // Up through history
      act(() => result.current.navigateHistory('up'))
      expect(result.current.prompt).toBe('second')

      act(() => result.current.navigateHistory('up'))
      expect(result.current.prompt).toBe('first')

      // Can't go past oldest
      act(() => result.current.navigateHistory('up'))
      expect(result.current.prompt).toBe('first')

      // Down restores
      act(() => result.current.navigateHistory('down'))
      expect(result.current.prompt).toBe('second')

      act(() => result.current.navigateHistory('down'))
      expect(result.current.prompt).toBe('my draft')
      expect(result.current.historyIndex).toBe(-1)
    })

    it('should do nothing on empty history or no active browsing', () => {
      const { result } = renderHook(() => usePrompt())

      act(() => result.current.setPrompt('text'))
      act(() => result.current.navigateHistory('up'))
      expect(result.current.prompt).toBe('text')

      act(() => result.current.navigateHistory('down'))
      expect(result.current.prompt).toBe('text')
    })

    it('should reset history index when user types', () => {
      const { result } = renderHook(() => usePrompt())

      act(() => result.current.addToHistory('old'))
      act(() => result.current.navigateHistory('up'))
      expect(result.current.historyIndex).toBe(0)

      act(() => result.current.setPrompt('typing'))
      expect(result.current.historyIndex).toBe(-1)
    })
  })
})
