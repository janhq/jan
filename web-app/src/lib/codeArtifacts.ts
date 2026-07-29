import { Code2, FileText, ImageIcon } from 'lucide-react'
import { basenameOf, extensionOf } from '@/lib/codePreview'
import type { CodeTurn } from '@/hooks/useCodeSessions'

/**
 * Artifacts a run produced, derived from its `write`/`edit` tool calls
 * (jan-internal #242 / #304).
 *
 * Two filters, because either alone is wrong:
 *
 * 1. The path must look like a deliverable (see the extension allowlist).
 * 2. The agent must have **created** the file, not modified an existing one.
 *
 * (2) is what makes this usable on a real codebase. On an empty folder the
 * allowlist alone is fine, but in a repo of thousands of files `.md`, `.svg`,
 * `.html`, `.csv` and images *are* the codebase — editing READMEs or icons
 * would otherwise flood the library with source assets. A file the agent
 * brought into existence is a deliverable; one it edited was already yours.
 *
 * Modifications remain visible in the diff panel (#285), which is the right
 * surface for "what did the agent change".
 */
export type CodeArtifact = {
  /** Project-relative path, as the tool reported it. */
  path: string
  /** Display name — the basename without its extension. */
  title: string
  /** Coarse grouping shown on the card, e.g. `Code · HTML`. */
  group: 'Code' | 'Image' | 'Document'
  /** Upper-cased extension, e.g. `HTML`. */
  label: string
}

/** Extension → grouping. Anything absent is not an artifact. */
const ARTIFACT_GROUPS: Record<string, CodeArtifact['group']> = {
  html: 'Code',
  htm: 'Code',
  svg: 'Code',
  png: 'Image',
  jpg: 'Image',
  jpeg: 'Image',
  gif: 'Image',
  webp: 'Image',
  md: 'Document',
  pdf: 'Document',
  docx: 'Document',
  xlsx: 'Document',
  pptx: 'Document',
  csv: 'Document',
}

export function isArtifactPath(path: string): boolean {
  return extensionOf(path) in ARTIFACT_GROUPS
}

export function artifactFor(path: string): CodeArtifact | null {
  const ext = extensionOf(path)
  const group = ARTIFACT_GROUPS[ext]
  if (!group) return null
  const base = basenameOf(path)
  const dot = base.lastIndexOf('.')
  return {
    path,
    title: dot > 0 ? base.slice(0, dot) : base,
    group,
    label: ext.toUpperCase(),
  }
}

/** Icon per group, shared by the transcript card and the artifacts library. */
export const ARTIFACT_ICON = {
  Code: Code2,
  Image: ImageIcon,
  Document: FileText,
} as const

export const ARTIFACT_GROUP_NAMES = ['Code', 'Image', 'Document'] as const

/**
 * Did this write bring a new file into existence?
 *
 * `write` reports `Created <path> (<n> bytes)` or `Overwrote <path> (...)`
 * (handlers.rs), and its diff is headed `@@ created file @@` for a new file.
 * On a UIMessage part the diff is prepended to the result, so the marker is not
 * at position 0 — hence `includes` rather than `startsWith`.
 *
 * Sessions written before the tool reported this said `Wrote N bytes to <path>`
 * with no create/modify distinction. Those are treated as creations: they are
 * historical, and dropping them would silently empty an existing library.
 */
export function createdNewFile(value: unknown): boolean {
  // A UIMessagePart's `output` is typed `unknown`, so narrow here rather than
  // casting at every call site.
  const text = typeof value === 'string' ? value : ''
  if (!text) return false
  if (text.includes('Overwrote ')) return false
  return (
    text.includes('Created ') ||
    text.includes('@@ created file @@') ||
    text.includes('Wrote ') // legacy format, no distinction available
  )
}

type PartLike = {
  type?: string
  input?: unknown
  state?: string
  output?: unknown
}

const pathFromInput = (input: unknown): string | undefined => {
  if (input && typeof input === 'object' && 'path' in input) {
    const v = (input as Record<string, unknown>).path
    return typeof v === 'string' ? v : undefined
  }
  return undefined
}

/**
 * Artifacts attributable to one message, read off its own `write`/`edit` tool
 * parts. Keeping the association message-local is what lets the card render
 * inline in the transcript without `MessageItem` needing to know about
 * artifacts at all.
 *
 * Deduplicated by path, keeping first-seen order: a run that writes then edits
 * the same file produced one artifact, not two.
 */
export function artifactsFromParts(parts: PartLike[] | undefined): CodeArtifact[] {
  if (!parts?.length) return []
  const out: CodeArtifact[] = []
  const seen = new Set<string>()
  for (const part of parts) {
    // `edit` targets a file that already existed, so it never creates one.
    if (part.type !== 'tool-write') continue
    // Only a call that actually completed produced a file.
    if (part.state && part.state !== 'output-available') continue
    if (!createdNewFile(part.output)) continue
    const path = pathFromInput(part.input)
    if (!path || seen.has(path)) continue
    const artifact = artifactFor(path)
    if (!artifact) continue
    seen.add(path)
    out.push(artifact)
  }
  return out
}

/**
 * Artifacts a whole session produced, read straight off its turns.
 *
 * Deliberately not `codeTurnsToUIMessages` + {@link artifactsFromParts}: that
 * builds the full message tree (markdown parts, reasoning splitting, tool
 * grouping) for every session just to recover a handful of paths. The library
 * lists every session at once, so that cost is paid per render.
 *
 * Deduplicated by path — a session that rewrites a file across turns produced
 * one artifact, not one per rewrite.
 */
export function artifactsFromTurns(turns: CodeTurn[] | undefined): CodeArtifact[] {
  if (!turns?.length) return []
  const byPath = new Map<string, CodeArtifact>()
  for (const turn of turns) {
    if (turn.role !== 'tool') continue
    // `edit` targets a file that already existed, so it never creates one.
    if (turn.name !== 'write') continue
    // Only a completed, non-error call produced a file.
    if (turn.isError || turn.status === 'running') continue
    if (!createdNewFile(turn.result ?? turn.content)) continue
    const path = pathFromInput(turn.args)
    if (!path) continue
    const artifact = artifactFor(path)
    if (artifact) byPath.set(path, artifact)
  }
  return [...byPath.values()]
}
