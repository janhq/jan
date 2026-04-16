import { describe, it, expect } from 'vitest'
import {
  injectFilesIntoPrompt,
  extractFilesFromPrompt,
  type FileMetadata,
} from '../fileMetadata'

describe('injectFilesIntoPrompt', () => {
  it('returns prompt unchanged when no files', () => {
    expect(injectFilesIntoPrompt('hello', [])).toBe('hello')
  })

  it('returns prompt unchanged when files is empty array', () => {
    expect(injectFilesIntoPrompt('hello', [])).toBe('hello')
  })

  it('appends file metadata block', () => {
    const files: FileMetadata[] = [{ id: 'f1', name: 'doc.pdf' }]
    const result = injectFilesIntoPrompt('hello', files)
    expect(result).toContain('[ATTACHED_FILES]')
    expect(result).toContain('[/ATTACHED_FILES]')
    expect(result).toContain('file_id: f1')
    expect(result).toContain('name: doc.pdf')
  })

  it('includes optional fields when present', () => {
    const files: FileMetadata[] = [
      {
        id: 'f1',
        name: 'doc.pdf',
        type: 'application/pdf',
        size: 1024,
        chunkCount: 5,
        injectionMode: 'embeddings',
      },
    ]
    const result = injectFilesIntoPrompt('hello', files)
    expect(result).toContain('type: application/pdf')
    expect(result).toContain('size: 1024')
    expect(result).toContain('chunks: 5')
    expect(result).toContain('mode: embeddings')
  })

  it('handles multiple files', () => {
    const files: FileMetadata[] = [
      { id: 'f1', name: 'a.txt' },
      { id: 'f2', name: 'b.txt' },
    ]
    const result = injectFilesIntoPrompt('prompt', files)
    expect(result).toContain('file_id: f1')
    expect(result).toContain('file_id: f2')
  })
})

describe('extractFilesFromPrompt', () => {
  it('returns empty files and original prompt when no metadata', () => {
    const result = extractFilesFromPrompt('hello world')
    expect(result.files).toEqual([])
    expect(result.cleanPrompt).toBe('hello world')
  })

  it('extracts files from injected prompt', () => {
    const prompt = injectFilesIntoPrompt('hello', [
      { id: 'f1', name: 'doc.pdf', type: 'pdf', size: 100, chunkCount: 3, injectionMode: 'inline' },
    ])
    const result = extractFilesFromPrompt(prompt)
    expect(result.cleanPrompt).toBe('hello')
    expect(result.files).toHaveLength(1)
    expect(result.files[0].id).toBe('f1')
    expect(result.files[0].name).toBe('doc.pdf')
    expect(result.files[0].type).toBe('pdf')
    expect(result.files[0].size).toBe(100)
    expect(result.files[0].chunkCount).toBe(3)
    expect(result.files[0].injectionMode).toBe('inline')
  })

  it('handles missing end tag', () => {
    const prompt = 'hello\n\n[ATTACHED_FILES]\n- file_id: f1, name: test'
    const result = extractFilesFromPrompt(prompt)
    expect(result.files).toEqual([])
    expect(result.cleanPrompt).toBe(prompt)
  })

  it('skips lines without id or name', () => {
    const prompt = 'hello\n\n[ATTACHED_FILES]\n- no_id: x\n- file_id: f1, name: ok\n[/ATTACHED_FILES]'
    const result = extractFilesFromPrompt(prompt)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].name).toBe('ok')
  })

  it('handles embeddings injectionMode', () => {
    const prompt = injectFilesIntoPrompt('test', [
      { id: 'f1', name: 'a.txt', injectionMode: 'embeddings' },
    ])
    const result = extractFilesFromPrompt(prompt)
    expect(result.files[0].injectionMode).toBe('embeddings')
  })

  it('ignores invalid injectionMode', () => {
    const prompt = 'test\n\n[ATTACHED_FILES]\n- file_id: f1, name: a.txt, mode: invalid\n[/ATTACHED_FILES]'
    const result = extractFilesFromPrompt(prompt)
    expect(result.files[0].injectionMode).toBeUndefined()
  })

  it('handles roundtrip with multiple files', () => {
    const original: FileMetadata[] = [
      { id: 'f1', name: 'a.pdf', size: 100 },
      { id: 'f2', name: 'b.txt', type: 'text' },
    ]
    const prompt = injectFilesIntoPrompt('my message', original)
    const result = extractFilesFromPrompt(prompt)
    expect(result.cleanPrompt).toBe('my message')
    expect(result.files).toHaveLength(2)
    expect(result.files[0].id).toBe('f1')
    expect(result.files[1].id).toBe('f2')
  })
})
