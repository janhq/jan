/**
 * Marker the backend prefixes onto an activation error the user fixes by
 * signing in. Kept in sync with `core::mcp::oauth::NEEDS_AUTH_PREFIX`.
 */
const NEEDS_AUTH_PREFIX = 'NEEDS_AUTH: '

/**
 * Whether a failed activation is an authorization problem rather than a broken
 * server, and the detail behind it. The backend tags it explicitly instead of
 * leaving the UI to pattern-match "401" out of a transport error.
 */
export function needsAuthDetail(error: unknown): string | null {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof (error as { message?: unknown })?.message === 'string'
          ? ((error as { message: string }).message)
          : ''
  return message.startsWith(NEEDS_AUTH_PREFIX)
    ? message.slice(NEEDS_AUTH_PREFIX.length)
    : null
}

/** Only the backend's explicit OAuth marker is recoverable by signing in. */
export function isNeedsAuthError(error: unknown): boolean {
  return needsAuthDetail(error) !== null
}
