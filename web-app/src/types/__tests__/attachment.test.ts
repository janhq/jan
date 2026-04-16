import { describe, it, expect } from 'vitest'
import {
  createImageAttachment,
  createDocumentAttachment,
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

  it('passes through optional fileType, size, parseMode', () => {
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
