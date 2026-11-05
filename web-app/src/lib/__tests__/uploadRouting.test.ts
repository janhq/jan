import { describe, it, expect } from 'vitest'
import { routeUploadPaths } from '../uploadRouting'

const all = { image: true, audio: true, video: true }
const none = { image: false, audio: false, video: false }

describe('routeUploadPaths', () => {
  it('sends each file type to the model when it can take it', () => {
    const routed = routeUploadPaths(
      ['/a/photo.PNG', '/a/clip.mp3', '/a/movie.mov', '/a/notes.md'],
      all
    )
    expect(routed.image).toEqual(['/a/photo.PNG'])
    expect(routed.audio).toEqual(['/a/clip.mp3'])
    expect(routed.video).toEqual(['/a/movie.mov'])
    expect(routed.documents).toEqual(['/a/notes.md'])
    expect(routed.rejected).toEqual([])
  })

  it('rejects images for a model without vision instead of routing them to document ingestion', () => {
    const routed = routeUploadPaths(
      ['/a/photo.jpg', '/a/clip.wav', '/a/movie.mp4', '/a/notes.md'],
      none
    )
    expect(routed.image).toEqual([])
    expect(routed.rejected).toEqual(['/a/photo.jpg'])
    // The RAG parser has no image branch, so an image must never reach it.
    expect(routed.documents).not.toContain('/a/photo.jpg')
    // Audio/video the model cannot take keep their existing document fallback.
    expect(routed.documents).toEqual(['/a/clip.wav', '/a/movie.mp4', '/a/notes.md'])
  })

  it('treats unknown and extensionless files as documents', () => {
    const routed = routeUploadPaths(['/a/Makefile', '/a/data.parquet'], all)
    expect(routed.documents).toEqual(['/a/Makefile', '/a/data.parquet'])
  })

  it('is independent per capability', () => {
    const routed = routeUploadPaths(['/a/p.jpg', '/a/c.mp3'], {
      image: true,
      audio: false,
      video: false,
    })
    expect(routed.image).toEqual(['/a/p.jpg'])
    expect(routed.documents).toEqual(['/a/c.mp3'])
  })
})
