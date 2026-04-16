import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useAttachmentIngestionPrompt } from '../useAttachmentIngestionPrompt'

describe('useAttachmentIngestionPrompt', () => {
  beforeEach(() => {
    useAttachmentIngestionPrompt.setState({
      isModalOpen: false,
      currentAttachment: null,
      currentIndex: 0,
      totalCount: 0,
      sizeThreshold: 0,
      resolver: null,
    })
  })

  it('starts with modal closed', () => {
    const state = useAttachmentIngestionPrompt.getState()
    expect(state.isModalOpen).toBe(false)
    expect(state.currentAttachment).toBeNull()
  })

  it('showPrompt opens modal and sets attachment info', async () => {
    const attachment = { name: 'test.pdf', size: 1024 }

    // Don't await — it blocks until choose/cancel is called
    const promise = useAttachmentIngestionPrompt
      .getState()
      .showPrompt(attachment, 512_000, 0, 3)

    const state = useAttachmentIngestionPrompt.getState()
    expect(state.isModalOpen).toBe(true)
    expect(state.currentAttachment).toEqual(attachment)
    expect(state.currentIndex).toBe(0)
    expect(state.totalCount).toBe(3)
    expect(state.sizeThreshold).toBe(512_000)

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
      .showPrompt({ name: 'doc.pdf', size: 100 }, 1000, 0, 1)

    act(() => {
      useAttachmentIngestionPrompt.getState().choose('embeddings')
    })

    expect(await promise).toBe('embeddings')
    expect(useAttachmentIngestionPrompt.getState().isModalOpen).toBe(false)
  })

  it('cancel resolves with undefined', async () => {
    const promise = useAttachmentIngestionPrompt
      .getState()
      .showPrompt({ name: 'doc.pdf', size: 100 }, 1000, 0, 1)

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
        .showPrompt(docs[i], 1000, i, docs.length)

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
