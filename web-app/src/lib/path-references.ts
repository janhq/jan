/**
 * Utility for scanning, resolving, and searching @path file/folder references
 * in the chat input.
 *
 * - Typing `@` triggers a fuzzy file search scoped to the working directory.
 * - Selected paths are kept as text references (e.g. `@src/main.ts`) in the prompt.
 * - On submit, each @reference is resolved: files are read as text (with a 1MB cap),
 *   directories produce a listing, images produce inline data, and errors surface
 *   as inline notices.
 */
import { fs } from '@janhq/core'
import type { FilePickerEntry } from '@/types/path-reference'

export type { FilePickerEntry }

// ── Exports ──────────────────────────────────────────────────────────────────

/** Regex matching @path references in text. */
export const REFERENCE_PATTERN = /@([^\s,;:!?'"`)\]}>]+)/g

/** Maximum bytes we'll read from a single file. */
const MAX_FILE_BYTES = 1 * 1024 * 1024

/** Maximum characters in a directory listing sent to the model. */
const MAX_DIR_CHARS = 20_000

/** Image extensions that should be offered as base64 rather than text. */
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'])

/** Common code/text extensions we prioritise in picker results. */
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'go', 'java', 'c', 'cpp', 'h',
  'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'scala',
  'json', 'yaml', 'yml', 'toml', 'xml', 'md', 'txt', 'css', 'scss',
  'html', 'sh', 'bash', 'zsh', 'sql', 'graphql',
])

// ── Parsing references from text ─────────────────────────────────────────────

/**
 * Parse @path references from a prompt string.
 * Returns the raw path strings (e.g. `["src/main.ts", "../README.md"]`).
 */
export function parsePromptForReferences(text: string): string[] {
  const seen = new Set<string>()
  const refs: string[] = []
  let match: RegExpExecArray | null
  while ((match = REFERENCE_PATTERN.exec(text)) !== null) {
    const raw = match[1].trim()
    // Skip obvious non-paths
    if (
      !raw ||
      raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('file://') ||
      raw.includes('@') ||
      raw === ''
    )
      continue
    if (!seen.has(raw)) {
      seen.add(raw)
      refs.push(raw)
    }
  }
  return refs
}

/**
 * Format a path as a @reference text for insertion into the prompt.
 */
export function formatPathReferenceText(path: string): string {
  return `@${path}`
}

// ── Fuzzy file search ────────────────────────────────────────────────────────

/**
 * Searches for files/folders in `rootDir` whose path or name matches `query`
 * (case-insensitive substring / fuzzy matching). Returns up to 50 entries
 * suitable for the picker dropdown.
 *
 * If `query` is empty, returns a flat listing of the immediate children of
 * `rootDir` (capped at 100). Otherwise performs a breadth-first walk up to a
 * depth of 4 levels and scores entries by match quality.
 */
export async function searchFiles(
  rootDir: string,
  query: string,
  max_: number = 50
): Promise<FilePickerEntry[]> {
  try {
    // Empty query: return immediate children (fast, no recursion)
    if (!query || query.trim() === '') {
      return listImmediateChildren(rootDir, max_)
    }

    // Non-empty query: walk the tree up to 4 levels
    const results: ScoredEntry[] = []
    const queryLower = query.toLowerCase()
    // If query contains slashes, we search deeper
    const depth = Math.min(query.split('/').length + 2, 4)

    await walkDir(rootDir, queryLower, results, depth, 0)

    // Sort: directories first, then by match quality, then alphabetically
    results.sort((a, b) => {
      // Directories first
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      // Exact name match > starts with > substring > fuzzy
      if (a.score !== b.score) return b.score - a.score
      // Shorter paths first
      return a.path.length - b.path.length
    })

    return results.slice(0, max_).map(({ path, name, kind, ext }) => ({
      path,
      name,
      kind,
      extension: ext,
    }))
  } catch {
    return []
  }
}

// ── Resolving a single reference content ─────────────────────────────────────

/**
 * Resolve a @path reference and return the content to inject into the message.
 *
 * Returns `null` if the reference is missing or errors (caller surfaces inline).
 */
