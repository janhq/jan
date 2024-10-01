// Thread.atom.test.ts

import { act, renderHook } from '@testing-library/react'
import * as ThreadAtoms from './Thread.atom'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

describe('Thread.atom.ts', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('threadStatesAtom', () => {
    it('should initialize as an empty object', () => {
      const { result: threadStatesAtom } = renderHook(() =>
        useAtom(ThreadAtoms.threadsAtom)
      )
      expect(threadStatesAtom.current[0]).toEqual([])
    })
  })

  describe('threadsAtom', () => {
    it('should initialize as an empty array', () => {
      const { result: threadsAtom } = renderHook(() =>
        useAtom(ThreadAtoms.threadsAtom)
      )
      expect(threadsAtom.current[0]).toEqual([])
    })
  })

  describe('threadDataReadyAtom', () => {
    it('should initialize as false', () => {
      const { result: threadDataReadyAtom } = renderHook(() =>
        useAtom(ThreadAtoms.threadsAtom)
      )
      expect(threadDataReadyAtom.current[0]).toEqual([])
    })
  })

  describe('activeThreadIdAtom', () => {
    it('should set and get active thread id', () => {
      const { result: getAtom } = renderHook(() =>
        useAtomValue(ThreadAtoms.getActiveThreadIdAtom)
      )
      const { result: setAtom } = renderHook(() =>
        useSetAtom(ThreadAtoms.setActiveThreadIdAtom)
      )

      expect(getAtom.current).toBeUndefined()

      act(() => {
        setAtom.current('thread-1')
      })

      expect(getAtom.current).toBe('thread-1')
    })
  })

  describe('activeThreadAtom', () => {
    it('should return the active thread', () => {
      const { result: threadsAtom } = renderHook(() =>
        useAtom(ThreadAtoms.threadsAtom)
      )
      const { result: setActiveThreadId } = renderHook(() =>
        useSetAtom(ThreadAtoms.setActiveThreadIdAtom)
      )
      const { result: activeThread } = renderHook(() =>
        useAtomValue(ThreadAtoms.activeThreadAtom)
      )

      act(() => {
        threadsAtom.current[1]([
          { id: 'thread-1', title: 'Test Thread' },
        ] as any)
        setActiveThreadId.current('thread-1')
      })

      expect(activeThread.current).toEqual({
        id: 'thread-1',
        title: 'Test Thread',
      })
    })
  })

  describe('updateThreadAtom', () => {
    it('should update an existing thread', () => {
      const { result: threadsAtom } = renderHook(() =>
        useAtom(ThreadAtoms.threadsAtom)
      )
      const { result: updateThread } = renderHook(() =>
        useSetAtom(ThreadAtoms.updateThreadAtom)
      )

      act(() => {
        threadsAtom.current[1]([
          {
            id: 'thread-1',
            title: 'Old Title',
            updated: new Date('2023-01-01').toISOString(),
          },
          {
            id: 'thread-2',
            title: 'Thread 2',
            updated: new Date('2023-01-02').toISOString(),
          },
        ] as any)
      })

      act(() => {
        updateThread.current({
          id: 'thread-1',
          title: 'New Title',
          updated: new Date('2023-01-03').toISOString(),
        } as any)
      })

      expect(threadsAtom.current[0]).toEqual([
        {
          id: 'thread-1',
          title: 'New Title',
          updated: new Date('2023-01-03').toISOString(),
        },
        {
          id: 'thread-2',
          title: 'Thread 2',
          updated: new Date('2023-01-02').toISOString(),
        },
      ])
    })
  })

  describe('setThreadModelParamsAtom', () => {
    it('should set thread model params', () => {
      const { result: paramsAtom } = renderHook(() =>
        useAtom(ThreadAtoms.threadModelParamsAtom)
      )
      const { result: setParams } = renderHook(() =>
        useSetAtom(ThreadAtoms.setThreadModelParamsAtom)
      )

      act(() => {
        setParams.current('thread-1', { modelName: 'gpt-3' } as any)
      })

      expect(paramsAtom.current[0]).toEqual({
        'thread-1': { modelName: 'gpt-3' },
      })
    })
  })

  describe('deleteThreadStateAtom', () => {
    it('should delete a thread state', () => {
      const { result: statesAtom } = renderHook(() =>
        useAtom(ThreadAtoms.threadStatesAtom)
      )
      const { result: deleteState } = renderHook(() =>
        useSetAtom(ThreadAtoms.deleteThreadStateAtom)
      )

      act(() => {
        statesAtom.current[1]({
          'thread-1': { lastMessage: 'Hello' },
          'thread-2': { lastMessage: 'Hi' },
        } as any)
      })

      act(() => {
        deleteState.current('thread-1')
      })

      expect(statesAtom.current[0]).toEqual({
        'thread-2': { lastMessage: 'Hi' },
      })
    })
  })

  describe('modalActionThreadAtom', () => {
    it('should initialize with undefined values', () => {
      const { result } = renderHook(() =>
        useAtomValue(ThreadAtoms.modalActionThreadAtom)
      )
      expect(result.current).toEqual({
        showModal: undefined,
        thread: undefined,
      })
    })
  })
})
