import { Code2, FileText, ImageIcon } from 'lucide-react'
import { basenameOf, extensionOf } from '@/lib/codePreview'
import type { CodeTurn } from '@/hooks/useCodeSessions'

/**
 * Artifacts a run produced, derived from its `write`/`edit` tool calls
 * (jan-internal #242 / #304).
 *
 * Deliberately not "every file the agent touched": a run also writes
 * `package.json`, lockfiles, config and source, and surfacing those as
 * artifacts turns the list into noise. Those changes are already visible in the
 * diff panel (#285), which is the right surface for "what did the agent change".
 * This is the narrower question: "what did it make *for me*".
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

type PartLike = {
  type?: string
  input?: unknown
  state?: string
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
    if (part.type !== 'tool-write' && part.type !== 'tool-edit') continue
    // Only a call that actually completed produced a file.
    if (part.state && part.state !== 'output-available') continue
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
    if (turn.name !== 'write' && turn.name !== 'edit') continue
    // Only a completed, non-error call produced a file.
    if (turn.isError || turn.status === 'running') continue
    const path = pathFromInput(turn.args)
    if (!path) continue
    const artifact = artifactFor(path)
    if (artifact) byPath.set(path, artifact)
  }
  return [...byPath.values()]
}
