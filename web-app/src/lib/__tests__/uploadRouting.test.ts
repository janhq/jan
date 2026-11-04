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
    expect(routed.imagesAsDocuments).toBe(0)
  })

  it('falls back to documents for media the model cannot take, and counts images', () => {
    const routed = routeUploadPaths(
      ['/a/photo.jpg', '/a/clip.wav', '/a/movie.mp4'],
      none
    )
    expect(routed.image).toEqual([])
    expect(routed.audio).toEqual([])
    expect(routed.video).toEqual([])
    expect(routed.documents).toEqual(['/a/photo.jpg', '/a/clip.wav', '/a/movie.mp4'])
    expect(routed.imagesAsDocuments).toBe(1)
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
