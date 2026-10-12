import { describe, it, expect } from 'vitest'
import { ContentType } from '@janhq/core'
import { newUserThreadContent } from '../completion'
import type { Attachment } from '@/types/attachment'

describe('newUserThreadContent — audio attachments', () => {
  it('emits an input_audio content part for wav audio', () => {
    const audio: Attachment = {
      name: 'clip.wav',
      type: 'audio',
      base64: 'QUFB',
      audioFormat: 'wav',
      mimeType: 'audio/wav',
      dataUrl: 'data:audio/wav;base64,QUFB',
      size: 1024,
    }
    const msg = newUserThreadContent('t1', 'hello', [audio], 'm1')
    const audioPart = msg.content.find(
      (c) => c.type === ContentType.InputAudio
    ) as any
    expect(audioPart).toBeDefined()
    expect(audioPart.input_audio).toEqual({ data: 'QUFB', format: 'wav' })
  })

  it('emits an input_audio content part for mp3 audio', () => {
    const audio: Attachment = {
      name: 'song.mp3',
      type: 'audio',
      base64: 'WlpaWg==',
      audioFormat: 'mp3',
      mimeType: 'audio/mpeg',
      dataUrl: 'data:audio/mpeg;base64,WlpaWg==',
      size: 2048,
    }
    const msg = newUserThreadContent('t1', 'listen', [audio])
    const audioPart = msg.content.find(
      (c) => c.type === ContentType.InputAudio
    ) as any
    expect(audioPart.input_audio).toEqual({ data: 'WlpaWg==', format: 'mp3' })
  })

  it('skips audio attachments missing base64 or format', () => {
    const broken: Attachment = {
      name: 'broken.wav',
      type: 'audio',
      audioFormat: 'wav',
      mimeType: 'audio/wav',
      size: 10,
    }
    const msg = newUserThreadContent('t1', 'hi', [broken])
    expect(msg.content.some((c) => c.type === ContentType.InputAudio)).toBe(
      false
    )
  })

  it('coexists with text and image attachments', () => {
    const image: Attachment = {
      name: 'pic.png',
      type: 'image',
      base64: 'AAA',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AAA',
      size: 100,
    }
    const audio: Attachment = {
      name: 'clip.wav',
      type: 'audio',
      base64: 'QUFB',
      audioFormat: 'wav',
      mimeType: 'audio/wav',
      dataUrl: 'data:audio/wav;base64,QUFB',
      size: 1024,
    }
    const msg = newUserThreadContent('t1', 'with both', [image, audio], 'm1')
    const types = msg.content.map((c) => c.type)
    expect(types).toContain(ContentType.Text)
    expect(types).toContain(ContentType.Image)
    expect(types).toContain(ContentType.InputAudio)
  })
})

// A PDF sent to the model as it is is recorded by where Jan keeps it, not by
// its contents, so the thread stays small and the file is read when sent.
describe('newUserThreadContent — PDFs sent as they are', () => {
  it('records where the PDF is kept and lists it among the files', () => {
    const doc: Attachment = {
      name: 'report.pdf',
      type: 'document',
      fileType: 'pdf',
      size: 1234,
      path: 'D:/jan-data/attachments/01J/report.pdf',
      processed: true,
      injectionMode: 'native',
    }

    const msg = newUserThreadContent('thread-1', 'summarise this', [doc], 'm1')

    expect(msg.metadata).toEqual({
      native_files: [
        {
          name: 'report.pdf',
          path: 'D:/jan-data/attachments/01J/report.pdf',
          media_type: 'application/pdf',
        },
      ],
    })
    const text = (msg.content[0] as { text: { value: string } }).text.value
    expect(text).toContain('name: report.pdf')
    expect(text).toContain('mode: native')
    expect(JSON.stringify(msg.content)).not.toContain('base64')
  })

  it('keeps inline documents next to PDFs sent as they are', () => {
    const msg = newUserThreadContent(
      'thread-1',
      'compare',
      [
        {
          name: 'report.pdf',
          type: 'document',
          fileType: 'pdf',
          path: 'D:/kept/report.pdf',
          processed: true,
          injectionMode: 'native',
        },
        {
          name: 'notes.txt',
          type: 'document',
          fileType: 'txt',
          processed: true,
          injectionMode: 'inline',
          inlineContent: 'some notes',
        },
      ],
      'm2'
    )

    expect(msg.metadata).toEqual({
      inline_file_contents: [{ name: 'notes.txt', content: 'some notes' }],
      native_files: [
        { name: 'report.pdf', path: 'D:/kept/report.pdf', media_type: 'application/pdf' },
      ],
    })
  })
})
