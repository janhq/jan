import { useEffect } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'
import {
  useToolCallRuntime,
  type ToolProgressUpdate,
} from '@/hooks/useToolCallRuntime'
import type { UnlistenFn } from '@/services/events/types'

/** Emitted by the Rust MCP client handler; see core/mcp/progress.rs. */
export const MCP_TOOL_PROGRESS_EVENT = 'mcp-tool-progress'

/**
 * Feeds MCP `notifications/progress` into the tool-call runtime. Mounted once
 * at the root: the update carries no tool call id, so it is attached to the
 * call currently running rather than routed to a particular card.
 */
export function useMcpToolProgress() {
  const serviceHub = useServiceHub()

  useEffect(() => {
    if (!isPlatformTauri()) return

    let unlisten: UnlistenFn | undefined
    let cancelled = false

    void serviceHub
      .events()
      .listen<ToolProgressUpdate>(MCP_TOOL_PROGRESS_EVENT, ({ payload }) => {
        useToolCallRuntime.getState().reportProgress(payload)
      })
      .then((fn) => {
        // listen() resolves after unmount if the component was short-lived,
        // which would otherwise leave the subscription behind.
        if (cancelled) fn()
        else unlisten = fn
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [serviceHub])
}
