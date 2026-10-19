import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { useAttachmentIngestionPrompt } from '../useAttachmentIngestionPrompt'

describe('useAttachmentIngestionPrompt', () => {
  afterEach(() => {
    while (useAttachmentIngestionPrompt.getState().resolver) useAttachmentIngestionPrompt.getState().cancel()
  })
  beforeEach(() => {
    useAttachmentIngestionPrompt.setState({
      isModalOpen: false,
      currentAttachment: null,
      currentIndex: 0,
      totalCount: 0,
      resolver: null,
    })
  })

  it('starts with modal closed', () => {
    const state = useAttachmentIngestionPrompt.getState()
    expect(state.isModalOpen).toBe(false)
    expect(state.currentAttachment).toBeNull()
  })

  it('queues concurrent prompts without overwriting the visible choice or resolver', async () => {
    const store = useAttachmentIngestionPrompt.getState()
    const first = store.showPrompt({ name: 'first.pdf', size: 1 }, 0, 2)
    const second = store.showPrompt({ name: 'second.pdf', size: 2 }, 1, 3)
    expect(useAttachmentIngestionPrompt.getState().currentAttachment?.name).toBe('first.pdf')
    store.choose('inline')
    expect(await first).toBe('inline')
    expect(useAttachmentIngestionPrompt.getState().currentAttachment?.name).toBe('second.pdf')
    expect(useAttachmentIngestionPrompt.getState().currentIndex).toBe(1)
    expect(useAttachmentIngestionPrompt.getState().totalCount).toBe(3)
    store.choose('embeddings')
    expect(await second).toBe('embeddings')
    expect(useAttachmentIngestionPrompt.getState().isModalOpen).toBe(false)
  })

  it('cancels the displayed request without cancelling a queued request', async () => {
    const store = useAttachmentIngestionPrompt.getState()
    const first = store.showPrompt({ name: 'cancel.pdf', size: 1 }, 0, 1)
    const second = store.showPrompt({ name: 'keep.pdf', size: 2 }, 0, 1)
    expect(useAttachmentIngestionPrompt.getState().currentAttachment?.name).toBe('cancel.pdf')
    store.cancel()
    expect(await first).toBeUndefined()
    expect(useAttachmentIngestionPrompt.getState().isModalOpen).toBe(true)
    store.choose('inline')
    expect(await second).toBe('inline')
  })

  it('preserves FIFO order when another request arrives while a batch is queued', async () => {
    const store = useAttachmentIngestionPrompt.getState()
    const first = store.showPrompt({ name: 'a', size: 1 }, 0, 1)
    const second = store.showPrompt({ name: 'b', size: 1 }, 0, 1)
    expect(useAttachmentIngestionPrompt.getState().currentAttachment?.name).toBe('a')
    store.choose('inline')
    const third = store.showPrompt({ name: 'c', size: 1 }, 0, 1)
    expect(useAttachmentIngestionPrompt.getState().currentAttachment?.name).toBe('b')
    store.choose('embeddings')
    expect(useAttachmentIngestionPrompt.getState().currentAttachment?.name).toBe('c')
    store.cancel()
    expect(await Promise.all([first, second, third])).toEqual(['inline', 'embeddings', undefined])
  })

  it('showPrompt opens modal and sets attachment info', async () => {
    const attachment = { name: 'test.pdf', size: 1024 }

    // Don't await — it blocks until choose/cancel is called
    const promise = useAttachmentIngestionPrompt
      .getState()
      .showPrompt(attachment, 0, 3)

    const state = useAttachmentIngestionPrompt.getState()
    expect(state.isModalOpen).toBe(true)
    expect(state.currentAttachment).toEqual(attachment)
    expect(state.currentIndex).toBe(0)
    expect(state.totalCount).toBe(3)

    // Resolve it so the test doesn't hang
    act(() => {
      useAttachmentIngestionPrompt.getState().choose('inline')
    })

    const result = await promise
    expect(result).toBe('inline')
  })

  it('choose resolves the promise with the selected mode', async () => {
    const promise = useAttachmentIngestionPrompt
      .getState()
      .showPrompt({ name: 'doc.pdf', size: 100 }, 0, 1)

    act(() => {
      useAttachmentIngestionPrompt.getState().choose('embeddings')
    })

    expect(await promise).toBe('embeddings')
    expect(useAttachmentIngestionPrompt.getState().isModalOpen).toBe(false)
  })

  it('cancel resolves with undefined', async () => {
    const promise = useAttachmentIngestionPrompt
      .getState()
      .showPrompt({ name: 'doc.pdf', size: 100 }, 0, 1)

    act(() => {
      useAttachmentIngestionPrompt.getState().cancel()
    })

    expect(await promise).toBeUndefined()
    expect(useAttachmentIngestionPrompt.getState().isModalOpen).toBe(false)
  })

  it('handles sequential prompts for multiple documents', async () => {
    const docs = [
      { name: 'a.pdf', size: 100 },
      { name: 'b.pdf', size: 200 },
    ]
    const choices: Array<'inline' | 'embeddings' | undefined> = []

    for (let i = 0; i < docs.length; i++) {
      const promise = useAttachmentIngestionPrompt
        .getState()
        .showPrompt(docs[i], i, docs.length)

      expect(useAttachmentIngestionPrompt.getState().currentIndex).toBe(i)
      expect(useAttachmentIngestionPrompt.getState().totalCount).toBe(
        docs.length
      )

      act(() => {
        useAttachmentIngestionPrompt
          .getState()
          .choose(i === 0 ? 'inline' : 'embeddings')
      })

      choices.push(await promise)
    }

    expect(choices).toEqual(['inline', 'embeddings'])
  })
})