export async function resolvePathReference(
  rawPath: string,
  workingDir?: string
): Promise<{
  kind: 'file' | 'directory'
  absolutePath: string
  content: string
  isImage: boolean
  imageBase64?: string
  imageMimeType?: string
} | null> {
  const absolutePath = rawPath.startsWith('/')
    ? rawPath
    : workingDir
      ? `${workingDir}/${rawPath}`
      : rawPath

  try {
    const stat = await fs.fileStat(absolutePath)
    if (!stat) return null

    const isDir = stat.isDirectory ?? false

    if (isDir) {
      // Directory listing
      const entries = await fs.readdirSync(absolutePath)
      const items = Array.isArray(entries) ? entries : []
      let listing = ''
      for (const item of items) {
        const name = typeof item === 'string' ? item : String(item)
        listing += `  ${name}\n`
      }
      if (listing.length > MAX_DIR_CHARS) {
        listing = listing.slice(0, MAX_DIR_CHARS) + '\n  ... (truncated)'
      }
      return { kind: 'directory', absolutePath, content: listing, isImage: false }
    }

    // File
    const size = stat.size ? Number(stat.size) : 0
    if (size > MAX_FILE_BYTES) {
      return null // too large — caller handles
    }

    const ext = rawPath.split('.').pop()?.toLowerCase()
    if (ext && IMAGE_EXTS.has(ext)) {
      const content = await fs.readFileSync(absolutePath)
      const base64 = typeof content === 'string' ? content : String(content)
      const mime = imageMimeFor(ext)
      return {
        kind: 'file',
        absolutePath,
        content: `[Image: ${rawPath}]`,
        isImage: true,
        imageBase64: base64,
        imageMimeType: mime,
      }
    }

    const content = await fs.readFileSync(absolutePath)
    const text = typeof content === 'string' ? content : String(content)
    const truncated =
      text.length > MAX_FILE_BYTES
        ? text.slice(0, MAX_FILE_BYTES) + '\n\n... (truncated)'
        : text

    const header = `--- File: ${rawPath} ---\n`
    const footer = `\n--- End: ${rawPath} ---`
    return { kind: 'file', absolutePath, content: header + truncated + footer, isImage: false }
  } catch {
    return null
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

interface ScoredEntry {
  path: string
  name: string
  kind: 'file' | 'directory'
  ext?: string
  score: number
}

function scoreMatch(name: string, queryLower: string): number {
  const lower = name.toLowerCase()
  if (lower === queryLower) return 100 // exact match
  if (lower.startsWith(queryLower)) return 80 // prefix
  if (lower.includes(queryLower)) return 60 // substring
  // Fuzzy: each consecutive matched character adds 5
  let fi = 0
  let score = 0
  for (const ch of queryLower) {
    const idx = lower.indexOf(ch, fi)
    if (idx === -1) return 0
    if (idx === fi) score += 10 // consecutive match
    else score += 2
    fi = idx + 1
  }
  return Math.min(score, 50)
}

async function walkDir(
  dir: string,
  queryLower: string,
  results: ScoredEntry[],
  maxDepth: number,
  depth: number
): Promise<void> {
  if (depth > maxDepth) return

  try {
    const entries: string[] = await fs.readdirSync(dir)
    if (!Array.isArray(entries)) return

    const items: Array<{ path: string; name: string; isDir: boolean }> = []
    for (const entry of entries) {
      const name = typeof entry === 'string' ? entry : String(entry)
      const fullPath = `${dir}/${name}`
      let isDir = false
      try {
        const stat = await fs.fileStat(fullPath)
        isDir = stat?.isDirectory ?? false
      } catch {
        // stat failed, treat as file
      }

      const entryName = name
      const entryScore = scoreMatch(entryName, queryLower)
      if (entryScore > 0) {
        const ext = isDir ? undefined : entryName.split('.').pop()?.toLowerCase()
        results.push({
          path: fullPath,
          name: entryName,
          kind: isDir ? 'directory' : 'file',
          ext,
          score: entryScore,
        })
      }

      items.push({ path: fullPath, name: entryName, isDir })
    }

    // Recurse into directories
    if (depth < maxDepth) {
      for (const item of items) {
        if (item.isDir) {
          await walkDir(item.path, queryLower, results, maxDepth, depth + 1)
        }
      }
    }
  } catch {
    // Silently skip directories we can't read
  }
}

async function listImmediateChildren(
  dir: string,
  max_: number
): Promise<FilePickerEntry[]> {
  try {
    const entries: string[] = await fs.readdirSync(dir)
    if (!Array.isArray(entries)) return []

    const results: FilePickerEntry[] = []
    for (const entry of entries) {
      if (results.length >= max_) break
      const name = typeof entry === 'string' ? entry : String(entry)
      const fullPath = `${dir}/${name}`
      let isDir = false
      try {
        const stat = await fs.fileStat(fullPath)
        isDir = stat?.isDirectory ?? false
      } catch {
        // treat as file
      }
      const ext = isDir ? undefined : name.split('.').pop()?.toLowerCase()
      results.push({ path: fullPath, name, kind: isDir ? 'directory' : 'file', extension: ext })
    }

    // Sort: directories first, then code files, then alphabetically
    results.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      const aCode = a.extension ? CODE_EXTS.has(a.extension) : false
      const bCode = b.extension ? CODE_EXTS.has(b.extension) : false
      if (aCode !== bCode) return aCode ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return results
  } catch {
    return []
  }
}

function imageMimeFor(ext: string): string {
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  }
  return map[ext] || 'image/png'
}
