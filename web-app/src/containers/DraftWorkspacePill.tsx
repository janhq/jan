import { CoworkWorkspacePill } from '@/containers/CoworkWorkspacePill'
import type { ConversationCapabilitiesV1 } from '@/lib/conversationCapabilities'

/**
 * The folder pill for a conversation that does not exist yet. It edits the
 * pending draft, which is persisted through the strict setter when the first
 * message creates the thread, exactly like the in-thread pill.
 */
export function DraftWorkspacePill({
  value,
  onChange,
  onPickFolder,
  showWhenEmpty = false,
}: {
  value: ConversationCapabilitiesV1
  onChange: (next: ConversationCapabilitiesV1) => void
  onPickFolder: () => void
  /** Show the icon-only attach button when no folder is selected. */
  showWhenEmpty?: boolean
}) {
  const folder = value.folderScope
  if (!folder && !showWhenEmpty) return null
  return (
    <div className="pt-2" data-testid="draft-workspace-pill">
      <CoworkWorkspacePill
        folder={folder?.path ?? null}
        access={folder?.access ?? 'write'}
        onAccessChange={(access) =>
          folder && onChange({ ...value, folderScope: { path: folder.path, access } })
        }
        onAttach={onPickFolder}
        onDetach={() => onChange({ ...value, folderScope: null })}
      />
    </div>
  )
}
