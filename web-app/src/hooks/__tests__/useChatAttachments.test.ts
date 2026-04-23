import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from '../useChatAttachments'
import type { Attachment } from '@/types/attachment'

const docAttachment = (
  overrides: Partial<Attachment> = {}
): Attachment => ({
  name: 'test.pdf',
  type: 'document',
  path: '/tmp/test.pdf',
  fileType: 'pdf',
  ...overrides,
})

const imageAttachment = (
  overrides: Partial<Attachment> = {}
): Attachment => ({
  name: 'photo.jpg',
  type: 'image',
  mimeType: 'image/jpeg',
  ...overrides,
})

describe('useChatAttachments', () => {
  beforeEach(() => {
    // Reset the store between tests
    useChatAttachments.setState({ attachmentsByThread: {} })
  })

  describe('getAttachments', () => {
    it('returns empty array for unknown thread', () => {
      const result = useChatAttachments.getState().getAttachments('unknown')
      expect(result).toEqual([])
    })

    it('defaults to NEW_THREAD_ATTACHMENT_KEY when no threadId given', () => {
      const doc = docAttachment()
      act(() => {
        useChatAttachments
          .getState()
          .setAttachments(NEW_THREAD_ATTACHMENT_KEY, [doc])
      })
      expect(useChatAttachments.getState().getAttachments()).toEqual([doc])
    })
  })

  describe('setAttachments', () => {
    it('sets attachments for a thread with an array', () => {
      const doc = docAttachment()
      act(() => {
        useChatAttachments.getState().setAttachments('thread-1', [doc])
      })
      expect(useChatAttachments.getState().getAttachments('thread-1')).toEqual([
        doc,
      ])
    })

    it('supports functional updater', () => {
      const doc1 = docAttachment({ name: 'a.pdf' })
      const doc2 = docAttachment({ name: 'b.pdf' })
      act(() => {
        useChatAttachments.getState().setAttachments('thread-1', [doc1])
      })
      act(() => {
        useChatAttachments
          .getState()
          .setAttachments('thread-1', (prev) => [...prev, doc2])
      })
      expect(
        useChatAttachments.getState().getAttachments('thread-1')
      ).toHaveLength(2)
    })

    it('can update parseMode on existing attachments', () => {
      const doc = docAttachment({ parseMode: 'auto' })
      act(() => {
        useChatAttachments
          .getState()
          .setAttachments(NEW_THREAD_ATTACHMENT_KEY, [doc])
      })
      act(() => {
        useChatAttachments
          .getState()
          .setAttachments(NEW_THREAD_ATTACHMENT_KEY, (prev) =>
            prev.map((a) => ({ ...a, parseMode: 'embeddings' as const }))
          )
      })
      const result = useChatAttachments
        .getState()
        .getAttachments(NEW_THREAD_ATTACHMENT_KEY)
      expect(result[0].parseMode).toBe('embeddings')
    })
  })

  describe('clearAttachments', () => {
    it('removes all attachments for a thread', () => {
      act(() => {
        useChatAttachments
          .getState()
          .setAttachments('thread-1', [docAttachment()])
      })
      act(() => {
        useChatAttachments.getState().clearAttachments('thread-1')
      })
      expect(useChatAttachments.getState().getAttachments('thread-1')).toEqual(
        []
      )
    })

    it('does not affect other threads', () => {
      const doc1 = docAttachment({ name: 'a.pdf' })
      const doc2 = docAttachment({ name: 'b.pdf' })
      act(() => {
        useChatAttachments.getState().setAttachments('thread-1', [doc1])
        useChatAttachments.getState().setAttachments('thread-2', [doc2])
      })
      act(() => {
        useChatAttachments.getState().clearAttachments('thread-1')
      })
      expect(useChatAttachments.getState().getAttachments('thread-1')).toEqual(
        []
      )
      expect(
        useChatAttachments.getState().getAttachments('thread-2')
      ).toEqual([doc2])
    })
  })

  describe('transferAttachments', () => {
    it('moves attachments from source to destination key', () => {
      const doc = docAttachment()
      act(() => {
        useChatAttachments
          .getState()
          .setAttachments(NEW_THREAD_ATTACHMENT_KEY, [doc])
      })
      act(() => {
        useChatAttachments
          .getState()
          .transferAttachments(NEW_THREAD_ATTACHMENT_KEY, 'thread-1')
      })

      // Source is empty
      expect(
        useChatAttachments
          .getState()
          .getAttachments(NEW_THREAD_ATTACHMENT_KEY)
      ).toEqual([])
      // Destination has the attachments
      expect(useChatAttachments.getState().getAttachments('thread-1')).toEqual([
        doc,
      ])
    })

    it('does not overwrite existing destination attachments', () => {
      const doc1 = docAttachment({ name: 'existing.pdf' })
      const doc2 = docAttachment({ name: 'transferred.pdf' })
      act(() => {
        useChatAttachments.getState().setAttachments('thread-1', [doc1])
        useChatAttachments
          .getState()
          .setAttachments(NEW_THREAD_ATTACHMENT_KEY, [doc2])
      })
      act(() => {
        useChatAttachments
          .getState()
          .transferAttachments(NEW_THREAD_ATTACHMENT_KEY, 'thread-1')
      })
      // Existing destination is preserved
      expect(useChatAttachments.getState().getAttachments('thread-1')).toEqual([
        doc1,
      ])
    })

    it('is a no-op when source is empty', () => {
      const doc = docAttachment()
      act(() => {
        useChatAttachments.getState().setAttachments('thread-1', [doc])
      })
      act(() => {
        useChatAttachments
          .getState()
          .transferAttachments(NEW_THREAD_ATTACHMENT_KEY, 'thread-1')
      })
      // Destination unchanged
      expect(useChatAttachments.getState().getAttachments('thread-1')).toEqual([
        doc,
      ])
    })

    it('preserves parseMode choices through transfer', () => {
      const doc = docAttachment({ parseMode: 'embeddings' })
      act(() => {
        useChatAttachments
          .getState()
          .setAttachments(NEW_THREAD_ATTACHMENT_KEY, [doc])
      })
      act(() => {
        useChatAttachments
          .getState()
          .transferAttachments(NEW_THREAD_ATTACHMENT_KEY, 'thread-1')
      })
      const transferred =
        useChatAttachments.getState().getAttachments('thread-1')
      expect(transferred[0].parseMode).toBe('embeddings')
    })
  })
})
