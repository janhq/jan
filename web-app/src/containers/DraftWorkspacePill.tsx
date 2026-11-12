import { CoworkWorkspacePill } from '@/containers/CoworkWorkspacePill'

/**
 * The folder pill for a conversation that does not exist yet. It edits the
 * pending draft only; the folder takes effect when the first message creates the
 * conversation. Nothing shows until a folder is chosen: the + menu is where one
 * is added.
 */
export function DraftWorkspacePill({
  folder,
  onPickFolder,
  onDetach,
}: {
  folder: string | null
  onPickFolder: () => void
  onDetach: () => void
}) {
  if (!folder) return null
  return (
    <div className="pt-2" data-testid="draft-workspace-pill">
      <CoworkWorkspacePill
        folder={folder}
        onAttach={onPickFolder}
        onDetach={onDetach}
      />
    </div>
  )
}
