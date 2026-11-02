import { useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { Button } from '@/components/ui/button'
import { useThreads } from '@/hooks/useThreads'
import { ConversationCapabilitiesConsent } from './ConversationCapabilitiesConsent'
import {
  defaultConversationCapabilities,
  resolveConversationCapabilities,
  type ConversationCapabilitiesV1,
} from '@/lib/conversationCapabilities'
import { isCoworkThread } from '@/lib/threadMode'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

type Props = {
  threadId: string
  /** Native folder picker, injected by the mounting surface. */
  pickFolder: () => Promise<string | null>
  disabled?: boolean
}

/** Active-scope control for one existing persistent Chat thread.
 *
 * Not mounted anywhere yet: mount only on a dispatch-enforced Chat path,
 * together with grant-aware advertisement. Temporary chats and Cowork
 * sessions never get a consent control, not even as a pending draft.
 *
 * Authority displayed is the overlay-aware getter, never raw metadata.
 * Elevated grants that are persisted but not confirmed in this process
 * (stale disk snapshots after a revoke, or after restart once the getter is
 * overlay-only) stay inactive until explicitly re-applied through the strict
 * setter.
 *
 * Both mount preconditions from review are satisfied on the merged
 * enforcement base: the getter is overlay-only (restart defaults elevated
 * persisted grants to denied until reconfirmed), and the effective scope is
 * subscribed below through a stable useShallow selector over flattened
 * primitives — it re-derives from the overlay on every store notification,
 * not only when this thread's object identity changes, and cannot
 * fresh-object loop.
 */
export function ConversationScopeControl({ threadId, pickFolder, disabled = false }: Props) {
  const thread = useThreads((state) => state.threads[threadId])
  // Stable subscription to the effective grant: flattened primitives keep
  // useShallow equality meaningful, so unrelated store updates do not
  // re-render and every overlay change (always store-notified) does.
  const effectiveFlat = useThreads(
    useShallow((state) => {
      const caps = state.getConversationCapabilities(threadId)
      return {
        folderPath: caps.folderScope?.path ?? null,
        folderAccess: caps.folderScope?.access ?? null,
        shellNetwork: caps.shellNetwork,
        memoryWrite: caps.memoryWrite,
      }
    })
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!thread || threadId === TEMPORARY_CHAT_ID || isCoworkThread(thread)) return null

  const effective: ConversationCapabilitiesV1 = {
    version: 1,
    folderScope:
      effectiveFlat.folderPath !== null && effectiveFlat.folderAccess !== null
        ? { path: effectiveFlat.folderPath, access: effectiveFlat.folderAccess }
        : null,
    shellNetwork: effectiveFlat.shellNetwork,
    memoryWrite: effectiveFlat.memoryWrite,
  }
  const persisted = resolveConversationCapabilities(thread.metadata?.conversationCapabilities)
  const unconfirmed =
    (persisted.shellNetwork && !effective.shellNetwork) ||
    (persisted.memoryWrite && !effective.memoryWrite) ||
    (persisted.folderScope !== null &&
      (effective.folderScope === null ||
        effective.folderScope.path !== persisted.folderScope.path ||
        (persisted.folderScope.access === 'write' && effective.folderScope.access !== 'write')))

  const apply = async (next: ConversationCapabilitiesV1) => {
    setSaving(true)
    setError('')
    try {
      await useThreads.getState().setConversationCapabilities(threadId, next)
    } catch {
      setError(
        'Permission change could not be saved. Elevated access stays off until a save succeeds.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-w-0 space-y-2">
      <ConversationCapabilitiesConsent
        value={effective}
        onChange={(next) => void apply(next)}
        onPickFolder={pickFolder}
        disabled={disabled || saving}
      />
      {unconfirmed && (
        <div
          role="status"
          className="space-y-2 rounded-xl border border-border p-3 text-xs leading-5"
          data-testid="scope-reconfirm"
        >
          <p>
            Permissions saved earlier are not active in this session. They stay off until you
            confirm them again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || saving}
              onClick={() => void apply(persisted)}
            >
              Reconfirm saved permissions
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || saving}
              onClick={() => void apply(defaultConversationCapabilities())}
            >
              Keep them off
            </Button>
          </div>
        </div>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Turning a permission off applies from the next tool call. A command that is already
        running keeps the access it started with; use Stop to end it.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
