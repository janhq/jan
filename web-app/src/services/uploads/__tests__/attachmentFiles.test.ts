import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}))

import { invoke } from '@tauri-apps/api/core'
import { DefaultUploadsService } from '../default'

// Bytes that are not valid UTF-8, so a text round-trip would corrupt them.
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80])

const serveFile = (bytes: Uint8Array | null) =>
  vi.fn(async () =>
    bytes ? new Response(bytes, { status: 200 }) : new Response('', { status: 404 })
  )

describe('DefaultUploadsService attachment files', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // A file sent to the model as it is must stay readable for later turns,
  // even if the user moves or deletes the original.
  it('keeps a copy of the file in Jan\'s data folder and returns its path', async () => {
    const fetchMock = serveFile(PDF_BYTES)
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(invoke).mockResolvedValue('D:/jan-data/attachments/01J/report.pdf')

    const path = await new DefaultUploadsService().keepAttachmentFile(
      'C:/Users/me/Documents/report.pdf',
      'report.pdf'
    )

    expect(path).toBe('D:/jan-data/attachments/01J/report.pdf')
    expect(fetchMock).toHaveBeenCalledWith(
      `asset://localhost/${encodeURIComponent('C:/Users/me/Documents/report.pdf')}`
    )
    expect(invoke).toHaveBeenCalledWith('save_attachment_file', {
      fileName: 'report.pdf',
      dataBase64: Buffer.from(PDF_BYTES).toString('base64'),
    })
  })

  it('reads a kept file as a data URL for the model', async () => {
    vi.stubGlobal('fetch', serveFile(PDF_BYTES))

    const url = await new DefaultUploadsService().readAttachmentAsDataUrl(
      'D:/jan-data/attachments/01J/report.pdf',
      'application/pdf'
    )

    expect(url).toBe(
      `data:application/pdf;base64,${Buffer.from(PDF_BYTES).toString('base64')}`
    )
  })

  it('fails when the file cannot be read', async () => {
    vi.stubGlobal('fetch', serveFile(null))

    await expect(
      new DefaultUploadsService().readAttachmentAsDataUrl('D:/gone.pdf', 'application/pdf')
    ).rejects.toThrow()
    expect(invoke).not.toHaveBeenCalled()
  })
})
