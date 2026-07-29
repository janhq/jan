import { describe, it, expect } from 'vitest'
import {
  previewKindFor,
  extensionOf,
  basenameOf,
  isAssetKind,
  unresolvedRefs,
  resolveInRoot,
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

describe('resolveInRoot', () => {
  const root = '/Users/me/proj'

  it('resolves a relative path', () => {
    expect(resolveInRoot(root, 'index.html')).toBe('/Users/me/proj/index.html')
    expect(resolveInRoot(root, 'a/b.md')).toBe('/Users/me/proj/a/b.md')
  })

  it('accepts an absolute path inside the root', () => {
    // Regression: the agent reports absolute paths for some writes and
    // relative for others; refusing absolute rejected in-project files.
    expect(resolveInRoot(root, '/Users/me/proj/flappy.html')).toBe(
      '/Users/me/proj/flappy.html'
    )
  })

  it('refuses anything that lands outside the root', () => {
    expect(resolveInRoot(root, '../secrets.env')).toBeNull()
    expect(resolveInRoot(root, 'a/../../etc/passwd')).toBeNull()
    expect(resolveInRoot(root, '/etc/passwd')).toBeNull()
    // Sibling dir sharing a name prefix must not pass the prefix check.
    expect(resolveInRoot(root, '/Users/me/proj-other/x')).toBeNull()
  })

  it('collapses . and trailing slashes', () => {
    expect(resolveInRoot(root + '/', './a.md')).toBe('/Users/me/proj/a.md')
    expect(resolveInRoot(root, 'a/./b/../c.md')).toBe('/Users/me/proj/a/c.md')
  })

  it('handles windows paths', () => {
    expect(resolveInRoot('C:\\proj', 'a\\b.html')).toBe('C:/proj/a/b.html')
    expect(resolveInRoot('C:\\proj', 'C:\\other\\x')).toBeNull()
  })

  it('compares containment case-insensitively (Windows/macOS volumes are)', () => {
    expect(resolveInRoot('/Users/me/Proj', '/users/me/proj/a.html')).toBe(
      '/users/me/proj/a.html'
    )
    expect(resolveInRoot('c:/proj', 'C:/Proj/a.html')).toBe('C:/Proj/a.html')
    // Still refuses a genuinely different directory.
    expect(resolveInRoot('/Users/me/Proj', '/Users/me/Other/a.html')).toBeNull()
  })

  it('is null on empty input', () => {
    expect(resolveInRoot(root, '')).toBeNull()
    expect(resolveInRoot('', 'a.md')).toBeNull()
  })
})
