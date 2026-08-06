// Renderer selection and load-state modelling for the Cowork preview pane
// (jan-internal #242). Kept pure and separate from the component so the state
// machine and the security checks are testable without a DOM.

/** How a given file should be shown. `file` is the fallback card. */
export type PreviewKind = 'html' | 'svg' | 'markdown' | 'image' | 'video' | 'audio' | 'text' | 'file'

/**
 * Preview FSM, shared with the artifacts library (#304) so both surfaces behave
 * identically.
 *
 * `idle → loading → ready | unsupported | failed`, and `reload` re-enters
 * `loading`. `changedOnDisk` is a flag on `ready` rather than an auto-reload:
 * swapping content under someone mid-interaction (playing a game, scrolled into
 * a document) is worse than offering them the reload.
 */
export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading'; path: string }
  | {
      status: 'ready'
      path: string
      kind: Exclude<PreviewKind, 'file'>
      content?: string
      assetUrl?: string
      /** Relative refs the sandbox cannot resolve — see `unresolvedRefs`. */
      unresolvedRefs?: number
    }
  | { status: 'unsupported'; path: string }
  | { status: 'failed'; path: string; reason: string }

const EXT_KIND: Record<string, PreviewKind> = {
  html: 'html',
  htm: 'html',
  svg: 'svg',
  md: 'markdown',
  markdown: 'markdown',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  ico: 'image',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  avi: 'video',
  m4v: 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  m4a: 'audio',
  aac: 'audio',
  opus: 'audio',
  txt: 'text',
  json: 'text',
  css: 'text',
  js: 'text',
  jsx: 'text',
  ts: 'text',
  tsx: 'text',
  py: 'text',
  rs: 'text',
  toml: 'text',
  yml: 'text',
  yaml: 'text',
  sh: 'text',
  csv: 'text',
}

export function extensionOf(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  // A leading dot is a dotfile, not an extension (`.gitignore`).
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** Which renderer a path maps to. Unknown/binary types fall back to `file`. */
export function previewKindFor(path: string): PreviewKind {
  return EXT_KIND[extensionOf(path)] ?? 'file'
}

/** `image`, `video` and `audio` stream from disk via the asset protocol, not a read. */
export function isAssetKind(kind: PreviewKind): boolean {
  return kind === 'image' || kind === 'video' || kind === 'audio'
}

export function basenameOf(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

/**
 * `HtmlArtifact` renders into an opaque-origin sandbox via `srcDoc`, so there is
 * no base URL: a relative `src`/`href` cannot resolve and the asset silently
 * fails to load. Count those so the pane can say so instead of presenting a
 * visibly broken page as if it were correct.
 *
 * Absolute URLs, `data:`/`blob:`, protocol-relative URLs, anchors and inline
 * handlers are all fine and not counted.
 */
export function unresolvedRefs(html: string): number {
  let count = 0
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const value = (m[2] ?? m[3] ?? '').trim()
    if (!value) continue
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(value) || // any scheme: http:, data:, mailto:
      value.startsWith('//') || // protocol-relative
      value.startsWith('#') // in-page anchor
    ) {
      continue
    }
    count += 1
  }
  return count
}

/**
 * Absolute path for `path` if it lands inside `root`, else null.
 *
 * Accepts relative *or* absolute input: the agent reports either, sometimes
 * both within one session, so refusing absolute outright rejected files that
 * were in the project all along. `..` is collapsed first, so traversal cannot
 * sneak past by ending up inside the root string.
 */
export function resolveInRoot(root: string, path: string): string | null {
  const slash = (p: string) => p.replace(/\\/g, '/')
  const trim = (p: string) => slash(p).replace(/\/+$/, '')
  const r = trim(root)
  if (!r || !path) return null
  const raw = slash(path)
  const isAbs = raw.startsWith('/') || /^[a-z]:\//i.test(raw)
  const joined = isAbs ? raw : `${r}/${raw.replace(/^\/+/, '')}`

  const parts: string[] = []
  for (const seg of joined.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  const abs = (joined.startsWith('/') ? '/' : '') + parts.join('/')
  // Containment compared case-insensitively: Windows and default macOS volumes
  // are case-insensitive, so `/Users/me/Proj` and `/users/me/proj` are the same
  // directory and a case-sensitive check would refuse an in-project file. The
  // returned path keeps its original casing for the actual read.
  const inRoot = abs.toLowerCase() === r.toLowerCase() ||
    abs.toLowerCase().startsWith(`${r.toLowerCase()}/`)
  return inRoot ? abs : null
}

/** Guard before reading, so an oversized file fails fast instead of hanging. */
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
