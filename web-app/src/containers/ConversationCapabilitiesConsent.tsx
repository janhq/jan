import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  resolveConversationCapabilities,
  isConversationFolderPath,
  type ConversationCapabilitiesV1,
} from '@/lib/conversationCapabilities'

type Props = {
  value: ConversationCapabilitiesV1
  onChange: (next: ConversationCapabilitiesV1) => void
  onPickFolder: () => Promise<string | null>
  disabled?: boolean
}

/** Pending consent only. Mount exclusively on a dispatch-enforced Chat path.
 * The accepting workflow persists this value; toggles never update global
 * settings or authorize a running turn. Project selection is unrelated. */
export function ConversationCapabilitiesConsent({ value, onChange, onPickFolder, disabled = false }: Props) {
  const grants = resolveConversationCapabilities(value)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef({ value, disabled })
  const generation = useRef(0)
  if (latest.current.value !== value || latest.current.disabled !== disabled) generation.current += 1
  latest.current = { value, disabled }
  useEffect(() => () => { generation.current += 1 }, [])
  const busy = disabled || picking
  const change = (patch: Partial<ConversationCapabilitiesV1>) => onChange({ ...grants, ...patch })
  const pickFolder = async () => {
    setPicking(true)
    setError('')
    const operation = ++generation.current
    try {
      const path = await onPickFolder()
      // Discard stale picker responses after navigation, edits or disabling.
      if (latest.current.disabled || generation.current !== operation || path === null) return
      if (!isConversationFolderPath(path)) {
        setError('This folder path is not supported. Choose another folder.')
        return
      }
      onChange({ ...grants, folderScope: { path, access: 'read' } })
    } catch {
      setError('Could not select a folder. Try again.')
    } finally {
      setPicking(false)
    }
  }
  const folder = grants.folderScope
  return (
    <fieldset disabled={busy} className="min-w-0 space-y-3 rounded-xl border border-border p-3 text-sm">
      <legend className="px-1 font-medium">Conversation permissions</legend>
      <p className="text-xs leading-5 text-muted-foreground">Pending permissions for this conversation, applied when your message is accepted. Existing Chat tools and MCP approvals stay separate. Selecting a Jan project does not grant folder access.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void pickFolder()}>{picking ? 'Choosing folder…' : folder ? 'Change folder' : 'Choose folder to read'}</Button>
        {folder && <Button type="button" variant="ghost" size="sm" onClick={() => change({ folderScope: null })}>Remove folder</Button>}
      </div>
      <p className="break-all text-xs leading-5" role="status">{folder ? `${folder.access === 'write' ? 'Read and write' : 'Read only'}: ${folder.path}` : 'No folder access selected.'}</p>
      <label className="flex items-start gap-2 leading-5">
        <input className="mt-1 shrink-0 accent-primary" type="checkbox" checked={folder?.access === 'write'} disabled={busy || !folder} onChange={(event) => folder && change({ folderScope: { path: folder.path, access: event.target.checked ? 'write' : 'read' } })} />
        <span>Allow changes to files in this folder</span>
      </label>
      <label className="flex items-start gap-2 leading-5">
        <input className="mt-1 shrink-0 accent-primary" type="checkbox" checked={grants.shellNetwork} onChange={(event) => change({ shellNetwork: event.target.checked })} />
        <span>Allow shell commands to access the network</span>
      </label>
      <label className="flex items-start gap-2 leading-5">
        <input className="mt-1 shrink-0 accent-primary" type="checkbox" checked={grants.memoryWrite} onChange={(event) => change({ memoryWrite: event.target.checked })} />
        <span>Allow durable memory writes beyond this conversation</span>
      </label>
      <p className="text-xs leading-5 text-muted-foreground">Pending scope: folder {folder ? folder.access : 'off'} · shell network {grants.shellNetwork ? 'on' : 'off'} · memory writes {grants.memoryWrite ? 'on' : 'off'}. Access is checked again when tools run.</p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </fieldset>
  )
}
