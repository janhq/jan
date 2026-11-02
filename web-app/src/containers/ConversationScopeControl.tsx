import { useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { Button } from '@/components/ui/button'
import { useThreads } from '@/hooks/useThreads'
import { ConversationCapabilitiesConsent } from './ConversationCapabilitiesConsent'
import {
  defaultConversationCapabilities,
  HostRevokeUnconfirmedError,
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
 * Mounted from ChatInput's footer permissions popover for a persistent chat
 * thread on any surface that owns its tool set — regardless of model tool
 * capability or agent mode, because an existing grant must stay revocable
 * here; the scoped native dispatch for that thread surface is live (every
 * native call re-reads the grant through dispatchThreadTool and native
 * intersects it with locked stored consent).
 * Chat tool ADVERTISEMENT is unchanged by this control — grant-driven
 * advertisement is a separate later slice. Temporary chats and Cowork
 * sessions never get a consent control, not even as a pending draft; this
 * component re-checks those guards itself.
 *
 * Authority displayed is the overlay-aware getter, never raw metadata.
 * Elevated grants that are persisted but not confirmed in this process
 * (stale disk snapshots after a revoke, or after a restart, since the getter
 * is overlay-only) stay inactive until explicitly re-applied through the
 * strict setter.
 *
 * The effective scope is subscribed below through a stable useShallow
 * selector over flattened primitives — it re-derives from the overlay on
 * every store notification, not only when this thread's object identity
 * changes, and cannot fresh-object loop.
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
  // Later applies supersede earlier ones (the store's request tokens make the
  // newest call authoritative); a superseded apply must not clobber the
  // latest apply's error or saving state.
  const applySeq = useRef(0)
  // Stable VALUE IDENTITY matters, not just stable primitives: the consent
  // child discards a pending folder pick whenever its `value` prop identity
  // changes. useShallow returns the same effectiveFlat reference while the
  // grant is unchanged, so this memo keeps `effective` identity stable across
  // unrelated re-renders and changes it exactly when authority changes.
  const effective: ConversationCapabilitiesV1 = useMemo(
    () => ({
      version: 1,
      folderScope:
        effectiveFlat.folderPath !== null && effectiveFlat.folderAccess !== null
          ? { path: effectiveFlat.folderPath, access: effectiveFlat.folderAccess }
          : null,
      shellNetwork: effectiveFlat.shellNetwork,
      memoryWrite: effectiveFlat.memoryWrite,
    }),
    [effectiveFlat]
  )

  if (!thread || threadId === TEMPORARY_CHAT_ID || isCoworkThread(thread)) return null
  const persisted = resolveConversationCapabilities(thread.metadata?.conversationCapabilities)
  const unconfirmed =
    (persisted.shellNetwork && !effective.shellNetwork) ||
    (persisted.memoryWrite && !effective.memoryWrite) ||
    (persisted.folderScope !== null &&
      (effective.folderScope === null ||
        effective.folderScope.path !== persisted.folderScope.path ||
        (persisted.folderScope.access === 'write' && effective.folderScope.access !== 'write')))

  const apply = async (next: ConversationCapabilitiesV1) => {
    const seq = ++applySeq.current
    // Captured BEFORE the setter's synchronous deny overwrites the store: the
    // ACK-failure copy depends on what was live or persisted before this
    // change. Conservative on purpose -- a persisted grant counts even when
    // the overlay already denies it (host confirmation state unknown), so a
    // failed revoke of a stale snapshot still warns.
    const hadElevated =
      effective.shellNetwork ||
      effective.memoryWrite ||
      effective.folderScope !== null ||
      persisted.shellNetwork ||
      persisted.memoryWrite ||
      persisted.folderScope !== null
    setSaving(true)
    setError('')
    try {
      await useThreads.getState().setConversationCapabilities(threadId, next)
    } catch (error) {
      if (applySeq.current === seq) {
        // Three different truths. A failed SAVE narrowed the host first, so
        // elevated access really is off. A failed host ACK with a prior
        // grant means neither narrow path ran: background agent tasks may
        // still hold that access, and claiming "off" would be false. A
        // failed host ACK with NO prior grant left nothing running to warn
        // about -- the plain save-failure copy is the whole truth.
        setError(
          error instanceof HostRevokeUnconfirmedError && hadElevated
            ? 'The app did not confirm this permission change. Background agent tasks may ' +
              'still have the previous access; stopping them was attempted but is not ' +
              'confirmed. Retry, or quit Jan to guarantee they stop.'
            : 'Permission change could not be saved. Elevated access stays off until a save succeeds.'
        )
      }
    } finally {
      if (applySeq.current === seq) setSaving(false)
    }
  }

  const effectiveElevated =
    effective.shellNetwork || effective.memoryWrite || effective.folderScope !== null

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
      {(effectiveElevated || saving) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // Revocation is never blocked by a busy save: a newer setter call
          // synchronously denies in memory and supersedes the pending write.
          disabled={disabled}
          data-testid="scope-revoke-now"
          onClick={() => void apply(defaultConversationCapabilities())}
        >
          Turn all permissions off
        </Button>
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
