import { describe, it, expect, beforeEach } from 'vitest'
import {
  useFailedDrafts,
  mergeRestoredAttachments,
} from '../failed-draft-store'
import { useMessageQueue } from '../message-queue-store'

const file = (name: string, extra: object = {}) =>
  ({ name, type: 'document', path: `/${name}`, ...extra }) as never

describe('useFailedDrafts', () => {
  beforeEach(() => {
    useFailedDrafts.setState({ drafts: {} })
    useMessageQueue.setState({ queues: {} })
  })

  it('stores text and an attachment snapshot as one entry per thread', () => {
    const attachments = [file('a.pdf')]
    const entry = useFailedDrafts
      .getState()
      .add('t1', { text: 'hello', attachments })
    attachments.push(file('later.pdf'))
    expect(entry?.attachments).toEqual([file('a.pdf')])
    expect(useFailedDrafts.getState().getDrafts('t1')).toHaveLength(1)
    expect(useFailedDrafts.getState().getDrafts('t2')).toEqual([])
  })

  it('ignores a draft with neither text nor files', () => {
    expect(
      useFailedDrafts.getState().add('t1', { text: '  ', attachments: [] })
    ).toBeUndefined()
    expect(useFailedDrafts.getState().drafts).toEqual({})
  })

  it('keeps files-only and text-only drafts', () => {
    useFailedDrafts.getState().add('t1', { text: '', attachments: [file('a')] })
    useFailedDrafts.getState().add('t1', { text: 'x', attachments: [] })
    expect(useFailedDrafts.getState().getDrafts('t1')).toHaveLength(2)
  })

  it('removes one entry and drops the empty thread key', () => {
    const a = useFailedDrafts.getState().add('t1', { text: 'a', attachments: [] })!
    const b = useFailedDrafts.getState().add('t1', { text: 'b', attachments: [] })!
    useFailedDrafts.getState().remove('t1', a.id)
    expect(useFailedDrafts.getState().getDrafts('t1')).toEqual([b])
    useFailedDrafts.getState().remove('t1', b.id)
    expect(useFailedDrafts.getState().drafts).toEqual({})
  })

  it('never touches the auto-send queue', () => {
    useFailedDrafts.getState().add('t1', { text: 'a', attachments: [file('f')] })
    expect(useMessageQueue.getState().getQueue('t1')).toEqual([])
  })

  it('merges restored attachments ahead, without duplicating newer ones', () => {
    const old = file('a')
    const newer = file('b')
    expect(mergeRestoredAttachments([old, old], [newer])).toEqual([old, newer])
    const newerCopy = file('a', { processed: true })
    expect(mergeRestoredAttachments([old], [newerCopy, newer])).toEqual([
      newerCopy,
      newer,
    ])
  })
})
