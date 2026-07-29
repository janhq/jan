import { basenameOf, extensionOf } from '@/lib/codePreview'

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
