import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToolApproval } from '../useToolApproval'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    toolApproval: 'tool-approval-settings',
  },
}))

// Mock zustand persist
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

describe('useToolApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to defaults
    useToolApproval.setState({
      approvedTools: {},
      allowAllMCPPermissions: false,
      isModalOpen: false,
      modalProps: null,
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useToolApproval())

    expect(result.current.approvedTools).toEqual({})
    expect(result.current.allowAllMCPPermissions).toBe(false)
    expect(result.current.isModalOpen).toBe(false)
    expect(result.current.modalProps).toBe(null)
    expect(typeof result.current.approveToolForThread).toBe('function')
    expect(typeof result.current.isToolApproved).toBe('function')
    expect(typeof result.current.showApprovalModal).toBe('function')
    expect(typeof result.current.closeModal).toBe('function')
    expect(typeof result.current.setModalOpen).toBe('function')
    expect(typeof result.current.setAllowAllMCPPermissions).toBe('function')
  })

  describe('setAllowAllMCPPermissions', () => {
    it('should set allowAllMCPPermissions to true', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.setAllowAllMCPPermissions(true)
      })

      expect(result.current.allowAllMCPPermissions).toBe(true)
    })

    it('should set allowAllMCPPermissions to false', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.setAllowAllMCPPermissions(true)
      })

      expect(result.current.allowAllMCPPermissions).toBe(true)

      act(() => {
        result.current.setAllowAllMCPPermissions(false)
      })

      expect(result.current.allowAllMCPPermissions).toBe(false)
    })
  })

  describe('approveToolForThread', () => {
    it('should approve a tool for a thread', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      expect(result.current.approvedTools['thread-1']).toContain('tool-a')
    })

    it('should approve multiple tools for the same thread', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
        result.current.approveToolForThread('thread-1', 'tool-b')
        result.current.approveToolForThread('thread-1', 'tool-c')
      })

      expect(result.current.approvedTools['thread-1']).toEqual(['tool-a', 'tool-b', 'tool-c'])
    })

    it('should approve tools for different threads independently', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
        result.current.approveToolForThread('thread-2', 'tool-b')
        result.current.approveToolForThread('thread-3', 'tool-c')
      })

      expect(result.current.approvedTools['thread-1']).toEqual(['tool-a'])
      expect(result.current.approvedTools['thread-2']).toEqual(['tool-b'])
      expect(result.current.approvedTools['thread-3']).toEqual(['tool-c'])
    })

    it('should not duplicate tools when approving the same tool multiple times', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
        result.current.approveToolForThread('thread-1', 'tool-a')
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      expect(result.current.approvedTools['thread-1']).toEqual(['tool-a'])
    })
  })

  describe('isToolApproved', () => {
    it('should return false for non-approved tools', () => {
      const { result } = renderHook(() => useToolApproval())

      const isApproved = result.current.isToolApproved('thread-1', 'tool-a')
      expect(isApproved).toBe(false)
    })

    it('should return true for approved tools', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      const isApproved = result.current.isToolApproved('thread-1', 'tool-a')
      expect(isApproved).toBe(true)
    })

    it('should return false for tools approved for different threads', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      const isApproved = result.current.isToolApproved('thread-2', 'tool-a')
      expect(isApproved).toBe(false)
    })
  })

  describe('closeModal', () => {
    it('should close the modal and reset props', () => {
      const { result } = renderHook(() => useToolApproval())

      // First set modal to open state
      act(() => {
        result.current.setModalOpen(true)
      })

      expect(result.current.isModalOpen).toBe(true)

      // Then close the modal
      act(() => {
        result.current.closeModal()
      })

      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })
  })

  describe('setModalOpen', () => {
    it('should set modal open state to true', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.setModalOpen(true)
      })

      expect(result.current.isModalOpen).toBe(true)
    })

    it('should set modal open state to false and call closeModal', () => {
      const { result } = renderHook(() => useToolApproval())

      // Set up initial state
      act(() => {
        result.current.setModalOpen(true)
      })

      // Mock modalProps to verify they get reset
      useToolApproval.setState({
        modalProps: {
          toolName: 'test-tool',
          threadId: 'test-thread',
          onApprove: vi.fn(),
          onDeny: vi.fn(),
        },
      })

      // Set to false should trigger closeModal
      act(() => {
        result.current.setModalOpen(false)
      })

      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })
  })

  describe('showApprovalModal', () => {
    it('should return true immediately if tool is already approved', async () => {
      const { result } = renderHook(() => useToolApproval())

      // First approve the tool
      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      // Then show approval modal
      let approvalResult: boolean
      await act(async () => {
        approvalResult = await result.current.showApprovalModal('tool-a', 'thread-1')
      })

      expect(approvalResult!).toBe(true)
      expect(result.current.isModalOpen).toBe(false)
    })

    it('should open modal and set up modal props for non-approved tool', async () => {
      const { result } = renderHook(() => useToolApproval())

      // Start the async operation
      let approvalPromise: Promise<boolean>

      act(() => {
        approvalPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      // Check that modal is open and props are set
      expect(result.current.isModalOpen).toBe(true)
      expect(result.current.modalProps).not.toBe(null)
      expect(result.current.modalProps?.toolName).toBe('tool-a')
      expect(result.current.modalProps?.threadId).toBe('thread-1')
      expect(typeof result.current.modalProps?.onApprove).toBe('function')
      expect(typeof result.current.modalProps?.onDeny).toBe('function')

      // Resolve by calling onDeny
      act(() => {
        result.current.modalProps?.onDeny()
      })

      const approvalResult = await approvalPromise!
      expect(approvalResult).toBe(false)
      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })

    it('should resolve with true when onApprove is called with allowOnce=true', async () => {
      const { result } = renderHook(() => useToolApproval())

      // Start the async operation
      let approvalPromise: Promise<boolean>

      act(() => {
        approvalPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      // Call onApprove with allowOnce=true
      act(() => {
        result.current.modalProps?.onApprove(true)
      })

      const approvalResult = await approvalPromise!
      expect(approvalResult).toBe(true)
      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
      // Tool should NOT be added to approved tools when allowOnce=true
      expect(result.current.isToolApproved('thread-1', 'tool-a')).toBe(false)
    })

    it('should resolve with true and approve tool when onApprove is called with allowOnce=false', async () => {
      const { result } = renderHook(() => useToolApproval())

      // Start the async operation
      let approvalPromise: Promise<boolean>

      act(() => {
        approvalPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      // Call onApprove with allowOnce=false
      act(() => {
        result.current.modalProps?.onApprove(false)
      })

      const approvalResult = await approvalPromise!
      expect(approvalResult).toBe(true)
      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
      // Tool should be added to approved tools when allowOnce=false
      expect(result.current.isToolApproved('thread-1', 'tool-a')).toBe(true)
    })

    it('should resolve with false when onDeny is called', async () => {
      const { result } = renderHook(() => useToolApproval())

      // Start the async operation
      let approvalPromise: Promise<boolean>

      act(() => {
        approvalPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      // Call onDeny
      act(() => {
        result.current.modalProps?.onDeny()
      })

      const approvalResult = await approvalPromise!
      expect(approvalResult).toBe(false)
      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })
  })

  describe('state management', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useToolApproval())
      const { result: result2 } = renderHook(() => useToolApproval())

      act(() => {
        result1.current.approveToolForThread('thread-1', 'tool-a')
        result1.current.setAllowAllMCPPermissions(true)
      })

      expect(result2.current.approvedTools['thread-1']).toContain('tool-a')
      expect(result2.current.allowAllMCPPermissions).toBe(true)
    })
  })

  describe('complex scenarios', () => {
    it('should handle multiple sequential approval requests', async () => {
      const { result } = renderHook(() => useToolApproval())

      // First request
      let firstPromise: Promise<boolean>
      act(() => {
        firstPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      act(() => {
        result.current.modalProps?.onApprove(false)
      })

      const firstResult = await firstPromise!
      expect(firstResult).toBe(true)
      expect(result.current.isToolApproved('thread-1', 'tool-a')).toBe(true)

      // Second request for same tool should resolve immediately
      let secondPromise: Promise<boolean>
      act(() => {
        secondPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      const secondResult = await secondPromise!
      expect(secondResult).toBe(true)
      expect(result.current.isModalOpen).toBe(false)
    })

    it('should handle approval for different tools in same thread', async () => {
      const { result } = renderHook(() => useToolApproval())

      // Approve tool-a permanently
      let firstPromise: Promise<boolean>
      act(() => {
        firstPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      act(() => {
        result.current.modalProps?.onApprove(false)
      })

      await firstPromise!
      expect(result.current.isToolApproved('thread-1', 'tool-a')).toBe(true)

      // Approve tool-b once only
      let secondPromise: Promise<boolean>
      act(() => {
        secondPromise = result.current.showApprovalModal('tool-b', 'thread-1')
      })

      act(() => {
        result.current.modalProps?.onApprove(true)
      })

      await secondPromise!
      expect(result.current.isToolApproved('thread-1', 'tool-b')).toBe(false)

      // Verify final state
      expect(result.current.approvedTools['thread-1']).toEqual(['tool-a'])
    })

    it('should handle denial and subsequent approval', async () => {
      const { result } = renderHook(() => useToolApproval())

      // First request - deny
      let firstPromise: Promise<boolean>
      act(() => {
        firstPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      act(() => {
        result.current.modalProps?.onDeny()
      })

      const firstResult = await firstPromise!
      expect(firstResult).toBe(false)
      expect(result.current.isToolApproved('thread-1', 'tool-a')).toBe(false)

      // Second request - approve
      let secondPromise: Promise<boolean>
      act(() => {
        secondPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      act(() => {
        result.current.modalProps?.onApprove(false)
      })

      const secondResult = await secondPromise!
      expect(secondResult).toBe(true)
      expect(result.current.isToolApproved('thread-1', 'tool-a')).toBe(true)
    })
  })
})
