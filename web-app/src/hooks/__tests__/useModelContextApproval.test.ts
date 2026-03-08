import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useContextSizeApproval } from '../useModelContextApproval'

describe('useContextSizeApproval', () => {
  beforeEach(() => {
    // Reset store state to defaults
    useContextSizeApproval.setState({
      isModalOpen: false,
      modalProps: null,
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useContextSizeApproval())

    expect(result.current.isModalOpen).toBe(false)
    expect(result.current.modalProps).toBe(null)
    expect(typeof result.current.showApprovalModal).toBe('function')
    expect(typeof result.current.closeModal).toBe('function')
    expect(typeof result.current.setModalOpen).toBe('function')
  })

  describe('closeModal', () => {
    it('should close the modal and reset props', () => {
      const { result } = renderHook(() => useContextSizeApproval())

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
      const { result } = renderHook(() => useContextSizeApproval())

      act(() => {
        result.current.setModalOpen(true)
      })

      expect(result.current.isModalOpen).toBe(true)
    })

    it('should set modal open state to false', () => {
      const { result } = renderHook(() => useContextSizeApproval())

      // First set to true
      act(() => {
        result.current.setModalOpen(true)
      })

      expect(result.current.isModalOpen).toBe(true)

      // Then set to false
      act(() => {
        result.current.setModalOpen(false)
      })

      expect(result.current.isModalOpen).toBe(false)
    })

    it('should call closeModal when setting to false', () => {
      const { result } = renderHook(() => useContextSizeApproval())

      // Set up initial state
      act(() => {
        result.current.setModalOpen(true)
      })

      // Mock modalProps to verify they get reset
      useContextSizeApproval.setState({
        modalProps: {
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
    it('should open modal and set up modal props', async () => {
      const { result } = renderHook(() => useContextSizeApproval())

      // Start the async operation
      let approvalPromise: Promise<'ctx_len' | 'context_shift' | undefined>

      act(() => {
        approvalPromise = result.current.showApprovalModal()
      })

      // Check that modal is open and props are set
      expect(result.current.isModalOpen).toBe(true)
      expect(result.current.modalProps).not.toBe(null)
      expect(typeof result.current.modalProps?.onApprove).toBe('function')
      expect(typeof result.current.modalProps?.onDeny).toBe('function')

      // Resolve by calling onDeny
      act(() => {
        result.current.modalProps?.onDeny()
      })

      const approvalResult = await approvalPromise!
      expect(approvalResult).toBeUndefined()
      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })

    it('should resolve with "ctx_len" when onApprove is called with ctx_len', async () => {
      const { result } = renderHook(() => useContextSizeApproval())

      // Start the async operation
      let approvalPromise: Promise<'ctx_len' | 'context_shift' | undefined>

      act(() => {
        approvalPromise = result.current.showApprovalModal()
      })

      // Call onApprove with ctx_len
      act(() => {
        result.current.modalProps?.onApprove('ctx_len')
      })

      const approvalResult = await approvalPromise!
      expect(approvalResult).toBe('ctx_len')
      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })

    it('should resolve with "context_shift" when onApprove is called with context_shift', async () => {
      const { result } = renderHook(() => useContextSizeApproval())

      // Start the async operation
      let approvalPromise: Promise<'ctx_len' | 'context_shift' | undefined>

      act(() => {
        approvalPromise = result.current.showApprovalModal()
      })

      // Call onApprove with context_shift
      act(() => {
        result.current.modalProps?.onApprove('context_shift')
      })

      const approvalResult = await approvalPromise!
      expect(approvalResult).toBe('context_shift')
      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })

    it('should resolve with undefined when onDeny is called', async () => {
      const { result } = renderHook(() => useContextSizeApproval())

      // Start the async operation
      let approvalPromise: Promise<'ctx_len' | 'context_shift' | undefined>

      act(() => {
        approvalPromise = result.current.showApprovalModal()
      })

      // Call onDeny
      act(() => {
        result.current.modalProps?.onDeny()
      })

      const approvalResult = await approvalPromise!
      expect(approvalResult).toBeUndefined()
      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })

    it('should handle multiple sequential approval requests', async () => {
      const { result } = renderHook(() => useContextSizeApproval())

      // First request
      let firstPromise: Promise<'ctx_len' | 'context_shift' | undefined>
      act(() => {
        firstPromise = result.current.showApprovalModal()
      })

      act(() => {
        result.current.modalProps?.onApprove('ctx_len')
      })

      const firstResult = await firstPromise!
      expect(firstResult).toBe('ctx_len')

      // Second request
      let secondPromise: Promise<'ctx_len' | 'context_shift' | undefined>
      act(() => {
        secondPromise = result.current.showApprovalModal()
      })

      act(() => {
        result.current.modalProps?.onDeny()
      })

      const secondResult = await secondPromise!
      expect(secondResult).toBeUndefined()
    })

    it('should handle approval modal when modal is closed externally', async () => {
      const { result } = renderHook(() => useContextSizeApproval())

      // Start the async operation
      let approvalPromise: Promise<'ctx_len' | 'context_shift' | undefined>

      act(() => {
        approvalPromise = result.current.showApprovalModal()
      })

      expect(result.current.isModalOpen).toBe(true)

      // Close modal externally
      act(() => {
        result.current.closeModal()
      })

      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })
  })

  describe('state management', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useContextSizeApproval())
      const { result: result2 } = renderHook(() => useContextSizeApproval())

      act(() => {
        result1.current.setModalOpen(true)
      })

      expect(result2.current.isModalOpen).toBe(true)

      act(() => {
        result1.current.closeModal()
      })

      expect(result2.current.isModalOpen).toBe(false)
    })
  })

  describe('complex scenarios', () => {
    it('should handle rapid open/close operations', () => {
      const { result } = renderHook(() => useContextSizeApproval())

      // Rapid operations
      act(() => {
        result.current.setModalOpen(true)
        result.current.setModalOpen(false)
        result.current.setModalOpen(true)
      })

      expect(result.current.isModalOpen).toBe(true)

      act(() => {
        result.current.closeModal()
      })

      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })

    it('should handle concurrent approval modal requests', async () => {
      const { result } = renderHook(() => useContextSizeApproval())

      // Start first request
      let firstPromise: Promise<'ctx_len' | 'context_shift' | undefined>
      act(() => {
        firstPromise = result.current.showApprovalModal()
      })

      const firstProps = result.current.modalProps

      // Start second request (should overwrite first)
      let secondPromise: Promise<'ctx_len' | 'context_shift' | undefined>
      act(() => {
        secondPromise = result.current.showApprovalModal()
      })

      const secondProps = result.current.modalProps

      // Props should be different instances
      expect(firstProps).not.toBe(secondProps)

      // Resolve second request
      act(() => {
        result.current.modalProps?.onApprove('context_shift')
      })

      const secondResult = await secondPromise!
      expect(secondResult).toBe('context_shift')
    })
  })
})
