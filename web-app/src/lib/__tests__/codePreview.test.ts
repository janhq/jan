import { describe, it, expect } from 'vitest'
import {
  previewKindFor,
  extensionOf,
  basenameOf,
  isAssetKind,
  unresolvedRefs,
  isSafeRelativePath,
} from '@/lib/codePreview'

describe('previewKindFor', () => {
  it('maps the renderable types', () => {
    expect(previewKindFor('a/index.html')).toBe('html')
    expect(previewKindFor('a/logo.svg')).toBe('svg')
    expect(previewKindFor('README.md')).toBe('markdown')
    expect(previewKindFor('shot.PNG')).toBe('image')
    expect(previewKindFor('clip.mp4')).toBe('video')
    expect(previewKindFor('main.rs')).toBe('text')
  })

  it('falls back to a file card for unknown and binary types', () => {
    // These must not be rendered as text — `read_file_sync` is
    // `read_to_string` and would fail on them anyway.
    expect(previewKindFor('deck.pptx')).toBe('file')
    expect(previewKindFor('report.pdf')).toBe('file')
    expect(previewKindFor('archive.zip')).toBe('file')
    expect(previewKindFor('bin/tool')).toBe('file')
  })

  it('treats a dotfile as having no extension, not an extension', () => {
    expect(extensionOf('.gitignore')).toBe('')
    expect(previewKindFor('.gitignore')).toBe('file')
  })

  it('reads the extension from the basename, not an earlier path segment', () => {
    expect(extensionOf('my.dir/file')).toBe('')
    expect(previewKindFor('v1.2/notes.md')).toBe('markdown')
  })

  it('handles windows separators', () => {
    expect(basenameOf('a\\b\\index.html')).toBe('index.html')
    expect(previewKindFor('a\\b\\index.html')).toBe('html')
  })

  it('routes only image/video through the asset protocol', () => {
    expect(isAssetKind('image')).toBe(true)
    expect(isAssetKind('video')).toBe(true)
    expect(isAssetKind('html')).toBe(false)
    expect(isAssetKind('text')).toBe(false)
  })
})

describe('unresolvedRefs', () => {
  // The pane renders into an opaque-origin sandbox with no base URL, so these
  // silently fail to load. Counting them is what lets us say so.
  it('counts relative src/href that the sandbox cannot resolve', () => {
    expect(unresolvedRefs('<img src="./logo.png">')).toBe(1)
    expect(unresolvedRefs('<link href="style.css"><script src="app.js">')).toBe(2)
    expect(unresolvedRefs("<img src='sub/dir/a.png'>")).toBe(1)
  })

  it('does not count anything that resolves on its own', () => {
    expect(unresolvedRefs('<img src="data:image/png;base64,AAA">')).toBe(0)
    expect(unresolvedRefs('<script src="https://cdn.example/x.js">')).toBe(0)
    expect(unresolvedRefs('<img src="//cdn.example/x.png">')).toBe(0)
    expect(unresolvedRefs('<a href="#section">x</a>')).toBe(0)
    expect(unresolvedRefs('<img src="blob:abc">')).toBe(0)
  })

  it('is zero for a self-contained page, which is the common generated case', () => {
    const page = `<html><style>body{color:red}</style><script>1</script></html>`
    expect(unresolvedRefs(page)).toBe(0)
  })

  it('ignores empty values', () => {
    expect(unresolvedRefs('<img src="">')).toBe(0)
  })
})

describe('isSafeRelativePath', () => {
  it('accepts ordinary project-relative paths', () => {
    expect(isSafeRelativePath('index.html')).toBe(true)
    expect(isSafeRelativePath('src/a/b.md')).toBe(true)
  })

  it('refuses traversal and absolute paths rather than normalising them', () => {
    expect(isSafeRelativePath('../secrets.env')).toBe(false)
    expect(isSafeRelativePath('a/../../etc/passwd')).toBe(false)
    expect(isSafeRelativePath('/etc/passwd')).toBe(false)
    expect(isSafeRelativePath('C:\\Windows\\x')).toBe(false)
    expect(isSafeRelativePath('a\\..\\..\\b')).toBe(false)
    expect(isSafeRelativePath('')).toBe(false)
  })

  it('allows dots that are not traversal', () => {
    expect(isSafeRelativePath('v1.2/notes.md')).toBe(true)
    expect(isSafeRelativePath('.hidden/file.md')).toBe(true)
  })
})
