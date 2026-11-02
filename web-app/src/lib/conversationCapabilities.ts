/** Explicit per-conversation consent, independent of projects and MCP trust.
 * This is frontend intent, NOT proof of filesystem identity or containment.
 * Dispatch must re-resolve this metadata and the backend must validate paths,
 * symlinks, sandbox availability and permissions before executing any call.
 */
export type ConversationCapabilitiesV1 = {
  version: 1
  folderScope: { path: string; access: 'read' | 'write' } | null
  shellNetwork: boolean
  memoryWrite: boolean
}

export function defaultConversationCapabilities(): ConversationCapabilitiesV1 {
  return { version: 1, folderScope: null, shellNetwork: false, memoryWrite: false }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

/** Lexical rejection only. Never use this as an absolute-path verification or
 * containment check. UNC/device paths and filesystem roots are not supported. */
export function isConversationFolderPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length > 4096 || path.trim() !== path ||
    Array.from(path).some((char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127)) return false
  const windows = /^[A-Za-z]:\\/.test(path)
  if (!windows && (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))) return false
  const parts = (windows ? path.slice(3).split('\\') : path.slice(1).split('/'))
  return parts.length > 0 && parts.every((part) => part !== '' && part !== '.' && part !== '..' && !part.includes(':') && (!windows || !/[/<>"|?*]/.test(part)))
}

/** Unknown versions, extra fields, malformed paths and permissions fail closed
 * as a whole; never partially salvage an escalation from corrupt metadata. */
export function resolveConversationCapabilities(value: unknown): ConversationCapabilitiesV1 {
  if (!record(value) || !keys(value, ['version', 'folderScope', 'shellNetwork', 'memoryWrite']) ||
    value.version !== 1 || typeof value.shellNetwork !== 'boolean' || typeof value.memoryWrite !== 'boolean') {
    return defaultConversationCapabilities()
  }
  const folder = value.folderScope
  if (folder !== null && (!record(folder) || !keys(folder, ['path', 'access']) ||
    !isConversationFolderPath(folder.path) || (folder.access !== 'read' && folder.access !== 'write'))) {
    return defaultConversationCapabilities()
  }
  return {
    version: 1,
    folderScope: folder === null ? null : { path: (folder as Record<string, unknown>).path as string, access: (folder as Record<string, unknown>).access as 'read' | 'write' },
    shellNetwork: value.shellNetwork,
    memoryWrite: value.memoryWrite,
  }
}

export type ConversationCapabilityRequest = {
  capability: 'folderRead' | 'folderWrite' | 'shellNetwork' | 'memoryWrite'
  /** Selected grant root, NOT an arbitrary tool argument or child path. */
  path?: string
}

/** Consent decision only. Allowed is necessary, not sufficient for dispatch:
 * model/tool gates, MCP approval and native containment remain authoritative. */
export function conversationCapabilityDecision(
  value: unknown,
  request: ConversationCapabilityRequest
): { allowed: boolean; reason?: string } {
  const grants = resolveConversationCapabilities(value)
  let allowed = false
  switch (request.capability) {
    case 'folderRead':
    case 'folderWrite':
      allowed = !!grants.folderScope && grants.folderScope.path === request.path &&
        (request.capability === 'folderRead' || grants.folderScope.access === 'write')
      break
    case 'shellNetwork': allowed = grants.shellNetwork; break
    case 'memoryWrite': allowed = grants.memoryWrite; break
  }
  return allowed ? { allowed: true } : { allowed: false, reason: 'This conversation has not granted this capability.' }
}
