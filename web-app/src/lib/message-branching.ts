import { ThreadMessage, ContentType, MessageStatus } from '@janhq/core'

type ThreadContent = NonNullable<ThreadMessage['content']>[number]

/**
 * Message versioning model: a parent-pointer tree stored in `metadata`.
 *
 * - `metadata.parentId` links a message to its predecessor. Messages sharing a
 *   `parentId` (or both rootless) are sibling versions.
 * - `metadata.activeChildId` selects which child branch is shown; absent ⇒ the
 *   newest sibling (by `created_at`) wins.
 *
 * The visible/sent conversation is the path from the active root down the active
 * child at each node. Legacy threads carry no branching metadata and are treated
 * as a single linear path until the first fork backfills parent links.
 */

const meta = (m: ThreadMessage) =>
  (m.metadata ?? {}) as Record<string, unknown>

// Raw link: `undefined` ⇒ legacy/unlinked, `null` ⇒ explicit root, string ⇒ parent.
const rawParent = (m: ThreadMessage): string | null | undefined => {
  const p = meta(m).parentId
  if (p === null) return null
  return typeof p === 'string' ? p : undefined
}

export const getParentId = (m: ThreadMessage): string | null => {
  const p = rawParent(m)
  return typeof p === 'string' ? p : null
}

export const getActiveChildId = (m: ThreadMessage): string | undefined => {
  const c = meta(m).activeChildId
  return typeof c === 'string' ? c : undefined
}

/** True once any message carries branching metadata. */
export const hasBranching = (messages: ThreadMessage[]): boolean =>
  messages.some(
    (m) => meta(m).parentId !== undefined || meta(m).activeChildId !== undefined
  )

const byCreatedAt = (a: ThreadMessage, b: ThreadMessage) =>
  (a.created_at ?? 0) - (b.created_at ?? 0)

/** Sibling versions of `m` (same parent, or fellow roots), oldest → newest. */
export const getSiblings = (
  messages: ThreadMessage[],
  m: ThreadMessage
): ThreadMessage[] => {
  const pid = rawParent(m)
  // Legacy/unlinked messages have no version siblings.
  if (pid === undefined) return [m]
  return messages.filter((x) => rawParent(x) === pid).sort(byCreatedAt)
}

/** 1-based position of `m` among its versions and the total count. */
export const getVersionInfo = (
  messages: ThreadMessage[],
  m: ThreadMessage
): { index: number; count: number } => {
  const siblings = getSiblings(messages, m)
  const idx = siblings.findIndex((x) => x.id === m.id)
  return { index: idx === -1 ? 1 : idx + 1, count: siblings.length }
}

const childrenOf = (
  messages: ThreadMessage[],
  parentId: string | null
): ThreadMessage[] =>
  messages.filter((x) => rawParent(x) === parentId).sort(byCreatedAt)

/** The active child of `parent`: its `activeChildId` if still valid, else newest. */
export const pickActiveChild = (
  messages: ThreadMessage[],
  parent: ThreadMessage
): ThreadMessage | undefined => {
  const children = childrenOf(messages, parent.id)
  if (children.length === 0) return undefined
  const activeId = getActiveChildId(parent)
  const chosen = activeId && children.find((c) => c.id === activeId)
  return chosen || children[children.length - 1]
}

/**
 * The visible linear conversation. Legacy (un-branched) threads are returned
 * unchanged; otherwise walk from the active root following the active child.
 */
export const computeActivePath = (
  messages: ThreadMessage[],
  activeRootId?: string
): ThreadMessage[] => {
  if (!hasBranching(messages)) return messages

  const roots = childrenOf(messages, null)
  if (roots.length === 0) return messages

  const root =
    (activeRootId && roots.find((r) => r.id === activeRootId)) ||
    roots[roots.length - 1]

  const path: ThreadMessage[] = []
  let cur: ThreadMessage | undefined = root
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    path.push(cur)
    cur = pickActiveChild(messages, cur)
  }
  return path
}

/** Return a copy of `m` with `parentId` set in metadata. */
export const withParentId = (
  m: ThreadMessage,
  parentId: string | null
): ThreadMessage => ({
  ...m,
  metadata: { ...(m.metadata ?? {}), parentId },
})

/** Return a copy of `m` with `activeChildId` set in metadata. */
export const withActiveChild = (
  m: ThreadMessage,
  childId: string
): ThreadMessage => ({
  ...m,
  metadata: { ...(m.metadata ?? {}), activeChildId: childId },
})

/**
 * Assign `parentId` along a linear path so the tree is well-formed before the
 * first fork. Returns only the messages that need a write (empty if already
 * branched). `path` must be in conversation order.
 */
export const backfillParentIds = (path: ThreadMessage[]): ThreadMessage[] => {
  if (path.some((m) => meta(m).parentId !== undefined)) return []
  return path.map((m, i) => withParentId(m, i === 0 ? null : path[i - 1].id))
}

/**
 * Build a new sibling version of `source`: fresh id/timestamp, same parent,
 * no children, optional text override. Used for edit-user / edit-assistant forks.
 */
export const makeSibling = (
  source: ThreadMessage,
  opts: { id: string; createdAt: number; text?: string }
): ThreadMessage => {
  const content: ThreadContent[] =
    opts.text !== undefined
      ? [{ type: ContentType.Text, text: { value: opts.text, annotations: [] } }]
      : source.content.map((c) => ({ ...c }))
  const sourceMeta = { ...(source.metadata ?? {}) } as Record<string, unknown>
  delete sourceMeta.activeChildId
  delete sourceMeta.error
  return {
    ...source,
    id: opts.id,
    content,
    status: MessageStatus.Ready,
    created_at: opts.createdAt,
    completed_at: opts.createdAt,
    metadata: { ...sourceMeta, parentId: getParentId(source) },
  }
}
