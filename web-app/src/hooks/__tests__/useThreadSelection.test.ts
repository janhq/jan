/**
 * @description Unit tests for useThreadSelection hook
 * @module hooks/__tests__/useThreadSelection.test.ts
 * @since 1.0.0
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useThreadSelection } from '../useThreadSelection'

describe('useThreadSelection', () => {
  beforeEach(() => {
    // Reset the store before each test
    const { result } = renderHook(() => useThreadSelection())
    act(() => {
      result.current.clearSelection()
      result.current.setSelectionMode(false)
    })
  })

  describe('Selection Mode', () => {
    it('should initialize with selection mode off', () => {
      const { result } = renderHook(() => useThreadSelection())
      expect(result.current.isSelectionMode).toBe(false)
    })

    it('should toggle selection mode', () => {
      const { result } = renderHook(() => useThreadSelection())

      act(() => {
        result.current.toggleSelectionMode()
      })

      expect(result.current.isSelectionMode).toBe(true)

      act(() => {
        result.current.toggleSelectionMode()
      })

      expect(result.current.isSelectionMode).toBe(false)
    })

    it('should clear selection when exiting selection mode', () => {
      const { result } = renderHook(() => useThreadSelection())

      // Enter selection mode and select threads
      act(() => {
        result.current.setSelectionMode(true)
        result.current.toggleThread('thread1')
        result.current.toggleThread('thread2')
      })

      expect(result.current.getSelectedCount()).toBe(2)

      // Exit selection mode
      act(() => {
        result.current.toggleSelectionMode()
      })

      expect(result.current.isSelectionMode).toBe(false)
      expect(result.current.getSelectedCount()).toBe(0)
    })
  })

  describe('Single Thread Selection', () => {
    it('should select a thread', () => {
      const { result } = renderHook(() => useThreadSelection())

      act(() => {
        result.current.setSelectionMode(true)
        result.current.toggleThread('thread1')
      })

      expect(result.current.isSelected('thread1')).toBe(true)
      expect(result.current.getSelectedCount()).toBe(1)
    })

    it('should deselect a thread when toggled again', () => {
      const { result } = renderHook(() => useThreadSelection())

      act(() => {
        result.current.setSelectionMode(true)
        result.current.toggleThread('thread1')
        result.current.toggleThread('thread1')
      })

      expect(result.current.isSelected('thread1')).toBe(false)
      expect(result.current.getSelectedCount()).toBe(0)
    })

    it('should select multiple threads', () => {
      const { result } = renderHook(() => useThreadSelection())

      act(() => {
        result.current.setSelectionMode(true)
        result.current.toggleThread('thread1')
        result.current.toggleThread('thread2')
        result.current.toggleThread('thread3')
      })

      expect(result.current.getSelectedCount()).toBe(3)
      expect(result.current.isSelected('thread1')).toBe(true)
      expect(result.current.isSelected('thread2')).toBe(true)
      expect(result.current.isSelected('thread3')).toBe(true)
    })
  })

  describe('Range Selection (Shift+Click)', () => {
    const allThreadIds = ['thread1', 'thread2', 'thread3', 'thread4', 'thread5']

    it('should select range of threads with shift key', () => {
      const { result } = renderHook(() => useThreadSelection())

      act(() => {
        result.current.setSelectionMode(true)
        // Select first thread
        result.current.toggleThread('thread1', false, allThreadIds)
        // Shift+Click on thread4
        result.current.toggleThread('thread4', true, allThreadIds)
      })

      // Should select thread1, thread2, thread3, thread4
      expect(result.current.getSelectedCount()).toBe(4)
      expect(result.current.isSelected('thread1')).toBe(true)
      expect(result.current.isSelected('thread2')).toBe(true)
      expect(result.current.isSelected('thread3')).toBe(true)
      expect(result.current.isSelected('thread4')).toBe(true)
      expect(result.current.isSelected('thread5')).toBe(false)
    })

    it('should select range in reverse order', () => {
      const { result } = renderHook(() => useThreadSelection())

      act(() => {
        result.current.setSelectionMode(true)
        // Select thread4 first
        result.current.toggleThread('thread4', false, allThreadIds)
        // Shift+Click on thread1
        result.current.toggleThread('thread1', true, allThreadIds)
      })

      // Should select thread1, thread2, thread3, thread4
      expect(result.current.getSelectedCount()).toBe(4)
      expect(result.current.isSelected('thread1')).toBe(true)
      expect(result.current.isSelected('thread2')).toBe(true)
      expect(result.current.isSelected('thread3')).toBe(true)
      expect(result.current.isSelected('thread4')).toBe(true)
    })

    it('should fallback to normal toggle if last selected ID not found', () => {
      const { result } = renderHook(() => useThreadSelection())

      act(() => {
        result.current.setSelectionMode(true)
        // Shift+Click without previous selection
        result.current.toggleThread('thread3', true, allThreadIds)
      })

      // Should just select thread3
      expect(result.current.getSelectedCount()).toBe(1)
      expect(result.current.isSelected('thread3')).toBe(true)
    })
  })

  describe('Select All', () => {
    it('should select all provided threads', () => {
      const { result } = renderHook(() => useThreadSelection())
      const allThreadIds = ['thread1', 'thread2', 'thread3', 'thread4']

      act(() => {
        result.current.setSelectionMode(true)
        result.current.selectAll(allThreadIds)
      })

      expect(result.current.getSelectedCount()).toBe(4)
      allThreadIds.forEach((id) => {
        expect(result.current.isSelected(id)).toBe(true)
      })
    })

    it('should replace existing selection with select all', () => {
      const { result } = renderHook(() => useThreadSelection())

      act(() => {
        result.current.setSelectionMode(true)
        result.current.toggleThread('thread1')
        result.current.selectAll(['thread2', 'thread3', 'thread4'])
      })

      expect(result.current.getSelectedCount()).toBe(3)
      expect(result.current.isSelected('thread1')).toBe(false)
      expect(result.current.isSelected('thread2')).toBe(true)
      expect(result.current.isSelected('thread3')).toBe(true)
      expect(result.current.isSelected('thread4')).toBe(true)
    })
  })

  describe('Clear Selection', () => {
    it('should clear all selected threads', () => {
      const { result } = renderHook(() => useThreadSelection())

      act(() => {
        result.current.setSelectionMode(true)
        result.current.toggleThread('thread1')
        result.current.toggleThread('thread2')
        result.current.toggleThread('thread3')
      })

      expect(result.current.getSelectedCount()).toBe(3)

      act(() => {
        result.current.clearSelection()
      })

      expect(result.current.getSelectedCount()).toBe(0)
      expect(result.current.isSelected('thread1')).toBe(false)
      expect(result.current.isSelected('thread2')).toBe(false)
      expect(result.current.isSelected('thread3')).toBe(false)
    })
  })

  describe('Get Selected Thread IDs', () => {
    it('should return array of selected thread IDs', () => {
      const { result } = renderHook(() => useThreadSelection())

      act(() => {
        result.current.setSelectionMode(true)
        result.current.toggleThread('thread1')
        result.current.toggleThread('thread3')
        result.current.toggleThread('thread5')
      })

      const selectedIds = result.current.getSelectedThreadIds()
      expect(selectedIds).toHaveLength(3)
      expect(selectedIds).toContain('thread1')
      expect(selectedIds).toContain('thread3')
      expect(selectedIds).toContain('thread5')
    })

    it('should return empty array when nothing selected', () => {
      const { result } = renderHook(() => useThreadSelection())

      act(() => {
        result.current.setSelectionMode(true)
      })

      const selectedIds = result.current.getSelectedThreadIds()
      expect(selectedIds).toHaveLength(0)
    })
  })
})
