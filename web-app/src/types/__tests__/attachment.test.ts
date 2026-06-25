import { describe, it, expect } from 'vitest'
import {
  createImageAttachment,
  createDocumentAttachment,
  createAudioAttachment,
} from '../attachment'

describe('createImageAttachment', () => {
  it('returns an image-typed attachment with all provided fields', () => {
    const result = createImageAttachment({
      name: 'photo.png',
      base64: 'AAA',
      dataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      size: 123,
    })
    expect(result).toEqual({
      name: 'photo.png',
      base64: 'AAA',
      dataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      size: 123,
      type: 'image',
    })
  })
})

describe('createDocumentAttachment', () => {
  it('returns a document-typed attachment with required fields', () => {
    const result = createDocumentAttachment({
      name: 'report.pdf',
      path: '/tmp/report.pdf',
    })
    expect(result).toEqual({
      name: 'report.pdf',
      path: '/tmp/report.pdf',
      type: 'document',
    })
  })

  it('passes through optional fileType, size, parseMode (doc)', () => {
    const result = createDocumentAttachment({
      name: 'a.docx',
      path: '/a.docx',
      fileType: 'docx',
      size: 500,
      parseMode: 'embeddings',
    })
    expect(result.fileType).toBe('docx')
    expect(result.size).toBe(500)
    expect(result.parseMode).toBe('embeddings')
    expect(result.type).toBe('document')
  })
})

describe('createAudioAttachment', () => {
  it('returns an audio-typed attachment with wav format', () => {
    const result = createAudioAttachment({
      name: 'clip.wav',
      base64: 'QkJC',
      dataUrl: 'data:audio/wav;base64,QkJC',
      mimeType: 'audio/wav',
      audioFormat: 'wav',
      size: 2048,
      durationSec: 4.2,
    })
    expect(result).toEqual({
      name: 'clip.wav',
      base64: 'QkJC',
      dataUrl: 'data:audio/wav;base64,QkJC',
      mimeType: 'audio/wav',
      audioFormat: 'wav',
      size: 2048,
      durationSec: 4.2,
      type: 'audio',
    })
  })

  it('supports mp3 format and omits durationSec when unknown', () => {
    const result = createAudioAttachment({
      name: 'song.mp3',
      base64: 'YWFh',
      dataUrl: 'data:audio/mpeg;base64,YWFh',
      mimeType: 'audio/mpeg',
      audioFormat: 'mp3',
      size: 9001,
    })
    expect(result.type).toBe('audio')
    expect(result.audioFormat).toBe('mp3')
    expect(result.durationSec).toBeUndefined()
  })
})
