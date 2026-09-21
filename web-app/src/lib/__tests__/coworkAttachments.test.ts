import { describe, expect, it, vi } from 'vitest'
import {
  importAttachedFiles,
  withAttachedFiles,
} from '@/lib/coworkAttachments'
import type { CoworkAttachedFile } from '@/types/coworkSession'

const pdf: CoworkAttachedFile = {
  name: 'spec.pdf',
  path: '/home/me/spec.pdf',
  fileType: 'pdf',
  size: 10,
}

describe('importAttachedFiles', () => {
  it('parses then imports each file, recording the workspace copies', async () => {
    const parse = vi.fn().mockResolvedValue('the words')
    const importFile = vi.fn().mockResolvedValue({
      path: '/ws/attachments/spec.pdf',
      textPath: '/ws/attachments/spec.pdf.txt',
    })
    const out = await importAttachedFiles([pdf], { parse, importFile })
    expect(parse).toHaveBeenCalledWith('/home/me/spec.pdf', 'pdf')
    expect(importFile).toHaveBeenCalledWith('/home/me/spec.pdf', 'the words')
    expect(out).toEqual([
      {
        ...pdf,
        workspacePath: '/ws/attachments/spec.pdf',
        textPath: '/ws/attachments/spec.pdf.txt',
      },
    ])
  })

  it('imports without text when the parser has nothing to say', async () => {
    const parse = vi.fn().mockResolvedValue('')
    const importFile = vi
      .fn()
      .mockResolvedValue({ path: '/ws/attachments/a.bin', textPath: null })
    const out = await importAttachedFiles(
      [{ name: 'a.bin', path: '/x/a.bin' }],
      { parse, importFile }
    )
    expect(importFile).toHaveBeenCalledWith('/x/a.bin', undefined)
    expect(out[0]).toEqual({
      name: 'a.bin',
      path: '/x/a.bin',
      workspacePath: '/ws/attachments/a.bin',
    })
  })

  it('skips a file already in the workspace (a re-ask)', async () => {
    const parse = vi.fn()
    const importFile = vi.fn()
    const done = { ...pdf, workspacePath: '/ws/attachments/spec.pdf' }
    const out = await importAttachedFiles([done], { parse, importFile })
    expect(parse).not.toHaveBeenCalled()
    expect(importFile).not.toHaveBeenCalled()
    expect(out).toEqual([done])
  })

  it('keeps a file whose import failed, unimported, so the prompt can say so', async () => {
    const parse = vi.fn().mockRejectedValue(new Error('no parser'))
    const importFile = vi.fn().mockResolvedValue(null)
    const out = await importAttachedFiles([pdf], { parse, importFile })
    expect(importFile).toHaveBeenCalledWith('/home/me/spec.pdf', undefined)
    expect(out).toEqual([pdf])
  })
})

describe('withAttachedFiles', () => {
  it('returns the question untouched with nothing attached', () => {
    expect(withAttachedFiles('hi', undefined)).toBe('hi')
    expect(withAttachedFiles('hi', [])).toBe('hi')
  })

  it('names the copy and its extracted text, and flags a failed import', () => {
    const text = withAttachedFiles('summarize', [
      {
        ...pdf,
        workspacePath: '/ws/attachments/spec.pdf',
        textPath: '/ws/attachments/spec.pdf.txt',
      },
      { name: 'raw.bin', path: '/x/raw.bin', workspacePath: '/ws/attachments/raw.bin' },
      { name: 'gone.pdf', path: '/x/gone.pdf' },
    ])
    expect(text.startsWith('summarize\n\n')).toBe(true)
    expect(text).toContain('- spec.pdf: /ws/attachments/spec.pdf (extracted text: /ws/attachments/spec.pdf.txt)')
    expect(text).toContain('- raw.bin: /ws/attachments/raw.bin')
    expect(text).toContain('- gone.pdf: could not be copied into the workspace')
    expect(text).not.toContain('[ATTACHED_FILES]')
  })
})
