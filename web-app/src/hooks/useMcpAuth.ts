import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { MCPAuthStatus } from '@/services/mcp/types'

// Preserve the existing public import for consumers.
export { needsAuthDetail } from '@/utils/mcpAuthError'

type AuthStatuses = Record<string, MCPAuthStatus>

/**
 * Per-server OAuth state for the MCP settings screen, plus the two actions that
 * change it.
 *
 * `refresh` is cheap by design -- `getMCPAuthStatus` is a local read on the Rust
 * side (config plus the token store, no network), so refreshing every row after
 * any change costs nothing and keeps the badges from going stale.
 */
export function useMcpAuth(serverNames: string[]) {
  const [statuses, setStatuses] = useState<AuthStatuses>({})
  const [authorizing, setAuthorizing] = useState<Record<string, boolean>>({})
  /** Consent url per server, so a browser that never opened is still reachable. */
  const [consentUrls, setConsentUrls] = useState<Record<string, string>>({})

  // The names are re-derived from an object on every render of the settings
  // page, so a new array identity each time would re-run the effect forever.
  // The joined key is what actually changed.
  const namesKey = serverNames.join('\u0000')
  const namesRef = useRef(serverNames)
  namesRef.current = serverNames

  const refresh = useCallback(async () => {
    const names = namesRef.current
    const entries = await Promise.all(
      names.map(async (name) => {
        try {
          return [name, await getServiceHub().mcp().getMCPAuthStatus(name)] as const
        } catch (error) {
          // A server deleted between render and read is not an error worth
          // surfacing; it simply has no auth state.
          console.debug(`Could not read MCP auth status for ${name}:`, error)
          return null
        }
      })
    )
    setStatuses(Object.fromEntries(entries.filter((e) => e !== null)))
  }, [])

  useEffect(() => {
    void refresh()
  }, [namesKey, refresh])

  // The backend emits the consent url before it starts waiting on the redirect,
  // so the link is available for the whole time the flow is pending.
  useEffect(() => {
    const unlisten = listen<{ server: string; url: string }>(
      'mcp-oauth-url',
      (event) => {
        setConsentUrls((prev) => ({
          ...prev,
          [event.payload.server]: event.payload.url,
        }))
      }
    )
    return () => {
      void unlisten.then((off) => off())
    }
  }, [])

  const authorize = useCallback(
    async (name: string) => {
      setAuthorizing((prev) => ({ ...prev, [name]: true }))
      try {
        await getServiceHub().mcp().authorizeMCPServer(name)
      } finally {
        setAuthorizing((prev) => ({ ...prev, [name]: false }))
        setConsentUrls((prev) => {
          if (!(name in prev)) return prev
          const rest = { ...prev }
          delete rest[name]
          return rest
        })
        await refresh()
      }
    },
    [refresh]
  )

  const clearAuth = useCallback(
    async (name: string) => {
      try {
        return await getServiceHub().mcp().clearMCPAuth(name)
      } finally {
        await refresh()
      }
    },
    [refresh]
  )

  return { statuses, authorizing, consentUrls, refresh, authorize, clearAuth }
}
