import { useTranslation } from '@/i18n/react-i18next-compat'
import { DiffView } from '@/components/DiffView'
import {
  ToolApprovalDialog,
  type ApprovalDecision,
} from '@/containers/dialogs/ToolApprovalDialog'

export type PermissionDecision = 'allow_once' | 'allow_always' | 'deny'

/** A gated tool call awaiting the user's approval, mirrors the Rust
 * `permission_request` StreamEvent (see events.rs). */
export type PendingPermission = {
  requestId: string
  toolCallId?: string
  toolName: string
  capability: string
  path?: string
  command?: string
  diff?: string
  promptKind: string
  offersAlways: boolean
  // Set when this request came from inside a subagent's wrapped event stream,
  // so the tasks panel can flag that specific run as needing input instead of
  // just "running".
  subagentRunId?: string
}

// The shared dialog speaks hyphenated decisions; the Rust command
// (`agent_permission_respond`) expects the snake_case wire values. Exported so
// other callers speaking the same wire protocol (e.g. code.tsx's inline
// tool-card approval) can reuse it instead of re-deriving the mapping.
export const WIRE: Record<ApprovalDecision, PermissionDecision> = {
  'allow-once': 'allow_once',
  // The agent's grants are "in-memory, thread-scoped ... never persisted"
  // (see `PermissionGrants` in gate.rs), so the wire's `allow_always` already
  // means "for this session". Both scopes map onto it rather than one of them
  // silently behaving like a narrower grant than the label promises.
  'allow-thread': 'allow_always',
  'allow-always': 'allow_always',
  deny: 'deny',
}

/**
 * Approval dialog for a single gated agent tool call. A thin wrapper over the
 * shared `ToolApprovalDialog`: it maps the head of the pending-permission queue
 * onto the shared shell and injects the command/path/diff body. Closing the
 * dialog counts as a deny so the agent never proceeds without an explicit allow.
 */
export default function CodePermissionDialog({
  request,
  onRespond,
}: {
  request: PendingPermission | null
  onRespond: (requestId: string, decision: PermissionDecision) => void
}) {
  const { t } = useTranslation()
  if (!request) return null

  const { requestId, toolName, capability, path, command, diff, offersAlways } =
    request

  return (
    <ToolApprovalDialog
      open={!!request}
      toolName={toolName}
      offersAlways={offersAlways}
      description={
        <>
          {t('tools:toolApproval.description')}{' '}
          <span className="font-semibold">{toolName}</span>
          {capability ? ` (${capability})` : ''}.
        </>
      }
      onDecision={(decision) => onRespond(requestId, WIRE[decision])}
    >
      {command && (
        <pre className="rounded-md bg-sidebar-foreground/5 px-2 py-1.5 text-xs font-mono break-all whitespace-pre-wrap">
          {command}
        </pre>
      )}
      {path && !command && (
        <pre className="rounded-md bg-sidebar-foreground/5 px-2 py-1.5 text-xs font-mono break-all">
          {path}
        </pre>
      )}
      {diff && <DiffView diff={diff} className="mt-1" />}
    </ToolApprovalDialog>
  )
}
